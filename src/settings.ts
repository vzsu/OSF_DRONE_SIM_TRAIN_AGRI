import { ENV_PRESETS, type EnvSettings } from './sim/wasm';
import { PILOT_DEFAULT } from './data/world';
import { defaultPlan, type MissionPlan } from './sim/mission';

export type Func = 'roll' | 'pitch' | 'throttle' | 'yaw' | 'arm' | 'mode' | 'spray' | 'rtl' | 'kill' | 'flow' | 'view' | 'reset';
export const STICK_FUNCS: Func[] = ['roll', 'pitch', 'throttle', 'yaw'];
export const SWITCH_FUNCS: Func[] = ['arm', 'mode', 'spray', 'rtl', 'kill', 'flow', 'view', 'reset'];

export interface Src { kind: 'axis' | 'button' | 'none'; index: number; reverse: boolean; min: number; center: number; max: number }

export interface ControllerProfile {
  deviceId: string;
  stickMode: 1 | 2;
  map: Record<Func, Src>;
  deadband: number; expo: number; rate: number;
  modePositions: [number, number, number];
  armMethod: 'switch' | 'gesture';
  calibrated: boolean;
  v?: number; // profile schema version
  phys?: Partial<Record<Func, string>>; // physical control on the radio (SA, SB, …) — for the layout diagram
}

export type View = 'vlos' | 'chase' | 'fpv' | 'cam' | 'top';

export interface Settings {
  droneId: string;
  env: EnvSettings & { timeOfDay: number; hdri: string };
  profiles: Record<string, ControllerProfile>;
  activeDevice: string; // '' = auto (first connected) | 'keyboard'
  camera: { view: View; fov: number; pilotX: number; pilotY: number; eye: number; fpvTilt: number; vlosZoom: boolean };
  latency: { linkMs: number };
  display: { units: 'metric' | 'imperial'; orientArrow: boolean; groundMarker: boolean; showSticks: boolean; quality: 'low' | 'high'; trail: boolean; hudDetail?: boolean };
  /** training ground: a named place id, or 'custom' with category + seed */
  place: { id: string; category: 'agri' | 'wedding' | 'training'; seed: number };
  trainee: string;
  lesson?: string | null; checkride?: boolean;
  lessonBest?: Record<string, { passed: boolean; time: number; checkride: boolean; at: string }>;
  chargeMinutes?: number; // charger 0→100 % time (training default 6, real 30–60)
  keys: Record<string, string>; // keyboard bindings: action → KeyboardEvent.code
  sv?: number; // settings schema version
  mission: MissionPlan;
  audio: { on: boolean; volume: number; voice?: boolean };
}

const ax = (index: number, reverse = false): Src => ({ kind: 'axis', index, reverse, min: -1, center: 0, max: 1 });
const none = (): Src => ({ kind: 'none', index: 0, reverse: false, min: -1, center: 0, max: 1 });

export function defaultProfile(deviceId: string): ControllerProfile {
  // EdgeTX USB joystick default: CH1..CH8 → axes 0..7, AETR order
  return {
    deviceId, stickMode: 2,
    map: {
      roll: ax(0), pitch: ax(1), throttle: ax(2), yaw: ax(3),
      arm: ax(4), mode: ax(5), spray: ax(6), rtl: ax(7), kill: none(), flow: none(), view: none(), reset: none(),
    },
    deadband: 0.03, expo: 0.25, rate: 1.0,
    modePositions: [0, 1, 2],
    armMethod: 'switch', calibrated: false, v: 3,
    // Radiomaster Pocket: SA/SD 2-pos, SB/SC 3-pos, SE momentary. Set these in the EdgeTX mixer to CH5..CH8.
    phys: { roll: 'Right stick ↔', pitch: 'Right stick ↕', throttle: 'Left stick ↕', yaw: 'Left stick ↔', arm: 'SA', mode: 'SB', spray: 'SC', rtl: 'SD' },
  };
}

const KEY = 'osf-sim-settings-v1';

export function defaultSettings(): Settings {
  return {
    droneId: 'marut_ag365h',
    env: { ...ENV_PRESETS.calm, timeOfDay: 9, hdri: 'sunflowers', holdAssist: true, crop: 'soybean', grass: 'lush' },
    profiles: {},
    activeDevice: '',
    camera: { view: 'vlos', fov: 50, pilotX: PILOT_DEFAULT.x, pilotY: PILOT_DEFAULT.y, eye: PILOT_DEFAULT.eye, fpvTilt: -15, vlosZoom: false },
    latency: { linkMs: 0 },
    display: { units: 'metric', orientArrow: false, groundMarker: true, showSticks: true, quality: 'high', trail: true },
    place: { id: 'agri-classic', category: 'agri', seed: 0 },
    trainee: '',
    chargeMinutes: 6,
    keys: {},
    sv: 2,
    mission: defaultPlan(),
    audio: { on: true, volume: 0.7 },
  };
}

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    // v2 settings: default weather is calm (wind used to be on by default and made hold modes drift)
    if (!s.sv || s.sv < 2) { s.env = { ...s.env, windSpd: 0, gust: 0, turb: 0, holdAssist: true }; s.sv = 2; }
    return { ...d, ...s, env: { ...d.env, ...s.env }, camera: { ...d.camera, ...s.camera }, latency: { ...d.latency, ...s.latency }, display: { ...d.display, ...s.display }, mission: { ...d.mission, ...s.mission }, audio: { ...d.audio, ...s.audio }, place: { ...d.place, ...s.place }, keys: { ...d.keys, ...s.keys } };
  } catch { return d; }
}

export const settings: Settings = load();

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
}

export function profileFor(deviceId: string): ControllerProfile {
  if (!settings.profiles[deviceId]) settings.profiles[deviceId] = defaultProfile(deviceId);
  const p = settings.profiles[deviceId];
  if ((p.v ?? 1) < 2) {
    // v2: added kill + flow inputs; uncalibrated profiles get the safer mode order
    // (Radiomaster Pocket's 3-pos switch rests at +1 → position 3 → LOITER instead of STABILIZE)
    p.map.kill ??= none(); p.map.flow ??= none();
    if (!p.calibrated && p.modePositions.join() === '2,1,0') p.modePositions = [0, 1, 2];
    p.v = 2; saveSettings();
  }
  if ((p.v ?? 1) < 3) {
    // v3: reset (restart on pad) input + physical switch labels; mode switch may select AUTO
    p.map.reset ??= none();
    p.phys ??= defaultProfile(deviceId).phys;
    p.v = 3; saveSettings();
  }
  return p;
}

export function exportJson(obj: unknown, name: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  downloadBlob(blob, name);
}
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
