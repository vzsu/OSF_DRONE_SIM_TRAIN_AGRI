import { describe, it, expect } from 'vitest';
import { makeSim, type Harness } from './harness';
import { LessonRunner, lessonById } from '../src/lessons/lessons';
import { BASICS } from '../src/lessons/basics';
import { droneById } from '../src/data/drones';
import type { Engine } from '../src/sim/engine';

/** Minimal engine adapter over the headless harness. */
function adapter(h: Harness) {
  let armPulse = 0;
  const e = {
    o: h.o, fail: h.fail, rcLost: false, paused: false, drone: droneById('marut_ag365h'), core: h.core,
    sticks: { roll: 0, pitch: 0, yaw: 0, thr: 0, modePos: 2 },
    requestArm: () => { armPulse = 6; },
  };
  return { e: e as unknown as Engine, raw: e, tickArm: () => { h.inp.armCmd = armPulse > 0; if (armPulse > 0) armPulse--; } };
}

describe('beginner course: every demo passes its own exercise', () => {
  for (const def of BASICS) {
    it(`${def.n}. ${def.title}`, async () => {
      const h = await makeSim('marut_ag365h');
      h.inp.armSwEnabled = false; h.inp.mode = 2;
      const { e, raw, tickArm } = adapter(h);
      const L = new LessonRunner();
      L.start(lessonById(def.id), e, false);
      L.demo = true;
      const dt = 0.05;
      for (let i = 0; i < def.timeLimit / dt && !L.result; i++) {
        const s = L.basic!.demo(e, dt);
        Object.assign(raw.sticks, s);
        h.inp.roll = s.roll ?? 0; h.inp.pitch = s.pitch ?? 0; h.inp.yaw = s.yaw ?? 0; h.inp.thr = s.thr ?? 0.5;
        tickArm();
        h.run(dt);
        L.update(e, dt);
      }
      if (!L.result?.passed) console.log(def.id, JSON.stringify(L.result), JSON.stringify(L.objectives.map((o) => [o.done, +o.progress.toFixed(2)])), h.o('X').toFixed(1), h.o('Y').toFixed(1), h.o('Z').toFixed(1), h.o('ARMED'));
      expect(L.result?.passed).toBe(true);
    }, 120000);
  }
});
