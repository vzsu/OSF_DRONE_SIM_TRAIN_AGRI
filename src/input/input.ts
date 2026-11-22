// Input layer: RC transmitter via Gamepad API (Radiomaster Pocket in USB Joystick mode),
// keyboard fallback, and a virtual pad hook (window.__virtualPad) for automated tests.
import { settings, profileFor, type ControllerProfile, type Src } from '../settings';

export interface RawPad { id: string; axes: number[]; buttons: boolean[]; timestamp: number }
export interface Sticks {
  roll: number; pitch: number; yaw: number; thr: number;   // roll/pitch/yaw -1..1, thr 0..1
  arm: number; modePos: number; spray: boolean; rtl: boolean; viewPos: number; kill: boolean; flow: number; reset: boolean;
  source: string; ok: boolean; sampleTime: number;
}

declare global { interface Window { __virtualPad?: { axes: number[]; buttons: boolean[] } } }

export const KEYBOARD_ID = 'keyboard';
export const VIRTUAL_ID = 'Virtual RC (test)';

export function listPads(): RawPad[] {
  const out: RawPad[] = [];
  if (window.__virtualPad) out.push({ id: VIRTUAL_ID, axes: window.__virtualPad.axes, buttons: window.__virtualPad.buttons, timestamp: performance.now() });
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const g of pads) {
    if (!g) continue;
    out.push({ id: g.id, axes: Array.from(g.axes), buttons: g.buttons.map((b) => b.pressed || b.value > 0.5), timestamp: g.timestamp });
  }
  return out;
}

export function activePad(): RawPad | null {
  const pads = listPads();
  if (settings.activeDevice === KEYBOARD_ID) return null;
  if (settings.activeDevice) return pads.find((p) => p.id === settings.activeDevice) ?? null;
  return pads[0] ?? null;
}

// ---------- keyboard ----------
const keys = new Set<string>();
const kb = { arm: 0, modePos: 2, spray: false, rtl: false, view: 0, kill: false, flow: 1 };
let kbHandlers: ((code: string) => void)[] = [];
export function onKey(fn: (code: string) => void) { kbHandlers.push(fn); }
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (!keys.has(e.code)) {
    if (e.code === 'Enter') kb.arm = kb.arm ? 0 : 1;
    if (e.code === 'Digit1') kb.modePos = 0;
    if (e.code === 'Digit2') kb.modePos = 1;
    if (e.code === 'Digit3') kb.modePos = 2;
    if (e.code === 'Digit4') kb.modePos = 3; // AUTO (mission)
    if (e.code === 'KeyR') kb.rtl = !kb.rtl;
    if (e.code === 'KeyK') kb.kill = !kb.kill;
    if (e.code === 'BracketLeft') kb.flow = Math.max(0, +(kb.flow - 0.1).toFixed(1));
    if (e.code === 'BracketRight') kb.flow = Math.min(1, +(kb.flow + 0.1).toFixed(1));
    if (e.code === 'Space') { kb.spray = !kb.spray; e.preventDefault(); }
    kbHandlers.forEach((f) => f(e.code));
  }
  keys.add(e.code);
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let kbThr = 0;
function keyboardSticks(armed: boolean): Sticks {
  const k = (c: string) => (keys.has(c) ? 1 : 0);
  // Mode 2 layout: W/S throttle, A/D yaw, arrows pitch/roll
  const up = k('KeyW'), dn = k('KeyS');
  const centre = armed ? 0.5 : 0;
  const target = up ? 0.85 : dn ? 0.15 : centre;
  kbThr += (target - kbThr) * 0.25;
  return {
    roll: k('ArrowRight') - k('ArrowLeft'), pitch: k('ArrowUp') - k('ArrowDown'), yaw: k('KeyD') - k('KeyA'),
    thr: kbThr, arm: kb.arm, modePos: kb.modePos, spray: kb.spray, rtl: kb.rtl, viewPos: 0, kill: kb.kill, flow: kb.flow, reset: false,
    source: 'Keyboard', ok: true, sampleTime: performance.now(),
  };
}
export function keyboardArmReset() { kb.arm = 0; kb.spray = false; kb.rtl = false; kb.kill = false; }

// ---------- mapping ----------
export function readSrc(pad: RawPad, s: Src): number {
  if (s.kind === 'axis') return pad.axes[s.index] ?? 0;
  if (s.kind === 'button') return pad.buttons[s.index] ? 1 : -1;
  return -1;
}

export function normStick(v: number, s: Src): number {
  let x = v >= s.center ? (v - s.center) / Math.max(s.max - s.center, 1e-3) : (v - s.center) / Math.max(s.center - s.min, 1e-3);
  x = Math.max(-1, Math.min(1, x));
  return s.reverse ? -x : x;
}
export function normThrottle(v: number, s: Src): number {
  let x = (v - s.min) / Math.max(s.max - s.min, 1e-3);
  x = Math.max(0, Math.min(1, x));
  return s.reverse ? 1 - x : x;
}
function shape(x: number, p: ControllerProfile): number {
  const a = Math.abs(x);
  if (a < p.deadband) return 0;
  let y = (a - p.deadband) / (1 - p.deadband);
  y = (1 - p.expo) * y + p.expo * y * y * y;
  return Math.sign(x) * Math.min(1, y * p.rate);
}
function switchPos(v: number, s: Src): number {
  if (s.kind === 'none') return 0;
  let x = s.kind === 'button' ? v : normStick(v, s);
  if (s.kind === 'button' && s.reverse) x = -x;
  return x < -0.33 ? 0 : x > 0.33 ? 2 : 1;
}

export function readSticks(armed: boolean): Sticks {
  const pad = activePad();
  if (!pad) return keyboardSticks(armed);
  const p = profileFor(pad.id);
  const m = p.map;
  const r = (f: keyof typeof m) => readSrc(pad, m[f]);
  return {
    roll: shape(normStick(r('roll'), m.roll), p),
    pitch: shape(normStick(r('pitch'), m.pitch), p),
    yaw: shape(normStick(r('yaw'), m.yaw), p),
    thr: normThrottle(r('throttle'), m.throttle),
    arm: m.arm.kind === 'none' ? 0 : (switchPos(r('arm'), m.arm) === 2 ? 1 : 0),
    modePos: switchPos(r('mode'), m.mode),
    spray: m.spray.kind !== 'none' && switchPos(r('spray'), m.spray) === 2,
    rtl: m.rtl.kind !== 'none' && switchPos(r('rtl'), m.rtl) === 2,
    viewPos: switchPos(r('view'), m.view),
    kill: m.kill.kind !== 'none' && switchPos(r('kill'), m.kill) === 2,
    flow: m.flow.kind === 'none' ? 1 : normThrottle(r('flow'), m.flow),
    reset: (m.reset?.kind ?? 'none') !== 'none' && switchPos(r('reset'), m.reset) === 2,
    source: pad.id, ok: true, sampleTime: performance.now(),
  };
}

export function usingSwitchArm(): boolean {
  const pad = activePad();
  if (!pad) return true; // keyboard: Enter toggles an arm "switch"
  const p = profileFor(pad.id);
  return p.armMethod === 'switch' && p.map.arm.kind !== 'none';
}
