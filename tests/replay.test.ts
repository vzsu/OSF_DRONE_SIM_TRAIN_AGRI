// Replays a real flight log (stick stream + same environment seed) through the physics.
// Run: REPLAY=f123... npx vitest run tests/replay.test.ts
import { it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { loadSim, writeParams, writeInputs, O } from '../src/sim/wasm';
import { HOME, obstacleList } from '../src/data/world';

const id = process.env.REPLAY;
it.skipIf(!id)('replay log', async () => {
  const path = `data/logs/${id}.json`;
  if (!existsSync(path)) throw new Error('no log ' + path);
  const l = JSON.parse(readFileSync(path, 'utf8'));
  const b = Buffer.from(l.dataB64, 'base64');
  const d = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  const w = l.cols.length, c = (n: string) => l.cols.indexOf(n);
  const core = await loadSim(readFileSync('public/sim.wasm'));
  writeParams(core, l.header.drone, l.header.env, HOME, obstacleList());
  core.setup();
  const from = Number(process.env.FROM ?? 0), to = Number(process.env.TO ?? 1e9);
  for (let i = 0; i < l.rows; i++) {
    const r = (k: string) => d[i * w + c(k)];
    writeInputs(core, { roll: r('rc_roll'), pitch: r('rc_pitch'), yaw: r('rc_yaw'), thr: r('rc_thr'), mode: r('mode'), armSw: r('armed'), armSwEnabled: true, spray: false, rtl: false, rcOk: true }, { motor: 0, gps: false, compassErrDeg: 0 });
    core.step(1 / 400, 8);
    const o = (k: keyof typeof O) => core.OUT[O[k]];
    const t = o('T');
    if (t >= from && t <= to && i % 5 === 0) {
      console.log([t, o('Z'), o('ROLL') * 57.3, o('PITCH') * 57.3, o('P'), o('Q'), o('SLOSH_X'), o('SLOSH_Y'), o('WIND_X'), o('WIND_Y'), o('THR_OUT'), o('ON_GROUND'), o('LANDED'), o('M0'), o('M3')].map((v) => v.toFixed(2).padStart(7)).join(' '), '| log roll', (r('roll') * 57.3).toFixed(1));
    }
  }
});
