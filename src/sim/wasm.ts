import { P, I, O, P_OBS, OBS_MAX, OBS_STRIDE, P_SIZE, I_SIZE, O_SIZE, O_EV, EV_MAX } from './layout';
import type { DroneDef } from '../data/drones';

export interface EnvSettings {
  elev: number; temp: number; windSpd: number; windDir: number; gust: number; turb: number;
  gpsBaseSats: number; seed: number; tankFill: number; battSoc: number;
  holdAssist?: boolean; // ALT HOLD / ATTI holds position when sticks are centred
  cropH?: number; // crop canopy height over the field (m)
  crop?: string; grass?: string; // visual + radar crop type, ground cover
}

export const ENV_PRESETS: Record<string, EnvSettings> = {
  calm: { elev: 250, temp: 25, windSpd: 0, windDir: 270, gust: 0, turb: 0, gpsBaseSats: 18, seed: 1, tankFill: 1, battSoc: 1 },
  morning: { elev: 250, temp: 24, windSpd: 2.5, windDir: 270, gust: 0.3, turb: 0.4, gpsBaseSats: 17, seed: 2, tankFill: 1, battSoc: 1 },
  gusty: { elev: 250, temp: 36, windSpd: 6, windDir: 240, gust: 0.8, turb: 1.0, gpsBaseSats: 15, seed: 3, tankFill: 1, battSoc: 1 },
  poorGps: { elev: 250, temp: 30, windSpd: 3, windDir: 300, gust: 0.4, turb: 0.6, gpsBaseSats: 9, seed: 4, tankFill: 1, battSoc: 1 },
  hotHigh: { elev: 1800, temp: 38, windSpd: 4, windDir: 200, gust: 0.5, turb: 0.7, gpsBaseSats: 16, seed: 5, tankFill: 1, battSoc: 1 },
};

export interface SimInputs {
  roll: number; pitch: number; yaw: number; thr: number; mode: number;
  armSw: number; armSwEnabled: boolean; spray: boolean; rtl: boolean; rcOk: boolean;
  kill?: boolean; flow?: number; // emergency motor stop, pump flow 0..1
  auto?: AutoCmd;
  armCmd?: boolean;
}

/** Guidance for AUTO mode (mission): fly leg A→B at height z (z<0 = land) and speed spd. */
export interface AutoCmd { on: boolean; ax: number; ay: number; bx: number; by: number; z: number; spd: number }

export interface Failures { motor: number; gps: boolean; compassErrDeg: number }

export interface SimCore {
  P: Float64Array; IN: Float64Array; OUT: Float64Array;
  setup(): void; reset(): void; step(dt: number, n: number): void; service(soc: number, tankL: number): void; spawnAir(x: number, y: number, z: number, mode: number): void;
}

export async function loadSim(bytes: ArrayBuffer | Uint8Array): Promise<SimCore> {
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (_m: number, _f: number, l: number, c: number) => { throw new Error(`wasm abort ${l}:${c}`); } },
  });
  const ex = instance.exports as any;
  const mem: WebAssembly.Memory = ex.memory;
  const view = (ptr: number, n: number) => new Float64Array(mem.buffer, ptr, n);
  const core: SimCore = {
    P: view(ex.paramsPtr(), P_SIZE), IN: view(ex.inputsPtr(), I_SIZE), OUT: view(ex.outputsPtr(), O_SIZE),
    setup: () => ex.setup(), reset: () => ex.reset(), step: (dt, n) => ex.step(dt, n), service: (soc, tank) => ex.service(soc, tank), spawnAir: (x, y, z, m) => ex.spawnAir(x, y, z, m),
  };
  return core;
}

export function writeParams(core: SimCore, d: DroneDef, env: EnvSettings, home: { x: number; y: number; yaw: number }, obstacles: number[][], field?: { x0: number; x1: number; y0: number; y1: number }) {
  const p = core.P;
  p[P.FIELD_X0] = field?.x0 ?? 0; p[P.FIELD_X1] = field?.x1 ?? 0; p[P.FIELD_Y0] = field?.y0 ?? 0; p[P.FIELD_Y1] = field?.y1 ?? 0; p[P.CROP_H] = env.cropH ?? 0;
  const deg = Math.PI / 180;
  p[P.MASS_EMPTY] = d.massEmpty; p[P.TANK_CAP_L] = d.tankCap; p[P.TANK_INIT_L] = d.tankCap * env.tankFill; p[P.LIQ_DENS] = 1.0;
  p[P.N_MOTORS] = d.nMotors; p[P.COAX] = d.coax ? 1 : 0; p[P.ARM_LEN] = d.armLen; p[P.PROP_D] = d.propD;
  p[P.FMAX] = d.fmax; p[P.TAU_MOTOR] = d.tauMotor; p[P.KQ] = d.kq; p[P.YAW_AUTH] = d.yawAuth;
  p[P.RG_XY] = d.rgXY; p[P.RG_Z] = d.rgZ; p[P.CDA_XY] = d.cdaXY; p[P.CDA_Z] = d.cdaZ; p[P.KH] = d.kh;
  p[P.GEAR_W] = d.gearW; p[P.GEAR_H] = d.gearH; p[P.BODY_R] = d.bodyR; p[P.FM] = d.fm; p[P.ETA] = d.eta;
  p[P.AVIONICS_W] = d.avionicsW; p[P.PUMP_W] = d.pumpW;
  p[P.BATT_S] = d.battS; p[P.BATT_MAH] = d.battMah; p[P.BATT_R] = d.battR; p[P.BATT_CHEM] = d.battChem === 'liion' ? 1 : 0;
  p[P.BATT_INIT_SOC] = env.battSoc;
  p[P.FC_PROFILE] = d.fc === 'dji' ? 1 : 0; p[P.MAX_TILT] = d.maxTiltDeg * deg; p[P.MAX_YAWRATE] = d.maxYawRateDeg * deg;
  p[P.MAX_CLIMB] = d.maxClimb; p[P.MAX_DESC] = d.maxDesc; p[P.MAX_SPEED] = d.maxSpeed; p[P.LOIT_ACC] = d.loitAcc;
  p[P.RTL_ALT] = d.rtlAlt; p[P.LAND_SPEED] = d.landSpeed; p[P.FLOW_LPM] = d.flowLpm; p[P.MIN_SATS] = d.minSats;
  p[P.HAS_RADAR] = d.hasRadar ? 1 : 0; p[P.CRASH_VZ] = d.crashVz; p[P.LOW_BATT] = d.lowBatt; p[P.CRIT_BATT] = d.critBatt;
  p[P.RESP] = d.resp;
  p[P.SLOSH_FRAC] = d.sloshFrac; p[P.SLOSH_FREQ] = d.sloshFreq; p[P.SLOSH_ZETA] = d.sloshZeta; p[P.TANK_Z] = d.tankZ;
  p[P.ELEV] = env.elev; p[P.TEMP] = env.temp; p[P.WIND_SPD] = env.windSpd; p[P.WIND_DIR] = env.windDir;
  p[P.GUST] = env.gust; p[P.TURB] = env.turb; p[P.GPS_BASE_SATS] = env.gpsBaseSats; p[P.RTK] = d.rtk ? 1 : 0; p[P.SEED] = env.seed;
  p[P.HOLD_ASSIST] = env.holdAssist === false ? 0 : 1;
  p[P.HOME_X] = home.x; p[P.HOME_Y] = home.y; p[P.HOME_YAW] = home.yaw;
  const n = Math.min(obstacles.length, OBS_MAX);
  p[P.OBS_COUNT] = n;
  for (let k = 0; k < n; k++) for (let j = 0; j < OBS_STRIDE; j++) p[P_OBS + k * OBS_STRIDE + j] = obstacles[k][j] ?? 0;
  // live environment inputs
  core.IN[I.WIND_SPD] = env.windSpd; core.IN[I.WIND_DIR] = env.windDir; core.IN[I.GUST] = env.gust; core.IN[I.TURB] = env.turb;
}

export function writeInputs(core: SimCore, s: SimInputs, f: Failures) {
  const n = core.IN;
  n[I.ROLL] = s.roll; n[I.PITCH] = s.pitch; n[I.YAW] = s.yaw; n[I.THR] = s.thr; n[I.MODE] = s.mode;
  n[I.ARM_SW] = s.armSw; n[I.ARM_SW_EN] = s.armSwEnabled ? 1 : 0; n[I.SPRAY] = s.spray ? 1 : 0;
  n[I.RTL_SW] = s.rtl ? 1 : 0; n[I.RC_OK] = s.rcOk ? 1 : 0;
  n[I.KILL] = s.kill ? 1 : 0; n[I.FLOW] = s.flow ?? 1;
  const a = s.auto;
  n[I.AUTO_ON] = a?.on ? 1 : 0;
  n[I.ARM_CMD] = s.armCmd ? 1 : 0;
  if (a) { n[I.AUTO_AX] = a.ax; n[I.AUTO_AY] = a.ay; n[I.AUTO_BX] = a.bx; n[I.AUTO_BY] = a.by; n[I.AUTO_Z] = a.z; n[I.AUTO_SPD] = a.spd; }
  n[I.FAIL_MOTOR] = f.motor; n[I.FAIL_GPS] = f.gps ? 1 : 0; n[I.COMPASS_ERR] = f.compassErrDeg;
}

/** Returns new event codes since lastCount. */
export function drainEvents(core: SimCore, lastCount: number): { codes: number[]; count: number } {
  const count = core.OUT[O.EV_COUNT];
  const codes: number[] = [];
  for (let i = Math.max(lastCount, count - EV_MAX); i < count; i++) codes.push(core.OUT[O_EV + (i % EV_MAX)]);
  return { codes, count };
}

export const MODES = ['STABILIZE', 'ALT HOLD', 'LOITER', 'RTL', 'LAND', 'AUTO'] as const;
export const DJI_MODES = ['MANUAL', 'ATTI', 'P-GPS', 'RTH', 'LAND', 'ROUTE'] as const;

export const EVENT_TEXT: Record<number, string> = {
  1: 'ARMED', 2: 'DISARMED', 4: 'Pre-arm: throttle not low', 5: 'Pre-arm: GPS not ready',
  6: 'GPS LOST — switched to ALT HOLD, expect drift', 7: 'FAILSAFE: RC signal lost', 8: 'FAILSAFE: battery low — RTL',
  9: 'FAILSAFE: battery critical — LANDING', 10: 'CRASH', 11: 'Tank empty', 12: 'GPS OK', 13: 'Landed',
  14: 'MOTOR FAILURE', 15: 'Vortex ring state — reduce descent rate / move forward', 16: 'Pre-arm: battery too low',
  17: 'Mode denied: needs GPS', 18: 'Takeoff', 19: 'Disarm refused: still flying', 20: 'Pre-arm: reset after crash', 21: 'RC signal restored',
  22: 'EMERGENCY STOP — motors cut', 23: 'Pre-arm: emergency stop switch is ON',
};
export function eventText(code: number, modeNames: readonly string[] = MODES): string {
  if (code >= 100) return `Mode: ${modeNames[code - 100] ?? code - 100}`;
  return EVENT_TEXT[code] ?? `Event ${code}`;
}

export const CRASH_CAUSE = ['', 'Hard landing', 'Tip-over / ground strike', 'Hit pole or tree trunk', 'Hit tree canopy', 'Hit building', 'Hit power line'];
export { P, I, O };
