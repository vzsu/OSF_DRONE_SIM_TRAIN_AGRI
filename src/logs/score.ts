// Training assessment from a flight log: the measurements an agri-drone instructor checks
// (spray quality, height/speed discipline, stick smoothness, landings, obstacle clearance,
// battery discipline, emergency handling). Each item 0–100, weighted into a total grade.
import { column, type FlightLog } from './recorder';
import { obstacleList, overCrowd, CROWD, WORLD, fenceBreach } from '../data/world';
import type { CoverageStats } from '../sim/coverage';

export interface ScoreItem { key: string; name: string; value: string; score: number; weight: number; hint: string }
export interface ScoreReport { total: number; grade: string; items: ScoreItem[] }
export interface TrainingData { score: ScoreReport; coverage?: CoverageStats & { img: string }; mission?: { lanes: number; lanesDone: number; height: number; speed: number } }

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const std = (a: number[]) => { if (a.length < 2) return 0; const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

/** Distance from a point to the nearest obstacle surface (same shapes as the physics). */
function clearance(x: number, y: number, z: number, obs: number[][]): number {
  let best = Infinity;
  for (const o of obs) {
    const [t, a1, a2, a3, a4, a5, a6, a7] = o;
    let d = Infinity;
    if (t === 1) { const h = z < a3 ? a3 - z : z > a3 + a5 ? z - a3 - a5 : 0; d = Math.hypot(Math.max(Math.hypot(x - a1, y - a2) - a4, 0), h); }
    else if (t === 2) d = Math.hypot(x - a1, y - a2, z - a3) - a4;
    else if (t === 3) d = Math.hypot(Math.max(Math.abs(x - a1) - a4, 0), Math.max(Math.abs(y - a2) - a5, 0), Math.max(Math.abs(z - a3) - a6, 0));
    else if (t === 4) {
      const sx = a4 - a1, sy = a5 - a2, sz = a6 - a3, l2 = sx * sx + sy * sy + sz * sz;
      const u = clamp(l2 > 0 ? ((x - a1) * sx + (y - a2) * sy + (z - a3) * sz) / l2 : 0, 0, 1);
      d = Math.hypot(x - a1 - u * sx, y - a2 - u * sy, z - a3 - u * sz) - a7;
    }
    if (d < best) best = d;
  }
  return best;
}

export function scoreFlight(log: FlightLog, cov: CoverageStats | null, plan: { height: number; speed: number } | null, bodyR: number): ScoreReport {
  const n = log.rows;
  const items: ScoreItem[] = [];
  const add = (key: string, name: string, value: string, score: number, weight: number, hint: string) => items.push({ key, name, value, score: Math.round(clamp(score)), weight, hint });
  if (n < 50) return { total: 0, grade: '—', items };
  const t = column(log, 't'), agl = column(log, 'agl'), gs = column(log, 'gnd_speed'), spr = column(log, 'spraying');
  const armed = column(log, 'armed'), vz = column(log, 'vz'), roll = column(log, 'roll'), pitch = column(log, 'pitch');
  const rr = column(log, 'rc_roll'), rp = column(log, 'rc_pitch'), soc = column(log, 'batt_soc'), mode = column(log, 'mode');
  const x = column(log, 'x'), y = column(log, 'y'), z = column(log, 'z');
  const crashed = log.summary.result === 'Crash';

  // 1. spray height discipline (manual or AUTO): std-dev of height while spraying
  const sprH: number[] = [], sprV: number[] = [];
  for (let i = 0; i < n; i++) if (spr[i] > 0.5) { sprH.push(agl[i]); if (gs[i] > 0.8) sprV.push(gs[i]); }
  if (sprH.length > 100) {
    const sd = std(sprH), mean = sprH.reduce((s, v) => s + v, 0) / sprH.length;
    const off = plan ? Math.abs(mean - plan.height) : 0;
    add('height', 'Spray height hold', `${mean.toFixed(1)} m ±${sd.toFixed(2)}`, 100 - sd * 70 - off * 25, 2, 'Keep a constant 2–3 m above the crop: higher = drift, lower = poor coverage and crop damage.');
    const vm = sprV.reduce((s, v) => s + v, 0) / Math.max(sprV.length, 1), cv = std(sprV) / Math.max(vm, 0.1);
    add('speed', 'Spray speed consistency', `${vm.toFixed(1)} m/s ±${(cv * 100).toFixed(0)}%`, 100 - cv * 220, 2, 'Constant ground speed = constant dose (L/ha). Speed changes mean under- or over-dosing.');
  }
  // 2. coverage quality
  if (cov && cov.sprayedM2 > 20) {
    if (cov.targetM2 > 0) {
      add('coverage', 'Area coverage', `${cov.coveredPct.toFixed(0)}%`, cov.coveredPct, 3, 'Fraction of the planned area that received spray. Missed strips = untreated crop.');
      add('overlap', 'Overlap (double dose)', `${cov.overlapPct.toFixed(0)}%`, 100 - cov.overlapPct * 2.5, 2, 'Keep lane spacing equal to the swath. Overlap wastes chemical and can burn the crop.');
    }
    const offPct = cov.offTargetM2 / Math.max(cov.sprayedM2, 1) * 100;
    add('drift', 'Off-target spray / drift', `${cov.offTargetM2.toFixed(0)} m² (${offPct.toFixed(0)}%)`, 100 - offPct * 4, 2, 'Pump off before leaving the field; fly lower or stop when wind is high.');
  }
  // 3. stick smoothness: full-stick reversals (> 1.4 change within 0.4 s)
  let reversals = 0, aggr = 0;
  const win = 20; // 0.4 s at 50 Hz
  for (let i = win; i < n; i++) {
    if (armed[i] < 0.5) continue;
    if (Math.abs(rr[i] - rr[i - win]) > 1.4 || Math.abs(rp[i] - rp[i - win]) > 1.4) { reversals++; i += win; }
  }
  let maxTilt = 0;
  for (let i = 0; i < n; i++) if (armed[i] > 0.5) { const tl = Math.hypot(roll[i], pitch[i]) * 57.3; maxTilt = Math.max(maxTilt, tl); if (tl > 20) aggr++; }
  const fm = log.summary.flightTime / 60 || 1;
  add('smooth', 'Smooth stick control', `${reversals} full reversals, max tilt ${maxTilt.toFixed(0)}°`, 100 - reversals / fm * 12 - aggr / 50 / fm * 5, 2, 'Heavy agri drones need small, early inputs. Full-stick reversals overshoot and slosh the tank.');
  // 4. landings: vertical speed at touchdown
  const tds: number[] = [];
  for (const e of log.events) if (e.code === 13) {
    let i = Math.min(n - 1, Math.round((e.t - t[0]) * 50)), w = 0;
    for (let k = Math.max(0, i - 50); k <= i; k++) w = Math.min(w, vz[k]);
    tds.push(-w);
  }
  if (tds.length) {
    const worst = Math.max(...tds);
    add('landing', 'Landing softness', `${worst.toFixed(2)} m/s worst touchdown (${tds.length} landings)`, crashed && log.summary.crashCause === 1 ? 0 : 110 - worst * 60, 2, 'Touch down below 0.7 m/s. Above ~3 m/s the gear breaks.');
  }
  // 5. obstacle clearance
  const obs = obstacleList();
  let minClr = Infinity;
  for (let i = 0; i < n; i += 5) if (armed[i] > 0.5 && z[i] > 0.6) minClr = Math.min(minClr, clearance(x[i], y[i], z[i], obs) - bodyR);
  if (Number.isFinite(minClr)) add('clearance', 'Obstacle clearance', `${Math.max(minClr, 0).toFixed(1)} m closest`, crashed && log.summary.crashCause >= 3 ? 0 : minClr * 20, 2, 'Keep at least 5 m from trees, poles and power lines (rotor wash + GPS error).');
  // 5b. wedding / events: never over people
  if (CROWD.length) {
    let over = 0;
    for (let i = 0; i < n; i++) if (armed[i] > 0.5 && z[i] > 0.5 && overCrowd(x[i], y[i], 2)) over++;
    const sec = over / 50;
    add('crowd', 'Flight over people', `${sec.toFixed(1)} s over guests`, 100 - sec * 15, 3, 'Never fly over the guests (DGCA rules). Frame shots from the side, keep 5+ m horizontal distance.');
  }
  // 5c. stay inside the fly area (geofence)
  if (WORLD.geofence && WORLD.geofence.length > 2) {
    let out = 0, worst = 0;
    for (let i = 0; i < n; i++) if (armed[i] > 0.5) { const b = fenceBreach(x[i], y[i]); if (b > 0) { out++; worst = Math.max(worst, b); } }
    add('fence', 'Inside the fly area', out ? `${(out / 50).toFixed(1)} s outside (max ${worst.toFixed(1)} m)` : 'always inside', 100 - out / 50 * 10 - worst * 5, 2, 'Stay inside the area the farmer / client allowed. > 3 m outside triggers an automatic return home.');
  }
  // 6. battery discipline
  let landSoc = soc[n - 1];
  for (let i = n - 1; i > 0; i--) if (armed[i] > 0.5) { landSoc = soc[i]; break; }
  const low = log.header.drone.lowBatt, crit = log.header.drone.critBatt;
  add('battery', 'Battery reserve at landing', `${(landSoc * 100).toFixed(0)}%`, landSoc * 100 >= low ? 100 : landSoc * 100 >= crit ? 60 : 20, 1, `Land with ≥ ${low}% (low-battery failsafe). Below ${crit}% the voltage can collapse.`);
  // 7. emergency handling: after a failure event, was the drone landed without crashing?
  const em = log.events.filter((e) => [6, 7, 14, 15].includes(e.code));
  if (em.length) add('emergency', 'Emergency handling', `${em.length} emergencies`, crashed ? 10 : 100, 2, 'GPS loss: switch to ALT HOLD and fly by attitude. Motor fail: land immediately. VRS: move forward, don\'t add power.');
  // 8. AUTO usage share (information only, no weight)
  const autoShare = mode.reduce((s, v, i) => s + (v === 5 && armed[i] > 0.5 ? 1 : 0), 0) / Math.max(armed.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0), 1);
  if (autoShare > 0.01) add('auto', 'Time in AUTO (mission)', `${(autoShare * 100).toFixed(0)}%`, 100, 0, 'Manual spraying scores height/speed skill; AUTO missions score planning and supervision.');

  const wsum = items.reduce((s, i) => s + i.weight, 0) || 1;
  let total = items.reduce((s, i) => s + i.score * i.weight, 0) / wsum;
  if (crashed) total = Math.min(total, 30);
  total = Math.round(total);
  const grade = crashed ? 'FAIL (crash)' : total >= 85 ? 'A — checkride ready' : total >= 70 ? 'B — good' : total >= 55 ? 'C — needs practice' : 'D — repeat lesson';
  return { total, grade, items };
}
