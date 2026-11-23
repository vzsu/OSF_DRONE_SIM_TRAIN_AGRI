import { describe, it, expect } from 'vitest';
import { makeSim, takeoff, type Harness } from './harness';
import { LessonRunner, lessonById } from '../src/lessons/lessons';
import { droneById } from '../src/data/drones';
import type { Engine } from '../src/sim/engine';

const fakeEngine = (h: Harness) => ({ o: h.o, fail: h.fail, rcLost: false, paused: false, drone: droneById('marut_ag365h') }) as unknown as Engine;
const clamp = (v: number) => Math.max(-0.6, Math.min(0.6, v));

/** stick autopilot toward (x, y, z) — the drone faces north at start, so pitch = north, roll = east */
function steer(h: Harness, x: number, y: number, z: number) {
  h.inp.pitch = clamp((y - h.o('Y')) * 0.07 - h.o('VY') * 0.1); h.inp.roll = clamp((x - h.o('X')) * 0.07 - h.o('VX') * 0.1);
  h.inp.thr = Math.max(0.2, Math.min(0.8, 0.5 + (z - h.o('Z')) * 0.15));
}

describe('lessons', () => {
  it('lesson 1 (take-off, hover box, land) passes when flown correctly', async () => {
    const h = await makeSim('marut_ag365h');
    const L = new LessonRunner(); const e = fakeEngine(h);
    L.start(lessonById('hover'), e, false);
    let done = 0; L.onObjectiveDone = () => done++;
    takeoff(h, 2, 3.2);
    for (let i = 0; i < 40 * 20; i++) { steer(h, 0, 4, 3); h.run(0.05); L.update(e, 0.05); if (L.objectives[1].done) break; }
    expect(L.objectives[0].done && L.objectives[1].done).toBe(true);
    h.inp.pitch = 0; h.inp.roll = 0; h.inp.thr = 0.5; h.inp.mode = 4; // LAND → auto-disarm
    for (let i = 0; i < 40 * 20 && !L.result; i++) { h.run(0.05); L.update(e, 0.05); }
    expect(L.result?.passed).toBe(true);
    expect(done).toBe(3);
  }, 60000);

  it('a crash fails the lesson', async () => {
    const h = await makeSim('marut_ag365h');
    const L = new LessonRunner(); const e = fakeEngine(h);
    L.start(lessonById('box'), e, false);
    takeoff(h, 0, 6);
    h.inp.thr = 0.05; // cut power in STABILIZE
    for (let i = 0; i < 200 && !L.result; i++) { h.run(0.05); L.update(e, 0.05); }
    expect(L.result?.passed).toBe(false);
    expect(L.result?.reason).toMatch(/Crash/);
  }, 60000);
});
