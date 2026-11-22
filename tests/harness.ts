import { readFileSync } from 'node:fs';
import { loadSim, writeParams, writeInputs, drainEvents, ENV_PRESETS, O, type SimCore, type SimInputs, type Failures, type EnvSettings } from '../src/sim/wasm';
import { droneById } from '../src/data/drones';
import { HOME, obstacleList } from '../src/data/world';

const bytes = readFileSync(new URL('../public/sim.wasm', import.meta.url));

export const DT = 1 / 400;

export interface Harness {
  core: SimCore; inp: SimInputs; fail: Failures; events: number[];
  run(sec: number, each?: (t: number) => void): void;
  o(k: keyof typeof O): number;
  arm(): void;
  setEnvLive(e: Partial<EnvSettings>): void;
}

export async function makeSim(droneId = 'marut_ag365h', env: Partial<EnvSettings> = {}, withObstacles = true): Promise<Harness> {
  const core = await loadSim(bytes);
  const e = { ...ENV_PRESETS.calm, ...env };
  writeParams(core, droneById(droneId), e, HOME, withObstacles ? obstacleList() : []);
  core.setup();
  const inp: SimInputs = { roll: 0, pitch: 0, yaw: 0, thr: 0, mode: 1, armSw: 0, armSwEnabled: true, spray: false, rtl: false, rcOk: true };
  const fail: Failures = { motor: 0, gps: false, compassErrDeg: 0 };
  const h: Harness = {
    core, inp, fail, events: [],
    run(sec, each) {
      const steps = Math.round(sec / DT);
      for (let i = 0; i < steps; i += 4) {
        writeInputs(core, inp, fail);
        core.step(DT, 4);
        each?.(core.OUT[O.T]);
      }
      h.events = drainEvents(core, 0).codes;
    },
    o: (k) => core.OUT[O[k]],
    arm() { inp.thr = 0; inp.armSw = 0; h.run(0.1); inp.armSw = 1; h.run(0.5); },
    setEnvLive(x) {
      const I = core.IN; const L = { WIND_SPD: 13, WIND_DIR: 14, GUST: 15, TURB: 16 };
      if (x.windSpd !== undefined) I[L.WIND_SPD] = x.windSpd;
      if (x.windDir !== undefined) I[L.WIND_DIR] = x.windDir;
    },
  };
  return h;
}

/** Arm in given mode, climb to ~alt, centre sticks. */
export function takeoff(h: Harness, mode: number, alt = 6) {
  h.inp.mode = mode;
  h.run(0.2);
  h.arm();
  h.inp.thr = 0.85;
  let guard = 0;
  while (h.o('Z') < alt && guard++ < 400) h.run(0.05);
  h.inp.thr = 0.5;
  h.run(2);
}
