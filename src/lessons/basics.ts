// Beginner course (exercises 1–10): definitions, live grading and a DEMO autopilot per exercise.
// The demo flies the same objectives the student is graded on, using only stick inputs (shown on the
// HUD stick monitor), so "watch, then do it yourself" is exactly the same task.
import type { Engine } from '../sim/engine';
import type { Sticks } from '../input/input';
import type { LessonDef, ObjView, Marker } from './lessons';

export const BASICS: LessonDef[] = [
  { id: 'b1', n: 1, title: 'Take-off and landing', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 180, brief: 'Arm, climb gently to 2 m, hover 3 s, descend slowly and land, then disarm.' },
  { id: 'b2', n: 2, title: 'In-flight control check', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 180, brief: 'At 3 m give VERY small inputs: a little yaw, a little pitch, a little roll — check each one answers. Then land.' },
  { id: 'b3', n: 3, title: 'Pitch forward and back', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 180, brief: 'Pitch forward about 5 m, then pitch back to the same place and hover.' },
  { id: 'b4', n: 4, title: 'Roll right and left', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 240, brief: 'Roll right 5 m and back, then roll left 5 m and back to the start.' },
  { id: 'b5', n: 5, title: 'Square', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 300, brief: 'Pitch forward, roll right, pitch back, roll left — finish where you started (gates show the corners).' },
  { id: 'b6', n: 6, title: 'Right circle', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 240, brief: 'Slight pitch forward with slight yaw right at the same time: fly one full circle to the right.' },
  { id: 'b7', n: 7, title: 'Left circle', level: 'Basic', kind: 'any', track: 'basic', timeLimit: 240, brief: 'Slight pitch forward with slight yaw left at the same time: fly one full circle to the left.' },
  { id: 'b8', n: 8, title: 'Figure 8', level: 'Intermediate', kind: 'any', track: 'basic', timeLimit: 360, brief: 'A right circle followed by a left circle — an 8 — and back to the start.' },
  { id: 'b9', n: 9, title: 'Spiral climb', level: 'Intermediate', kind: 'any', track: 'basic', timeLimit: 300, brief: 'Pitch forward with slight yaw and a little more throttle: one full turn while climbing at least 3 m.' },
  { id: 'b10', n: 10, title: 'Bring it home', level: 'Intermediate', kind: 'any', track: 'basic', timeLimit: 240, brief: 'The drone starts somewhere in the air. Fly it back and land on the pad.' },
];

const TWO_PI = Math.PI * 2;
const wrap = (a: number) => { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** State + grading + demo policy for one beginner exercise. */
export class BasicLesson {
  objectives: ObjView[] = [];
  markers: Marker[] = [];
  step = 0;
  private hold = 0; private ox = 0; private oy = 0; private oyaw = 0; private z0 = 0;
  private turn = 0; private turnR = 0; private turnL = 0; private lastYaw = NaN; private maxDesc = 0; private origin = false;
  constructor(public id: string) { this.build(); }

  private build() {
    const O = (text: string): ObjView => ({ text, progress: 0, done: false });
    const climb = O('Arm and climb to 3 m'), land = O('Land gently and disarm');
    switch (this.id) {
      case 'b1': this.objectives = [O('Arm and climb to 2 m'), O('Hover steady — 3 s'), land]; break;
      case 'b2': this.objectives = [climb, O('Small yaw input — the nose turns'), O('Small pitch input — the drone tilts'), O('Small roll input — the drone tilts'), land]; break;
      case 'b3': this.objectives = [climb, O('Pitch forward ≥ 5 m'), O('Pitch back to the start (< 1.5 m)'), land]; break;
      case 'b4': this.objectives = [climb, O('Roll right ≥ 5 m'), O('Roll back to the start'), O('Roll left ≥ 5 m'), O('Roll back to the start'), land]; break;
      case 'b5': this.objectives = [climb, O('Pitch forward to gate 1'), O('Roll right to gate 2'), O('Pitch back to gate 3'), O('Roll left — back to the start'), land]; break;
      case 'b6': this.objectives = [climb, O('One full circle to the RIGHT'), O('Back near the start (< 5 m)'), land]; break;
      case 'b7': this.objectives = [climb, O('One full circle to the LEFT'), O('Back near the start (< 5 m)'), land]; break;
      case 'b8': this.objectives = [climb, O('Right circle'), O('Left circle'), O('Back near the start (< 5 m)'), land]; break;
      case 'b9': this.objectives = [climb, O('Spiral: one full turn while climbing ≥ 3 m'), land]; break;
      case 'b10': this.objectives = [O('Fly back to the pad'), O('Land on the pad (< 1.5 m, gentle)')];
        this.markers = [{ x: 0, y: 0, z: 0, r: 1.5, kind: 'pad', state: 'next' }]; break;
    }
  }

  /** Called once after the flight starts (exercise 10 starts in the air). */
  setup(e: Engine) {
    if (this.id === 'b10') {
      const a = (Math.random() - 0.5) * 1.6, d = 18 + Math.random() * 12;
      e.core.spawnAir(Math.sin(a) * d, 12 + Math.cos(a) * d, 6 + Math.random() * 3, 2);
    }
  }

  private setOrigin(e: Engine) { this.ox = e.o('X'); this.oy = e.o('Y'); this.oyaw = e.o('YAW'); this.z0 = e.o('Z'); this.origin = true; this.placeGates(); }
  /** position relative to the origin in the start-heading frame: [forward, right] */
  private rel(e: Engine): [number, number] {
    const dx = e.o('X') - this.ox, dy = e.o('Y') - this.oy, c = Math.cos(this.oyaw), s = Math.sin(this.oyaw);
    return [dx * c + dy * s, dx * s - dy * c];
  }
  private world(f: number, r: number): [number, number] { const c = Math.cos(this.oyaw), s = Math.sin(this.oyaw); return [this.ox + f * c + r * s, this.oy + f * s - r * c]; }
  private placeGates() {
    if (this.id !== 'b5') { if (this.id !== 'b10') this.markers = [{ x: this.ox, y: this.oy, z: 0, r: 1.5, kind: 'pad', state: 'idle' }]; return; }
    const pts: [number, number][] = [[6, 0], [6, 6], [0, 6]];
    this.markers = pts.map(([f, r], i) => { const [x, y] = this.world(f, r); return { x, y, z: 3, r: 1.8, kind: 'gate' as const, state: i === 0 ? 'next' as const : 'idle' as const }; });
  }

  /** Grade one frame. Returns 'pass' | 'fail:<reason>' | ''. */
  update(e: Engine, dt: number, done: (i: number) => void, prog: (i: number, p: number) => void): string {
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    const armed = o('ARMED') > 0.5, landed = o('LANDED') > 0.5, z = o('Z'), vz = o('VZ');
    if (!landed) this.maxDesc = Math.max(this.maxDesc * 0.98, -vz);
    // yaw accumulation (right turn = clockwise = yaw decreasing in ENU)
    const yaw = o('YAW');
    if (!Number.isNaN(this.lastYaw) && o('GNDSPEED') > 0.5) { const d = wrap(yaw - this.lastYaw); this.turn += d; if (d < 0) this.turnR -= d; else this.turnL += d; }
    this.lastYaw = yaw;
    const landObj = this.objectives.length - 1;
    const finishLand = (): string => {
      if (landed && !armed) { if (this.maxDesc < 1.0) { done(landObj); return 'pass'; } return `fail:Hard touchdown (${this.maxDesc.toFixed(1)} m/s)`; }
      return '';
    };
    const climbTo = (h: number) => { prog(0, z / h); if (z > h - 0.4 && armed) { done(0); this.step = 1; this.setOrigin(e); } };
    const near = (r: number) => Math.hypot(o('X') - this.ox, o('Y') - this.oy) < r;
    const [f, r] = this.origin ? this.rel(e) : [0, 0];
    const st = e.sticks;

    switch (this.id) {
      case 'b1':
        if (this.step === 0) climbTo(2);
        else if (this.step === 1) { this.hold = z > 1.5 ? this.hold + dt : 0; prog(1, this.hold / 3); if (this.hold >= 3) { done(1); this.step = 2; } }
        else return finishLand();
        break;
      case 'b2': {
        if (this.step === 0) { climbTo(3); break; }
        const small = (v: number) => Math.abs(v) > 0.06 && Math.abs(v) < 0.6;
        if (!this.objectives[1].done && small(st.yaw) && Math.abs(o('R')) > 0.12) done(1);
        if (!this.objectives[2].done && small(st.pitch) && Math.abs(o('PITCH')) > 0.035) done(2);
        if (!this.objectives[3].done && small(st.roll) && Math.abs(o('ROLL')) > 0.035) done(3);
        const big = Math.max(Math.abs(st.yaw), Math.abs(st.pitch), Math.abs(st.roll)) > 0.6;
        this.objectives[1].text = big ? 'Too much stick — use VERY small inputs' : 'Small yaw input — the nose turns';
        if (this.objectives[1].done && this.objectives[2].done && this.objectives[3].done) { this.step = 4; return finishLand(); }
        break;
      }
      case 'b3':
        if (this.step === 0) climbTo(3);
        else if (this.step === 1) { prog(1, f / 5); if (f >= 5) { done(1); this.step = 2; } }
        else if (this.step === 2) { prog(2, 1 - Math.abs(f) / 5); if (near(1.5) && o('GNDSPEED') < 0.6) { done(2); this.step = 3; } }
        else return finishLand();
        break;
      case 'b4':
        if (this.step === 0) climbTo(3);
        else if (this.step === 1) { prog(1, r / 5); if (r >= 5) { done(1); this.step = 2; } }
        else if (this.step === 2) { prog(2, 1 - Math.abs(r) / 5); if (near(1.5)) { done(2); this.step = 3; } }
        else if (this.step === 3) { prog(3, -r / 5); if (r <= -5) { done(3); this.step = 4; } }
        else if (this.step === 4) { prog(4, 1 - Math.abs(r) / 5); if (near(1.5) && o('GNDSPEED') < 0.6) { done(4); this.step = 5; } }
        else return finishLand();
        break;
      case 'b5': {
        if (this.step === 0) { climbTo(3); break; }
        if (this.step <= 3) {
          const g = this.markers[this.step - 1];
          const dist = Math.hypot(o('X') - g.x, o('Y') - g.y);
          prog(this.step, 1 - dist / 6);
          if (dist < g.r) { done(this.step); g.state = 'done'; if (this.markers[this.step]) this.markers[this.step].state = 'next'; this.step++; }
        } else if (this.step === 4) { prog(4, 1 - Math.hypot(f, r) / 6); if (near(2)) { done(4); this.step = 5; } }
        else return finishLand();
        break;
      }
      case 'b6': case 'b7': {
        if (this.step === 0) { climbTo(3); this.turnR = 0; this.turnL = 0; break; }
        const right = this.id === 'b6', amt = right ? this.turnR : this.turnL, wrong = right ? this.turnL : this.turnR;
        if (this.step === 1) { prog(1, amt / TWO_PI); if (wrong > 1.5) return `fail:Turned the wrong way — circle to the ${right ? 'right' : 'left'}`; if (amt >= TWO_PI * 0.95) { done(1); this.step = 2; } }
        else if (this.step === 2) { prog(2, 1 - Math.hypot(f, r) / 15); if (near(5)) { done(2); this.step = 3; } }
        else return finishLand();
        break;
      }
      case 'b8': {
        if (this.step === 0) { climbTo(3); this.turnR = 0; this.turnL = 0; break; }
        if (this.step === 1) { prog(1, this.turnR / TWO_PI); if (this.turnR >= TWO_PI * 0.9) { done(1); this.step = 2; this.turnL = 0; } }
        else if (this.step === 2) { prog(2, this.turnL / TWO_PI); if (this.turnL >= TWO_PI * 0.9) { done(2); this.step = 3; } }
        else if (this.step === 3) { prog(3, 1 - Math.hypot(f, r) / 15); if (near(5)) { done(3); this.step = 4; } }
        else return finishLand();
        break;
      }
      case 'b9': {
        if (this.step === 0) { climbTo(3); this.turn = 0; break; }
        if (this.step === 1) {
          const gain = z - this.z0, t = Math.abs(this.turn) / TWO_PI;
          prog(1, Math.min(t, gain / 3));
          if (Math.abs(this.turn) >= TWO_PI && gain >= 3) { done(1); this.step = 2; }
        } else return finishLand();
        break;
      }
      case 'b10': {
        const dpad = Math.hypot(o('X'), o('Y'));
        if (this.step === 0) { prog(0, 1 - dpad / 30); if (dpad < 3) { done(0); this.step = 1; } }
        else if (landed && !armed) {
          if (dpad <= 1.5 && this.maxDesc < 1.0) { done(1); return 'pass'; }
          return dpad > 1.5 ? `fail:Landed ${dpad.toFixed(1)} m from the pad centre` : `fail:Hard touchdown (${this.maxDesc.toFixed(1)} m/s)`;
        } else prog(1, 1 - Math.min(1, dpad / 3));
        break;
      }
    }
    return '';
  }

  // ---------------- demo autopilot (sticks only) ----------------
  private demoT = 0; private phase = 0;
  demo(e: Engine, dt: number): Partial<Sticks> {
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    this.demoT += dt;
    const z = o('Z'), armed = o('ARMED') > 0.5, landed = o('LANDED') > 0.5, yaw = o('YAW');
    const base: Partial<Sticks> = { roll: 0, pitch: 0, yaw: 0, thr: 0.5, modePos: 2 };
    const hold = (h: number) => clamp(0.5 + (h - z) * 0.18 - o('VZ') * 0.1, 0.25, 0.8);
    /** body-frame stick P-controller toward a world point (LOITER: stick = velocity) */
    const goTo = (x: number, y: number, k = 0.09, lim = 0.45): Partial<Sticks> => {
      const ex = x - o('X'), ey = y - o('Y'), c = Math.cos(yaw), s = Math.sin(yaw);
      const vf = o('VX') * c + o('VY') * s, vr = o('VX') * s - o('VY') * c;
      return { pitch: clamp((ex * c + ey * s) * k - vf * 0.08, -lim, lim), roll: clamp((ex * s - ey * c) * k - vr * 0.08, -lim, lim) };
    };
    const landNow = (): Partial<Sticks> => ({ ...base, thr: landed ? 0 : z > 1.2 ? 0.3 : 0.38 });
    if (!armed && this.step === 0 && !landed) return base;
    if (!armed && this.step === 0) { if (this.demoT > 0.4) e.requestArm(); return { ...base, thr: 0 }; }
    if (this.step === 0 && this.id !== 'b10') return { ...base, thr: z < 0.3 ? 0.75 : hold(3.2) };
    const last = this.objectives.length - 1;
    if (this.step >= last && this.id !== 'b10') return { ...landNow(), ...(['b3', 'b4', 'b5', 'b6', 'b7', 'b8'].includes(this.id) ? goTo(this.ox, this.oy) : {}) };
    switch (this.id) {
      case 'b1': return { ...base, thr: hold(2.3) };
      case 'b2': {
        const t = this.demoT % 9;
        return { ...base, thr: hold(3), yaw: t < 2 ? 0.25 : 0, pitch: t >= 3 && t < 4 ? 0.2 : t >= 4 && t < 5 ? -0.2 : 0, roll: t >= 6 && t < 7 ? 0.2 : t >= 7 && t < 8 ? -0.2 : 0 };
      }
      case 'b3': { const [x, y] = this.step === 1 ? this.world(6, 0) : [this.ox, this.oy]; return { ...base, thr: hold(3), ...goTo(x, y) }; }
      case 'b4': { const tgt = this.step === 1 ? this.world(0, 6) : this.step === 3 ? this.world(0, -6) : [this.ox, this.oy]; return { ...base, thr: hold(3), ...goTo(tgt[0], tgt[1]) }; }
      case 'b5': { const g = this.step <= 3 ? this.markers[this.step - 1] : { x: this.ox, y: this.oy }; return { ...base, thr: hold(3), ...goTo(g.x, g.y) }; }
      case 'b6': case 'b7': {
        if (this.step === 1) return { ...base, thr: hold(3), pitch: 0.3, yaw: this.id === 'b6' ? 0.3 : -0.3 };
        return { ...base, thr: hold(3), ...goTo(this.ox, this.oy) };
      }
      case 'b8': {
        if (this.step === 1) return { ...base, thr: hold(3), pitch: 0.3, yaw: 0.3 };
        if (this.step === 2) return { ...base, thr: hold(3), pitch: 0.3, yaw: -0.3 };
        return { ...base, thr: hold(3), ...goTo(this.ox, this.oy) };
      }
      case 'b9': return { ...base, thr: z < this.z0 + 3.5 ? 0.62 : hold(this.z0 + 3.5), pitch: 0.3, yaw: 0.28 };
      case 'b10': {
        if (this.step === 0) return { ...base, thr: hold(Math.max(4, z)), ...goTo(0, 0, 0.08, 0.5) };
        const d = Math.hypot(o('X'), o('Y'));
        return { ...base, ...goTo(0, 0, 0.12, 0.3), thr: landed ? 0 : d > 0.6 ? hold(Math.max(z, 1.5)) : z > 1.2 ? 0.3 : 0.38 };
      }
    }
    return base;
  }
}
