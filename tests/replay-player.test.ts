import { describe, it, expect } from 'vitest';
import { makeSim } from './harness';
import { ReplayPlayer } from '../src/replay/player';
import { Recorder, COLS } from '../src/logs/recorder';
import { droneById } from '../src/data/drones';

describe('replay player', () => {
  it('rebuilds the attitude quaternion the physics produced and interpolates position', async () => {
    const h = await makeSim('marut_ag365h');
    h.inp.mode = 2; h.arm();
    const rec = new Recorder({ schema: 1, simVersion: 't', id: 'f1234567890', trainee: 't', startedAt: '', drone: droneById('marut_ag365h'), env: {} as never, controller: 'k', linkDelayMs: 0 });
    const qs: number[][] = [];
    for (let i = 0; i < 400; i++) {
      h.inp.thr = i < 150 ? 0.8 : 0.5; h.inp.roll = i > 200 ? 0.6 : 0; h.inp.yaw = i > 250 ? 0.5 : 0;
      h.run(0.02);
      const o = (k: string) => h.o(k as never);
      const row = COLS.map((c) => ({ t: o('T'), x: o('X'), y: o('Y'), z: o('Z'), roll: o('ROLL'), pitch: o('PITCH'), yaw: o('YAW'), armed: o('ARMED') } as Record<string, number>)[c] ?? 0);
      rec.add(row); qs.push([o('QW'), o('QX'), o('QY'), o('QZ')]);
    }
    const p = new ReplayPlayer(rec.finish('Completed', 0, 8));
    for (const i of [120, 260, 390]) {
      p.seek(p.log.rows && new Float32Array(p.log.data)[i * COLS.length]);
      const q = ['QW', 'QX', 'QY', 'QZ'].map((k) => p.fake.o(k as never));
      const dot = Math.abs(q.reduce((s, v, j) => s + v * qs[i][j], 0));
      expect(dot).toBeGreaterThan(0.9999);
    }
    p.seek(0); p.playing = true; p.step(1);
    expect(p.t).toBeCloseTo(1, 5);
    expect(p.fake.o('Z' as never)).toBeGreaterThan(0);
  });
});
