// Agri spray mission: area polygon → boustrophedon (back-and-forth) lanes → legs flown in AUTO mode.
// Behaves like agri ground-station apps: lanes sprayed automatically, pump off on turns/transit,
// battery-low or tank-empty → RTL with a BREAKPOINT; after a battery swap / refill the drone
// flies back to the breakpoint and continues the same lane.
import type { AutoCmd } from './wasm';
import { FIELD } from '../data/world';

export type Pt = [number, number];

export interface MissionPlan {
  poly: Pt[];          // area corners, world x (east) / y (north), metres
  spacing: number;     // lane spacing = effective spray swath (m)
  height: number;      // spray height above crop / ground (m)
  speed: number;       // spray speed (m/s)
  angleDeg: number | null; // lane direction, degrees CCW from east; null = along the longest edge
  margin: number;      // keep-in distance from the boundary (m)
}

export interface Leg { a: Pt; b: Pt; spray: boolean; lane: number }

export function defaultPlan(): MissionPlan {
  const f = FIELD ?? { x0: -50, x1: 50, y0: 12, y1: 112 };
  return { poly: [[f.x0 + 5, f.y0 + 5], [f.x1 - 5, f.y0 + 5], [f.x1 - 5, f.y1 - 5], [f.x0 + 5, f.y1 - 5]], spacing: 4, height: 2.5, speed: 5, angleDeg: null, margin: 1 };
}

export function polyArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function laneAngle(plan: MissionPlan): number {
  if (plan.angleDeg !== null) return plan.angleDeg * Math.PI / 180;
  let best = 0, ang = 0;
  const p = plan.poly;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    const l = Math.hypot(x2 - x1, y2 - y1);
    if (l > best) { best = l; ang = Math.atan2(y2 - y1, x2 - x1); }
  }
  return ang;
}

/** Spray lanes (in flying order, alternating direction). */
export function planLanes(plan: MissionPlan): { a: Pt; b: Pt }[] {
  const poly = plan.poly;
  if (poly.length < 3 || plan.spacing < 0.5) return [];
  const th = laneAngle(plan), c = Math.cos(th), s = Math.sin(th);
  const rot = ([x, y]: Pt): Pt => [x * c + y * s, -x * s + y * c];   // world → lane frame
  const back = ([u, v]: Pt): Pt => [u * c - v * s, u * s + v * c];   // lane frame → world
  const rp = poly.map(rot);
  const vs = rp.map((p) => p[1]);
  const vmin = Math.min(...vs), vmax = Math.max(...vs);
  const lanes: { a: Pt; b: Pt }[] = [];
  let k = 0;
  for (let v = vmin + plan.spacing / 2; v < vmax - plan.spacing * 0.25; v += plan.spacing) {
    const xs: number[] = [];
    for (let i = 0; i < rp.length; i++) {
      const [u1, v1] = rp[i], [u2, v2] = rp[(i + 1) % rp.length];
      if ((v1 <= v && v2 > v) || (v2 <= v && v1 > v)) xs.push(u1 + (v - v1) / (v2 - v1) * (u2 - u1));
    }
    xs.sort((p, q) => p - q);
    const segs: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const u0 = xs[i] + plan.margin, u1 = xs[i + 1] - plan.margin;
      if (u1 - u0 > 1) segs.push([u0, u1]);
    }
    if (k % 2 === 1) segs.reverse();
    for (const [u0, u1] of segs) {
      const a = back(k % 2 === 0 ? [u0, v] : [u1, v]), b = back(k % 2 === 0 ? [u1, v] : [u0, v]);
      lanes.push({ a, b });
    }
    if (segs.length) k++;
  }
  return lanes;
}

/** All legs from take-off point: transit → lane (spray) → transit → … → back home. */
export function planLegs(plan: MissionPlan, home: Pt): Leg[] {
  const lanes = planLanes(plan);
  const legs: Leg[] = [];
  let cur = home;
  lanes.forEach((l, i) => {
    if (Math.hypot(l.a[0] - cur[0], l.a[1] - cur[1]) > 0.3) legs.push({ a: cur, b: l.a, spray: false, lane: i });
    legs.push({ a: l.a, b: l.b, spray: true, lane: i });
    cur = l.b;
  });
  if (lanes.length) legs.push({ a: cur, b: home, spray: false, lane: lanes.length });
  return legs;
}

export interface MissionStats { areaHa: number; lanes: number; pathM: number; sprayM: number; lPerHa: number; litres: number; minutes: number; tankLoads: number }
export function missionStats(plan: MissionPlan, flowLpm: number, tankCap: number, home: Pt): MissionStats {
  const legs = planLegs(plan, home);
  let path = 0, spray = 0;
  for (const l of legs) { const d = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); path += d; if (l.spray) spray += d; }
  const lanes = legs.filter((l) => l.spray).length;
  const lPerHa = plan.speed > 0 ? flowLpm / (plan.speed * plan.spacing * 60) * 10000 : 0;
  const litres = flowLpm / 60 * spray / Math.max(plan.speed, 0.1);
  // straight flight + ~6 s per lane end (decelerate, turn, accelerate)
  const minutes = (path / Math.max(plan.speed, 0.1) + lanes * 2 * 6) / 60;
  return { areaHa: polyArea(plan.poly) / 10000, lanes, pathM: path, sprayM: spray, lPerHa, litres, minutes, tankLoads: tankCap > 0 ? Math.ceil(litres / tankCap) : 0 };
}

export type Phase = 'idle' | 'takeoff' | 'toBreak' | 'leg' | 'land' | 'done';

interface SimView { mode: number; armed: boolean; landed: boolean; x: number; y: number; agl: number; soc: number; lowBatt: number; tank: number; hasTank: boolean }

/** Runs the mission each frame and produces the AUTO guidance + automatic spray command. */
export class MissionRunner {
  legs: Leg[] = [];
  plan: MissionPlan | null = null;
  idx = 0;
  phase: Phase = 'idle';
  breakpoint: { idx: number; x: number; y: number; reason: string } | null = null;
  home: Pt = [0, 0];
  private legStart: Pt | null = null;
  private entry: Pt = [0, 0];
  private lastMode = -1;
  xte = 0; // cross-track error on spray lanes (m)
  onMessage: (text: string, bad?: boolean) => void = () => {};

  load(plan: MissionPlan | null, home: Pt) {
    this.plan = plan; this.home = home;
    this.legs = plan ? planLegs(plan, home) : [];
    this.idx = 0; this.phase = 'idle'; this.breakpoint = null; this.legStart = null; this.lastMode = -1; this.xte = 0;
  }

  get laneCount() { return this.legs.filter((l) => l.spray).length; }
  get lanesDone() { return this.legs.slice(0, this.idx).filter((l) => l.spray).length; }
  get active() { return this.phase !== 'idle' && this.phase !== 'done'; }

  step(s: SimView): { cmd: AutoCmd; spray: boolean } {
    const off = { cmd: { on: false, ax: 0, ay: 0, bx: 0, by: 0, z: 0, spd: 0 }, spray: false };
    const inAuto = s.mode === 5;
    // leaving AUTO in the middle of the job → save a breakpoint
    if (this.lastMode === 5 && !inAuto && (this.phase === 'leg' || this.phase === 'toBreak')) {
      const lowBatt = s.soc * 100 < s.lowBatt + 0.5;
      const reason = s.hasTank && s.tank <= 0.01 ? 'tank empty' : lowBatt ? 'battery low' : s.mode === 3 ? 'RTL' : 'pilot took control';
      if (this.phase === 'leg') {
        const leg = this.legs[this.idx];
        // only keep the exact point on a spray lane; in transit resume from the start of the next lane
        this.breakpoint = leg?.spray ? { idx: this.idx, x: s.x, y: s.y, reason } : { idx: this.idx, x: leg ? leg.b[0] : s.x, y: leg ? leg.b[1] : s.y, reason };
        if (leg && !leg.spray) this.breakpoint.idx = this.idx + 1;
      }
      this.phase = 'idle';
      this.onMessage(`Mission paused (${reason}) — breakpoint saved at lane ${Math.min(this.lanesDoneAt(this.breakpoint?.idx ?? this.idx) + 1, this.laneCount)}/${this.laneCount}`, reason !== 'pilot took control');
    }
    if (inAuto && this.lastMode !== 5) {
      this.entry = [s.x, s.y];
      if (!this.legs.length) this.onMessage('AUTO: no mission planned — holding position. Plan one in Mission planner.', true);
      else if (this.phase === 'done') this.onMessage('Mission already complete — Backspace resets the flight', false);
      else this.phase = 'idle';
    }
    this.lastMode = s.mode;
    if (!inAuto || !this.legs.length || this.phase === 'done') return off;
    const p = this.plan!;
    if (this.phase === 'land' && !s.armed) { this.phase = 'done'; this.onMessage('Mission complete — landed and disarmed'); return off; }
    if (!s.armed) return { cmd: { on: false, ax: s.x, ay: s.y, bx: s.x, by: s.y, z: p.height, spd: 0 }, spray: false };

    if (this.phase === 'idle') {
      this.phase = s.agl < p.height - 0.8 ? 'takeoff' : this.breakpoint ? 'toBreak' : 'leg';
      this.entry = [s.x, s.y];
      if (this.breakpoint) this.onMessage(`Resuming mission → flying to breakpoint (lane ${this.lanesDoneAt(this.breakpoint.idx) + 1})`);
      else if (this.idx === 0) this.onMessage(`Mission start: ${this.laneCount} lanes at ${p.height} m, ${p.speed} m/s`);
    }
    const cmd = (a: Pt, b: Pt, z: number, spd: number): AutoCmd => ({ on: true, ax: a[0], ay: a[1], bx: b[0], by: b[1], z, spd });

    if (this.phase === 'takeoff') {
      if (s.agl >= p.height - 0.6) { this.phase = this.breakpoint ? 'toBreak' : 'leg'; this.entry = [s.x, s.y]; }
      else return { cmd: cmd(this.entry, this.entry, p.height, 0), spray: false };
    }
    if (this.phase === 'toBreak') {
      const bp = this.breakpoint!;
      if (Math.hypot(bp.x - s.x, bp.y - s.y) < 0.8) {
        this.idx = bp.idx; this.legStart = [bp.x, bp.y]; this.breakpoint = null; this.phase = 'leg';
      } else return { cmd: cmd(this.entry, [bp.x, bp.y], p.height, Math.min(p.speed * 1.5, 7)), spray: false };
    }
    if (this.phase === 'leg') {
      const leg = this.legs[this.idx];
      if (!leg) { this.phase = 'land'; }
      else {
        const a = this.legStart ?? leg.a;
        const d = Math.hypot(leg.b[0] - s.x, leg.b[1] - s.y);
        // cross-track error for the training score / HUD
        if (leg.spray) {
          const ux = leg.b[0] - leg.a[0], uy = leg.b[1] - leg.a[1], L = Math.hypot(ux, uy) || 1;
          this.xte = Math.abs(((s.x - leg.a[0]) * uy - (s.y - leg.a[1]) * ux) / L);
        }
        if (d < 0.7) {
          this.idx++; this.legStart = null;
          if (this.idx >= this.legs.length) { this.phase = 'land'; this.onMessage('All lanes sprayed — returning to land'); }
        } else {
          const transit = !leg.spray;
          return { cmd: cmd(a, leg.b, transit && leg.lane >= this.laneCount ? Math.max(p.height, 5) : p.height, transit ? Math.min(p.speed * 1.5, 7) : p.speed), spray: leg.spray };
        }
      }
    }
    if (this.phase === 'land') return { cmd: cmd(this.home, this.home, -1, 1), spray: false };
    return off;
  }

  private lanesDoneAt(idx: number) { return this.legs.slice(0, idx).filter((l) => l.spray).length; }
}
