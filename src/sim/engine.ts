// Real-time loop: input sampling → (optional link delay) → fixed-step WASM physics at 400 Hz → 50 Hz log.
import { loadSim, writeParams, writeInputs, drainEvents, eventText, MODES, DJI_MODES, O, I, type SimCore, type Failures, type EnvSettings } from './wasm';
import { droneById, type DroneDef } from '../data/drones';
import { HOME, obstacleList, WORLD, FIELD } from '../data/world';
import { BatteryBay } from './batteries';
import { cropById } from '../data/crops';
import { MissionRunner } from './mission';
import { Coverage, GRID } from './coverage';
import { scoreFlight } from '../logs/score';
import { readSticks, usingSwitchArm, activePad, type Sticks } from '../input/input';
import { settings, profileFor } from '../settings';
import { currentUser } from '../auth/client';
import { Recorder, LOG_SCHEMA, type FlightLog } from '../logs/recorder';

export const DT = 1 / 400;
const LOG_DT = 1 / 50;
export const SIM_VERSION = '0.1.0';

let wasmBytes: ArrayBuffer | null = null;

export class Engine {
  core!: SimCore;
  drone!: DroneDef;
  env!: EnvSettings;
  fail: Failures = { motor: 0, gps: false, compassErrDeg: 0 };
  rcLost = false;
  paused = false;
  sticks: Sticks = readSticks(false);
  private acc = 0;
  private lastFrame = 0;
  private queue: { t: number; s: Sticks }[] = [];
  private evCount = 0;
  private nextLog = 0;
  recorder!: Recorder;
  frameMs = 16;
  mission = new MissionRunner();
  bay = new BatteryBay();
  /** ground-station mode override (5 AUTO, 2 hold/pause, 3 RTH); null = the RC mode switch decides */
  gcsMode: number | null = null;
  private armCmdFrames = 0;
  private lastModePos = -1;
  /** take-off / resume request from the ground station: pulse the arm command for a few frames */
  requestArm() { this.armCmdFrames = 6; }
  /** guided point (auto take-off of camera drones): AUTO holds this point/height until cleared */
  guided: { x: number; y: number; z: number } | null = null;
  /** lesson demo: scripted stick inputs replace the pilot's (the HUD stick monitor shows them) */
  demoSticks: ((t: number) => Partial<Sticks>) | null = null;
  /** Spotlight / track: the FC yaws the aircraft to keep the subject in the gimbal's range (only while the pilot is not yawing) */
  yawAssist: number | null = null;
  coverage = new Coverage();
  /** RC reset button (rising edge) → restart on the pad */
  onResetRequest: () => void = () => {};
  private resetPrev = false;
  onEvent: (code: number, text: string) => void = () => {};

  async init() {
    if (!wasmBytes) wasmBytes = await (await fetch("/sim.wasm")).arrayBuffer();
    this.core = await loadSim(wasmBytes);
  }

  modeNames(): readonly string[] { return this.drone.fc === 'dji' ? DJI_MODES : MODES; }

  start(droneId: string, env: EnvSettings) {
    this.drone = droneById(droneId);
    this.env = { ...env, seed: Math.floor(Math.random() * 1e6) };
    this.env.cropH = WORLD.category === 'agri' ? cropById(env.crop).height : 0;
    writeParams(this.core, this.drone, this.env, HOME, obstacleList(), FIELD);
    this.bay.reset(env.battSoc, env.temp, settings.chargeMinutes ?? 6);
    this.gcsMode = null; this.armCmdFrames = 0; this.lastModePos = -1; this.guided = null;
    this.core.setup();
    this.fail = { motor: 0, gps: false, compassErrDeg: 0 };
    this.rcLost = false; this.paused = false; this.acc = 0; this.lastFrame = 0; this.queue = [];
    this.evCount = 0; this.nextLog = 0;
    const pad = activePad();
    this.mission.load(settings.mission.poly.length >= 3 ? settings.mission : null, [HOME.x, HOME.y]);
    this.coverage.reset();
    this.coverage.setTarget(settings.mission.poly.length >= 3 ? settings.mission.poly : []);
    this.recorder = new Recorder({
      schema: LOG_SCHEMA, simVersion: SIM_VERSION, id: `f${Date.now()}${Math.random().toString(36).slice(2, 7)}`, trainee: currentUser?.name || settings.trainee || 'Trainee', userId: currentUser?.id,
      startedAt: new Date().toISOString(), drone: this.drone, env: this.env,
      controller: pad ? pad.id : 'Keyboard', linkDelayMs: settings.latency.linkMs,
      place: `${WORLD.category}: ${WORLD.name}`,
    });
  }

  /** Change wind live (instructor / pause menu). */
  setWind(spd: number, dir: number, gust: number, turb: number) {
    const n = this.core.IN;
    n[I.WIND_SPD] = spd; n[I.WIND_DIR] = dir; n[I.GUST] = gust; n[I.TURB] = turb;
    this.env.windSpd = spd; this.env.windDir = dir; this.env.gust = gust; this.env.turb = turb;
  }

  o(k: keyof typeof O): number { return this.core.OUT[O[k]]; }

  frame(now: number) {
    const dtReal = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0;
    this.lastFrame = now;
    this.frameMs += (dtReal * 1000 - this.frameMs) * 0.05;
    const armed = this.o('ARMED') > 0.5;
    const s = readSticks(armed);
    this.queue.push({ t: now, s });
    // link delay: use the newest sample that is at least linkMs old
    const delay = settings.latency.linkMs;
    let use = this.queue[0].s;
    while (this.queue.length > 1 && now - this.queue[1].t >= delay) this.queue.shift();
    use = this.queue[0].s;
    if (delay <= 0) { use = s; this.queue = [this.queue[this.queue.length - 1]]; }
    if (this.demoSticks) use = { ...use, ...this.demoSticks(this.o('T')), ok: true };
    if (this.yawAssist !== null && Math.abs(use.yaw) < 0.05) use = { ...use, yaw: this.yawAssist };
    this.sticks = use;
    if (use.reset && !this.resetPrev) { this.resetPrev = true; this.onResetRequest(); return; }
    this.resetPrev = use.reset;
    if (this.paused) return;

    const pad = activePad();
    const prof = pad ? profileFor(pad.id) : null;
    const modePositions = prof ? prof.modePositions : ([0, 1, 2] as const);
    const o = (k: keyof typeof O) => this.core.OUT[O[k]];
    const agl = o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z');
    const g = this.guided;
    const ms = g ? { cmd: { on: true, ax: g.x, ay: g.y, bx: g.x, by: g.y, z: g.z, spd: 0 }, spray: false } : this.mission.step({
      mode: o('MODE'), armed: o('ARMED') > 0.5, landed: o('LANDED') > 0.5, x: o('EST_X'), y: o('EST_Y'), agl,
      soc: o('BATT_SOC'), lowBatt: this.drone.lowBatt, tank: o('TANK_L'), hasTank: this.drone.tankCap > 0,
    });
    const inAuto = o('MODE') === 5;
    // moving the RC mode switch always takes control back from the ground station
    if (this.lastModePos >= 0 && use.modePos !== this.lastModePos && this.gcsMode !== null) { this.gcsMode = null; this.guided = null; this.onEvent(950, 'Manual control: mode switch moved'); }
    this.lastModePos = use.modePos;
    const armCmd = this.armCmdFrames > 0; if (armCmd) this.armCmdFrames--;
    writeInputs(this.core, {
      roll: use.roll, pitch: use.pitch, yaw: use.yaw, thr: use.thr,
      mode: this.gcsMode ?? (use.modePos === 3 ? 5 : (modePositions[use.modePos] ?? 1)), armCmd,
      armSw: use.arm, armSwEnabled: usingSwitchArm(), spray: inAuto ? ms.spray : use.spray, rtl: use.rtl, rcOk: use.ok && !this.rcLost,
      kill: use.kill, flow: use.flow, auto: ms.cmd,
    }, this.fail);

    this.acc += dtReal;
    let steps = Math.floor(this.acc / DT);
    this.acc -= steps * DT;
    while (steps > 0) {
      const tNow = this.o('T');
      const toLog = Math.max(1, Math.ceil((this.nextLog - tNow) / DT));
      const n = Math.min(steps, toLog);
      this.core.step(DT, n);
      steps -= n;
      if (this.o('T') >= this.nextLog - 1e-9) { this.log(use); this.nextLog += LOG_DT; }
    }
    this.bay.tick(dtReal, o('BATT_SOC'), o('BATT_I'));
    this.coverage.update(o('SPRAYING') > 0.5, o('X'), o('Y'), agl, o('WIND_X'), o('WIND_Y'), this.swath());
    const ev = drainEvents(this.core, this.evCount);
    this.evCount = ev.count;
    for (const c of ev.codes) {
      const text = eventText(c, this.modeNames());
      this.recorder.event(this.o('T'), c, text);
      this.onEvent(c, text);
    }
  }

  /** Effective spray swath: the mission lane spacing for agri drones (what the operator configured). */
  swath(): number { return settings.mission.spacing || 4; }

  /** Ground service: move a battery pack (drone / charger / ground). Drone must be landed + disarmed. */
  movePack(id: string, to: 'drone' | 'charger' | 'ground'): string {
    const p = this.bay.packs.find((x) => x.id === id);
    if (!p) return 'No such pack';
    const touchesDrone = to === 'drone' || p.place === 'drone';
    if (touchesDrone && this.o('ARMED') > 0.5) return 'Land and disarm before touching the drone battery';
    if (to === 'drone' && p.soc < this.drone.lowBatt / 100 + 0.05) return `Pack ${id} is only ${Math.round(p.soc * 100)}% — charge it first`;
    const err = this.bay.move(id, to);
    if (err) return err;
    const inD = this.bay.inDrone;
    this.core.service(inD ? inD.soc : 0, this.o('TANK_L'));
    this.recorder.event(this.o('T'), 900, inD ? `Battery ${inD.id} installed (${Math.round(inD.soc * 100)}%)` : `Battery ${id} removed`);
    return '';
  }

  /** Refill the spray tank (landed + disarmed). */
  refillTank(): string {
    if (this.o('ARMED') > 0.5) return 'Land and disarm before refilling';
    if (this.drone.tankCap <= 0) return 'This drone has no spray tank';
    const inD = this.bay.inDrone;
    this.core.service(inD ? inD.soc : 0, this.drone.tankCap);
    this.recorder.event(this.o('T'), 901, 'Tank refilled');
    return '';
  }

  /** Quick service (key B legacy): swap in the fullest spare pack and refill. */
  service(): boolean {
    if (this.o('ARMED') > 0.5) return false;
    const cur = this.bay.inDrone;
    const best = this.bay.packs.filter((p) => p.place !== 'drone').sort((a, b) => b.soc - a.soc)[0];
    if (cur) { const e = this.bay.move(cur.id, this.bay.onCharger ? 'ground' : 'charger'); if (e) return false; }
    if (best) this.movePack(best.id, 'drone');
    if (this.drone.tankCap > 0) this.refillTank();
    return true;
  }

  private log(s: Sticks) {
    const o = (k: keyof typeof O) => this.core.OUT[O[k]];
    const agl = o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z');
    this.recorder.add([
      o('T'), s.roll, s.pitch, s.yaw, s.thr, o('MODE'), o('ARMED'), o('X'), o('Y'), o('Z'), o('VX'), o('VY'), o('VZ'),
      o('ROLL'), o('PITCH'), o('YAW'), o('P'), o('Q'), o('R'), o('BATT_V'), o('BATT_I'), o('BATT_SOC'), o('BATT_MAH_USED'),
      o('TANK_L'), o('SPRAYING'), o('WIND_X'), o('WIND_Y'), o('WIND_Z'), o('SATS'), o('HDOP'), agl, o('BARO_ALT'),
      o('GNDSPEED'), o('AIRSPEED'), o('THR_OUT'), o('WARN'), o('CRASHED'),
    ]);
  }

  finish(): FlightLog {
    const crashed = this.o('CRASHED') > 0.5;
    const log = this.recorder.finish(crashed ? 'Crash' : 'Completed', this.o('CRASH_CAUSE'), this.o('FLIGHT_TIME'));
    const cs = this.coverage.stats();
    const hasPlan = this.mission.legs.length > 0;
    const score = scoreFlight(log, cs.sprayedM2 > 0 ? cs : null, hasPlan ? settings.mission : null, this.drone.bodyR);
    log.summary.score = score.total; log.summary.grade = score.grade;
    log.training = {
      score,
      coverage: cs.sprayedM2 > 0 ? { ...cs, img: this.coverageImage() } : undefined,
      mission: hasPlan ? { lanes: this.mission.laneCount, lanesDone: this.mission.lanesDone, height: settings.mission.height, speed: settings.mission.speed } : undefined,
    };
    return log;
  }

  /** Small PNG of the spray coverage map for the debrief / instructor review. */
  coverageImage(): string {
    if (typeof document === 'undefined') return '';
    const c = document.createElement('canvas'); c.width = GRID.w; c.height = GRID.h;
    c.getContext('2d')!.putImageData(this.coverage.image(), 0, 0);
    return c.toDataURL('image/png');
  }
}
