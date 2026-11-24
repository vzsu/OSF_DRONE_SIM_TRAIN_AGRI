// Structured lessons + checkride. Each lesson is a small state machine evaluated every frame against
// the physics outputs: objectives with live progress, 3D gates/markers, pass / fail, time limit.
// Checkride mode = aids off + one random failure injected mid-lesson.
import type { Engine } from '../sim/engine';
import { CROWD, BOXES, overCrowd } from '../data/world';
import { settings } from '../settings';
import { BASICS, BasicLesson } from './basics';

export interface Marker { x: number; y: number; z: number; r: number; kind: 'gate' | 'pad' | 'box' | 'poi'; state: 'next' | 'done' | 'idle' }
export interface ObjView { text: string; progress: number; done: boolean }
export interface LessonDef {
  id: string; n: number; title: string; level: 'Basic' | 'Intermediate' | 'Advanced'; kind: 'agri' | 'camera' | 'any';
  brief: string; timeLimit: number; holdAssist?: boolean; wind?: number;
  /** 'basic' = beginner course (with demo), 'pro' = advanced / agri / camera */
  track?: 'basic' | 'pro';
}

export const LESSONS: LessonDef[] = [
  { id: 'hover', n: 1, title: 'Take-off, hover, land', level: 'Basic', kind: 'any', timeLimit: 240, brief: 'Climb to 3 m in LOITER, hold inside the 1 m box for 20 s, land softly on the pad.' },
  { id: 'atti', n: 2, title: 'ATTI hover in wind', level: 'Intermediate', kind: 'any', timeLimit: 240, holdAssist: false, wind: 2.5, brief: 'Hold assist OFF, 2.5 m/s wind. Hover in ALT HOLD within 2 m of the marker for 20 s — you must correct the drift yourself.' },
  { id: 'box', n: 3, title: 'Box pattern', level: 'Basic', kind: 'any', timeLimit: 300, brief: 'Fly through the four gates in order at 5 m, then land on the pad.' },
  { id: 'nosein', n: 4, title: 'Nose-in hover', level: 'Intermediate', kind: 'any', timeLimit: 240, brief: 'Hover 15 m in front of you with the nose pointing at you (controls reversed!) for 15 s.' },
  { id: 'lane', n: 5, title: 'Manual spray lane', level: 'Intermediate', kind: 'agri', timeLimit: 300, brief: 'Spray along the marked 60 m lane: height 2–3 m, speed 3–5 m/s, within 1 m of the line. Pump off, then land.' },
  { id: 'motor', n: 6, title: 'Emergency: motor failure', level: 'Advanced', kind: 'agri', timeLimit: 180, brief: 'Hover at 8 m. A motor will fail. Keep it level and land within 60 s without crashing.' },
  { id: 'precision', n: 7, title: 'Precision landing', level: 'Intermediate', kind: 'any', timeLimit: 240, brief: 'Take off, fly 20 m out, come back and land within 0.5 m of the pad centre at < 0.6 m/s.' },
  { id: 'orbit', n: 8, title: 'Wedding orbit shot', level: 'Advanced', kind: 'camera', timeLimit: 300, brief: 'Camera drone: orbit the point 360° at 15–30 m radius, nose (camera) on the subject ±30°, never over the guests.' },
];
for (const l of LESSONS) l.track ??= 'pro';
/** every lesson: beginner course first, then the advanced ones */
export const ALL_LESSONS: LessonDef[] = [...BASICS, ...LESSONS];
export const lessonById = (id?: string | null) => ALL_LESSONS.find((l) => l.id === id) ?? null;

export interface LessonResult { id: string; title: string; passed: boolean; reason: string; time: number; objectives: ObjView[]; checkride: boolean; failure?: string }

export class LessonRunner {
  def: LessonDef | null = null;
  objectives: ObjView[] = [];
  markers: Marker[] = [];
  result: LessonResult | null = null;
  checkride = false;
  private t = 0; private hold = 0; private step = 0; private extra = 0; private angle = 0; private lastAng = NaN;
  private failAt = 0; private failName = ''; private failDone = false;
  /** beginner exercise logic (null for advanced lessons) */
  basic: BasicLesson | null = null;
  /** true while the lesson is being demonstrated by the autopilot */
  demo = false;
  onObjectiveDone: (i: number) => void = () => {};
  onFinish: (r: LessonResult) => void = () => {};

  start(def: LessonDef | null, e: Engine, checkride: boolean) {
    this.def = def; this.result = null; this.checkride = checkride && !!def;
    this.t = 0; this.hold = 0; this.step = 0; this.extra = 0; this.angle = 0; this.lastAng = NaN; this.failDone = false;
    this.markers = []; this.objectives = []; this.basic = null;
    if (!def) return;
    if (def.track === 'basic') {
      this.basic = new BasicLesson(def.id); this.objectives = this.basic.objectives; this.markers = this.basic.markers;
      this.failName = ''; this.basic.setup(e); return;
    }
    // checkride: one random failure between 25 and 70 s (not in the dedicated emergency lesson)
    const pool = e.drone.tankCap > 0 ? ['gps', 'motor', 'rc'] : ['gps', 'rc'];
    this.failName = this.checkride && def.id !== 'motor' ? pool[Math.floor(Math.random() * pool.length)] : '';
    this.failAt = 25 + Math.random() * 45;
    this.build(def);
  }

  private build(d: LessonDef) {
    const O = (text: string): ObjView => ({ text, progress: 0, done: false });
    switch (d.id) {
      case 'hover': this.objectives = [O('Take off to 3 m'), O('Hold LOITER in the 1 m box at 3 m — 20 s'), O('Land on the pad (< 0.7 m/s)')];
        this.markers = [{ x: 0, y: 4, z: 3, r: 1, kind: 'box', state: 'next' }, { x: 0, y: 0, z: 0, r: 1.2, kind: 'pad', state: 'idle' }]; break;
      case 'atti': this.objectives = [O('Climb to 4 m in ALT HOLD'), O('Stay within 2 m of the marker — 20 s'), O('Land')];
        this.markers = [{ x: 0, y: 6, z: 4, r: 2, kind: 'box', state: 'next' }]; break;
      case 'box': {
        const g: [number, number][] = [[-10, 15], [10, 15], [10, 35], [-10, 35]];
        this.objectives = [...g.map((_, i) => O(`Gate ${i + 1}`)), O('Land on the pad')];
        this.markers = [...g.map(([x, y], i) => ({ x, y, z: 5, r: 1.6, kind: 'gate' as const, state: i === 0 ? 'next' as const : 'idle' as const })), { x: 0, y: 0, z: 0, r: 1.2, kind: 'pad', state: 'idle' }]; break;
      }
      case 'nosein': this.objectives = [O('Fly to the marker 15 m in front of you at 4 m'), O('Nose pointing at you, inside 3 m — 15 s'), O('Land')];
        this.markers = [{ x: settings.camera.pilotX, y: settings.camera.pilotY + 15, z: 4, r: 3, kind: 'box', state: 'next' }]; break;
      case 'lane': this.objectives = [O('Spray the lane: height 2–3 m, speed 3–5 m/s, < 1 m off the line'), O('Pump off after the lane end'), O('Land')];
        this.markers = [{ x: -30, y: 30, z: 2.5, r: 1.5, kind: 'gate', state: 'next' }, { x: 30, y: 30, z: 2.5, r: 1.5, kind: 'gate', state: 'idle' }]; break;
      case 'motor': this.objectives = [O('Climb to 8 m and hover'), O('Motor failure: stay upright'), O('Land within 60 s without crashing')];
        this.markers = [{ x: 0, y: 8, z: 8, r: 2, kind: 'box', state: 'next' }]; break;
      case 'precision': this.objectives = [O('Fly out to the marker 20 m north'), O('Return and land within 0.5 m of the pad centre'), O('Touch down below 0.6 m/s')];
        this.markers = [{ x: 0, y: 20, z: 4, r: 2, kind: 'gate', state: 'next' }, { x: 0, y: 0, z: 0, r: 0.5, kind: 'pad', state: 'idle' }]; break;
      case 'orbit': {
        const m = BOXES.find((b) => b.kind === 'canopy') ?? { x: 0, y: 40 };
        this.objectives = [O('Orbit 360° at 15–30 m with the camera on the subject'), O('Never over the guests'), O('Land')];
        this.markers = [{ x: m.x, y: m.y, z: 3, r: 1, kind: 'poi', state: 'next' }]; break;
      }
    }
  }

  get active() { return !!this.def && !this.result; }
  get elapsed() { return this.t; }

  update(e: Engine, dt: number) {
    const d = this.def; if (!d || this.result || dt <= 0 || e.paused) return;
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    const armed = o('ARMED') > 0.5, landed = o('LANDED') > 0.5, x = o('X'), y = o('Y'), z = o('Z'), vz = o('VZ'), mode = o('MODE');
    if (armed) this.t += dt;
    if (o('CRASHED') > 0.5) return this.finish(false, 'Crashed');
    // lessons are flown by hand: any automatic return / landing / mission (e.g. a failsafe) voids the run
    if (!this.demo && armed && !landed && (mode === 3 || mode === 4 || mode === 5)) return this.finish(false, 'Automatic RTH / landing / AUTO took over — lessons must be flown by hand');
    if (this.t > d.timeLimit) return this.finish(false, 'Time limit reached');
    // checkride failure injection
    if (this.failName && !this.failDone && this.t > this.failAt && !landed) {
      this.failDone = true;
      if (this.failName === 'gps') e.fail.gps = true; else if (this.failName === 'motor') e.fail.motor = 1; else e.rcLost = true;
      if (this.failName === 'rc') setTimeout(() => (e.rcLost = false), 6000); // link comes back after 6 s
    }
    const done = (i: number) => { const ob = this.objectives[i]; if (ob && !ob.done) { ob.done = true; ob.progress = 1; this.onObjectiveDone(i); } };
    const prog = (i: number, p: number) => { const ob = this.objectives[i]; if (ob && !ob.done) ob.progress = Math.max(0, Math.min(1, p)); };
    const near = (m: Marker, r = m.r) => Math.hypot(x - m.x, y - m.y) < r && Math.abs(z - m.z) < Math.max(r, 0.6);
    const softLand = () => landed && !armed && this.extra < 0.7;
    if (this.basic) {
      const r = this.basic.update(e, dt, done, prog);
      this.markers = this.basic.markers;
      if (r === 'pass') return this.finish(true, '');
      if (r.startsWith('fail:')) return this.finish(false, r.slice(5));
      return;
    }
    if (!landed) this.extra = Math.max(this.extra * 0.98, -vz); // recent descent rate for the touchdown check
    const setNext = (i: number) => this.markers.forEach((m, k) => (m.state = k < i ? 'done' : k === i ? 'next' : m.state === 'done' ? 'done' : 'idle'));

    switch (d.id) {
      case 'hover': case 'atti': {
        const tz = d.id === 'hover' ? 3 : 4, box = this.markers[0];
        if (this.step === 0) { prog(0, z / tz); if (z > tz - 0.5) { done(0); this.step = 1; } }
        else if (this.step === 1) {
          const ok = Math.hypot(x - box.x, y - box.y) < box.r && Math.abs(z - tz) < 0.5 && (d.id === 'hover' ? mode === 2 : mode === 1);
          this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);
          box.state = ok ? 'done' : 'next';
          prog(1, this.hold / 20); if (this.hold >= 20) { done(1); this.step = 2; setNext(1); }
        } else if (softLand()) { done(2); this.finish(true, ''); }
        else if (landed && !armed) this.finish(false, `Hard touchdown (${this.extra.toFixed(1)} m/s)`);
        break;
      }
      case 'box': {
        if (this.step < 4) { const g = this.markers[this.step]; prog(this.step, 1 - Math.min(1, Math.hypot(x - g.x, y - g.y) / 25)); if (near(g)) { done(this.step); this.step++; setNext(this.step); } }
        else if (softLand()) { done(4); this.finish(true, ''); }
        break;
      }
      case 'nosein': {
        const m = this.markers[0];
        if (this.step === 0) { prog(0, 1 - Math.hypot(x - m.x, y - m.y) / 15); if (near(m)) { done(0); this.step = 1; } }
        else if (this.step === 1) {
          const toPilot = Math.atan2(settings.camera.pilotY - y, settings.camera.pilotX - x);
          let err = Math.abs(toPilot - o('YAW')); if (err > Math.PI) err = 2 * Math.PI - err;
          const ok = err < 0.52 && Math.hypot(x - m.x, y - m.y) < m.r && z > 2;
          this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 2); m.state = ok ? 'done' : 'next';
          prog(1, this.hold / 15); if (this.hold >= 15) { done(1); this.step = 2; }
        } else if (softLand()) { done(2); this.finish(true, ''); }
        break;
      }
      case 'lane': {
        const [a, b] = this.markers;
        if (this.step === 0) {
          const spraying = o('SPRAYING') > 0.5, onLine = Math.abs(y - 30) < 1 && x > -31 && x < 31;
          const good = spraying && onLine && z > 2 && z < 3 && o('GNDSPEED') > 3 && o('GNDSPEED') < 5;
          if (good) this.hold += dt * o('GNDSPEED');
          if (spraying && !onLine && this.hold > 2) this.objectives[0].text = 'Spray the lane — back on the line!';
          prog(0, this.hold / 54); a.state = this.hold > 1 ? 'done' : 'next'; b.state = 'next';
          if (this.hold >= 54) { done(0); this.step = 1; b.state = 'done'; }
        } else if (this.step === 1) { if (o('SPRAYING') < 0.5) { done(1); this.step = 2; } }
        else if (softLand()) { done(2); this.finish(true, ''); }
        break;
      }
      case 'motor': {
        if (this.step === 0) { prog(0, z / 8); if (z > 7.5) { this.hold += dt; if (this.hold > 4) { done(0); this.step = 1; e.fail.motor = 1; this.hold = 0; } } }
        else if (this.step === 1) { this.hold += dt; const up = Math.abs(o('ROLL')) < 0.7 && Math.abs(o('PITCH')) < 0.7; if (up) prog(1, this.hold / 3); if (this.hold > 3 && up) { done(1); this.step = 2; this.hold = 0; } }
        else { this.hold += dt; prog(2, this.hold / 60); if (landed && !armed) { done(2); this.finish(true, ''); } else if (this.hold > 60) this.finish(false, 'Not landed within 60 s'); }
        break;
      }
      case 'precision': {
        const g = this.markers[0];
        if (this.step === 0) { prog(0, Math.hypot(x, y) / 20); if (near(g)) { done(0); this.step = 1; setNext(1); } }
        else if (landed && !armed) {
          const off = Math.hypot(x, y);
          if (off <= 0.5) done(1); if (this.extra < 0.6) done(2);
          this.finish(off <= 0.5 && this.extra < 0.6, off > 0.5 ? `Landed ${off.toFixed(2)} m from the centre` : `Touchdown ${this.extra.toFixed(2)} m/s`);
        } else prog(1, 1 - Math.min(1, Math.hypot(x, y) / 20));
        break;
      }
      case 'orbit': {
        const m = this.markers[0];
        if (CROWD.length && overCrowd(x, y, 1) && z > 0.5) { this.objectives[1].text = 'Never over the guests — FAILED'; return this.finish(false, 'Flew over the guests'); }
        if (this.step === 0) {
          const r = Math.hypot(x - m.x, y - m.y), ang = Math.atan2(y - m.y, x - m.x);
          let err = Math.abs(Math.atan2(m.y - y, m.x - x) - o('YAW')); if (err > Math.PI) err = 2 * Math.PI - err;
          if (r > 15 && r < 30 && err < 0.52 && z > 3) {
            if (!Number.isNaN(this.lastAng)) { let da = ang - this.lastAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; this.angle += da; }
            this.lastAng = ang;
          } else this.lastAng = NaN;
          prog(0, Math.abs(this.angle) / (2 * Math.PI)); prog(1, Math.abs(this.angle) / (2 * Math.PI));
          if (Math.abs(this.angle) >= 2 * Math.PI) { done(0); done(1); this.step = 1; }
        } else if (landed && !armed) { done(2); this.finish(true, ''); }
        break;
      }
    }
  }

  private finish(passed: boolean, reason: string) {
    if (!this.def || this.result) return;
    this.result = { id: this.def.id, title: this.def.title, passed, reason, time: this.t, objectives: this.objectives.map((x) => ({ ...x })), checkride: this.checkride, failure: this.failDone ? this.failName : undefined };
    this.onFinish(this.result);
  }
}
