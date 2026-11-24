import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Gimbal } from '../src/render/gimbal';

const DEG = Math.PI / 180;
/** aircraft attitude in three.js: heading h (0 = east, CCW+), pitch (nose down +), roll (right down +) */
function droneQ(hDeg: number, pitchDeg = 0, rollDeg = 0) {
  // body: x fwd, y up, z right-ish; compose yaw about Y, then pitch about body Z, roll about body X
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rollDeg * DEG, hDeg * DEG, -pitchDeg * DEG, 'YZX'));
}
const fwd = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, -1).applyQuaternion(q);
const up = (q: THREE.Quaternion) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);
const run = (g: Gimbal, q: THREE.Quaternion, sec: number, pos = new THREE.Vector3(0, 20, 0)) => { for (let t = 0; t < sec; t += 1 / 60) g.update(q, pos, 1 / 60); return g.q; };
const headingOf = (v: THREE.Vector3) => Math.atan2(-v.z, v.x) / DEG;

describe('DJI camera gimbal', () => {
  it('follow: horizon stays level and tilt is held while the aircraft pitches and rolls hard', () => {
    const g = new Gimbal(); g.setTilt(-15);
    for (const [p, r] of [[25, 0], [-20, 15], [10, -25], [30, 30]]) {
      const q = run(g, droneQ(40, p, r), 3);
      const u = up(q), f = fwd(q);
      expect(Math.abs(new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize().dot(u))).toBeLessThan(1e-6); // no roll
      expect(Math.asin(f.y) / DEG).toBeCloseTo(-15, 1);           // tilt unchanged by aircraft pitch
      expect(headingOf(f)).toBeCloseTo(40, 0);                     // pan follows the aircraft heading
    }
  });
  it('tilt moves smoothly at the gimbal rate — never jumps, no overshoot', () => {
    const g = new Gimbal(); run(g, droneQ(0), 1); g.setTilt(-90);
    run(g, droneQ(0), 0.1);
    expect(g.tilt).toBeGreaterThan(-25);              // after 0.1 s it has only just started
    let min = 0; for (let t = 0; t < 4; t += 1 / 60) { g.update(droneQ(0), new THREE.Vector3(0, 20, 0), 1 / 60); min = Math.min(min, g.tilt); }
    expect(g.tilt).toBeCloseTo(-90, 1);
    expect(min).toBeGreaterThanOrEqual(-90.5);         // no overshoot past the stop
  });
  it('pan follows a yaw turn smoothly (no snap)', () => {
    const g = new Gimbal(); run(g, droneQ(0), 1);
    run(g, droneQ(90), 0.1);
    expect(headingOf(fwd(g.q))).toBeLessThan(45);       // lags behind the aircraft
    run(g, droneQ(90), 2);
    expect(headingOf(fwd(g.q))).toBeCloseTo(90, 0);
  });
  it('track: camera stays on the subject; aircraft is asked to yaw toward it', () => {
    const g = new Gimbal(); const pos = new THREE.Vector3(0, 15, 0);
    g.target = new THREE.Vector3(30, 0, -20); g.mode = 'track';
    const q = run(g, droneQ(Math.atan2(20, 30) / DEG + 10), 2, pos);   // nose 10° off the subject
    const want = g.target.clone().sub(pos).normalize();
    expect(fwd(q).angleTo(want) / DEG).toBeLessThan(1);                // subject centred
    expect(g.aircraftYawError(droneQ(Math.atan2(20, 30) / DEG + 10), pos) / DEG).toBeCloseTo(-10, 0);
    // subject behind the aircraft: gimbal stops at its pan limit, aircraft must turn
    const qb = run(g, droneQ(Math.atan2(20, 30) / DEG + 150), 2, pos);
    expect(fwd(qb).angleTo(want) / DEG).toBeGreaterThan(30);
  });
  it('lock on centre picks the ground point in the middle of the picture', () => {
    const g = new Gimbal(); g.setTilt(-45); const pos = new THREE.Vector3(0, 20, 0);
    run(g, droneQ(0), 3, pos);
    g.lockOnCentre(pos, new THREE.Vector3());
    expect(g.mode).toBe('track');
    expect(g.target!.y).toBeCloseTo(0, 3);
    expect(g.target!.x).toBeCloseTo(20, 0); // 45° down from 20 m → 20 m ahead (east)
  });
  it('fpv: camera rolls with the aircraft', () => {
    const g = new Gimbal(); g.mode = 'fpv';
    const q = run(g, droneQ(0, 0, 20), 2);
    const f = fwd(q), u = up(q), right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
    expect(Math.abs(Math.asin(right.dot(u)) / DEG)).toBeCloseTo(20, 0);
  });
});

import { makeSim } from './harness';

describe('track mode through the flight physics (Spotlight)', () => {
  it('Mavic 3 Pro strafing past a subject keeps it centred in frame', async () => {
    const h = await makeSim('dji_mavic3pro', { windSpd: 3, turb: 0.4, gust: 0.3 });
    h.inp.mode = 2; h.run(0.2); h.arm(); h.inp.thr = 0.8;
    while (h.o('Z') < 12) h.run(0.05);
    h.inp.thr = 0.5; h.run(2);
    const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
    const g = new Gimbal(); g.target = toThree(h.o('X') + 25, h.o('Y') + 10, 0); g.mode = 'track';
    let worst = 0;
    for (let i = 0; i < 25 * 20; i++) {
      const q = new THREE.Quaternion(h.o('QX'), h.o('QZ'), -h.o('QY'), h.o('QW'));
      const pos = toThree(h.o('X'), h.o('Y'), h.o('Z'));
      g.update(q, pos, 0.05);
      h.inp.yaw = Math.max(-0.6, Math.min(0.6, -g.aircraftYawError(q, pos) * 1.4)); // same law as main.ts
      h.inp.roll = 0.5; // pilot strafes right the whole time
      h.run(0.05);
      if (i > 60) worst = Math.max(worst, new THREE.Vector3(0, 0, -1).applyQuaternion(g.q).angleTo(g.target!.clone().sub(pos)) / DEG);
    }
    expect(h.o('CRASHED')).toBe(0);
    expect(worst).toBeLessThan(4); // subject never leaves the middle of the frame
  }, 60000);
});
