// Ground-station "host": lives next to the simulator. Builds the telemetry the tablet UI shows and
// executes its commands. The same telemetry/commands go to the local tablet panel and, over the LAN
// (WebRTC data channel), to a phone/tablet used as the RC screen.
import type { Engine } from '../sim/engine';
import { settings, saveSettings } from '../settings';
import { WORLD, FIELD, TREES, POLES, WIRES, HOUSE, BOXES, CROWD, HOME } from '../data/world';
import type { MissionPlan, Phase } from '../sim/mission';
import type { Pack } from '../sim/batteries';
import { GRID } from '../sim/coverage';
import { speak } from '../audio/voice';

export interface Check { name: string; state: 'pending' | 'ok' | 'fail'; text: string }
export interface WorldGeo {
  key: string; category: string; name: string; field: { x0: number; x1: number; y0: number; y1: number };
  trees: [number, number, number][]; poles: [number, number][]; wires: [number, number][][]; house: { x: number; y: number; hx: number; hy: number };
  boxes: { x: number; y: number; hx: number; hy: number; kind: string }[]; crowd: { x0: number; x1: number; y0: number; y1: number }[]; home: [number, number];
  geo: { lat: number; lon: number }; ground?: { url: string; x0: number; x1: number; y0: number; y1: number }; fieldPoly?: [number, number][]; geofence?: [number, number][];
  roads?: [number, number][][]; water?: [number, number][][]; bpolys?: [number, number][][];
}
export interface Telemetry {
  t: number; drone: { name: string; tankCap: number; flowLpm: number; lowBatt: number; minSats: number; rtk: boolean; cells: number; camera: boolean };
  mode: number; modeName: string; armed: boolean; landed: boolean; crashed: boolean;
  sats: number; hdop: number; fix: number; soc: number; volt: number; amps: number; tank: number;
  x: number; y: number; z: number; agl: number; yaw: number; gs: number; vs: number; homeDist: number; spraying: boolean; flow: number; warn: number;
  flightTime: number; gcsMode: number | null;
  cam: { rec: boolean; recSec: number; photos: number; gimbal: number; mode: string };
  alt: { agl: number; rel: number; msl: number; crop: number; tgt: number };
  mission: { phase: Phase; idx: number; lanes: number; lanesDone: number; legA: [number, number] | null; legB: [number, number] | null; bp: { x: number; y: number; reason: string } | null; xte: number };
  plan: MissionPlan; packs: (Pack & { status: string })[]; chargeMinutes: number;
  cov: { pct: number; overlap: number; img?: string }; checks: Check[]; starting: boolean;
  world?: WorldGeo; worldKey: string; trail: [number, number][];
}
export type GcsCmd =
  | { t: 'plan'; plan: MissionPlan } | { t: 'start' } | { t: 'pause' } | { t: 'resume' } | { t: 'rth' } | { t: 'manual' }
  | { t: 'pack'; id: string; to: 'drone' | 'charger' | 'ground' } | { t: 'refill' } | { t: 'abort' }
  | { t: 'takeoff' } | { t: 'land' } | { t: 'photo' } | { t: 'rec' } | { t: 'gimbal'; pitch: number } | { t: 'gimbalMode'; mode: 'follow' | 'fpv' | 'track' };

export interface HostHooks {
  beep: (f: number, n?: number, len?: number) => void; toast: (t: string, bad?: boolean) => void; missionChanged: () => void;
  /** camera drones: photo, record toggle, gimbal pitch get/set, recording state */
  photo: () => void; rec: () => void; gimbal: (p?: number) => number; camState: () => { rec: boolean; recSec: number; photos: number };
  gimbalMode: (m: 'follow' | 'fpv' | 'track') => string; gimbalState: () => string;
}

export class GcsHost {
  checks: Check[] = [];
  starting = false;
  private trail: [number, number][] = [];
  private covImg = ''; private covAt = 0; private covVer = 0;
  private abortFlag = false;
  constructor(private e: Engine, private hooks: HostHooks) {}

  reset() { this.checks = []; this.starting = false; this.trail = []; this.covImg = ''; this.abortFlag = true; }

  worldGeo(): WorldGeo {
    return {
      key: `${WORLD.category}:${WORLD.seed}:${WORLD.mapId ?? ''}`, category: WORLD.category, name: WORLD.name, field: { x0: FIELD.x0, x1: FIELD.x1, y0: FIELD.y0, y1: FIELD.y1 },
      trees: TREES.map((t) => [t.x, t.y, t.crownR]), poles: POLES.map((p) => [p.x, p.y]),
      wires: WIRES.map((w) => [w.pts[0], w.pts[w.pts.length - 1]].map((p) => [p[0], p[1]] as [number, number])),
      house: { x: HOUSE.x, y: HOUSE.y, hx: HOUSE.hx, hy: HOUSE.hy }, boxes: BOXES.map((b) => ({ x: b.x, y: b.y, hx: b.hx, hy: b.hy, kind: b.kind })),
      crowd: CROWD.map((c) => ({ ...c })), home: [HOME.x, HOME.y],
      geo: WORLD.geo ?? GEO_BASE, ground: WORLD.ground, fieldPoly: WORLD.fieldPoly, geofence: WORLD.geofence,
      roads: WORLD.roads, water: WORLD.water, bpolys: BOXES.filter((b) => b.poly).map((b) => b.poly!),
    };
  }

  /** withWorld: include the (static) ground geometry — sent once per ground change over the LAN. */
  telemetry(withWorld: boolean, withCovImg: boolean): Telemetry {
    const e = this.e, o = (k: Parameters<Engine['o']>[0]) => e.o(k), m = e.mission, d = e.drone;
    const x = o('X'), y = o('Y');
    const lp = this.trail[this.trail.length - 1];
    if (o('ARMED') > 0.5 && (!lp || Math.hypot(lp[0] - x, lp[1] - y) > 1.5)) { this.trail.push([+x.toFixed(1), +y.toFixed(1)]); if (this.trail.length > 600) this.trail.shift(); }
    if (withCovImg && e.coverage.ver !== this.covVer && performance.now() - this.covAt > 2000 && typeof document !== 'undefined') {
      this.covAt = performance.now(); this.covVer = e.coverage.ver;
      const c = document.createElement('canvas'); c.width = GRID.w; c.height = GRID.h;
      c.getContext('2d')!.putImageData(e.coverage.image(), 0, 0);
      this.covImg = c.toDataURL('image/png');
    }
    const cs = e.coverage.stats();
    const leg = m.legs[m.idx];
    return {
      t: o('T'), drone: { name: d.name, tankCap: d.tankCap, flowLpm: d.flowLpm, lowBatt: d.lowBatt, minSats: d.minSats, rtk: d.rtk, cells: d.battS, camera: d.fc === 'dji' },
      mode: o('MODE'), modeName: e.modeNames()[o('MODE')] ?? '?', armed: o('ARMED') > 0.5, landed: o('LANDED') > 0.5, crashed: o('CRASHED') > 0.5,
      sats: o('SATS'), hdop: o('HDOP'), fix: o('FIX'), soc: o('BATT_SOC'), volt: o('BATT_V'), amps: o('BATT_I'), tank: o('TANK_L'),
      x, y, z: o('Z'), agl: o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z'), yaw: o('YAW'), gs: o('GNDSPEED'), vs: o('VSPEED'), homeDist: o('HOME_DIST'),
      spraying: o('SPRAYING') > 0.5, flow: e.sticks.flow, warn: o('WARN'), flightTime: o('FLIGHT_TIME'), gcsMode: e.gcsMode,
      cam: { ...this.hooks.camState(), gimbal: this.hooks.gimbal(), mode: this.hooks.gimbalState() },
      alt: { agl: o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z'), rel: o('BARO_ALT'), msl: e.env.elev + o('Z'), crop: e.env.cropH ?? 0, tgt: o('TGT_ALT') },
      mission: { phase: m.phase, idx: m.idx, lanes: m.laneCount, lanesDone: m.lanesDone, legA: leg ? leg.a : null, legB: leg ? leg.b : null, bp: m.breakpoint ? { x: m.breakpoint.x, y: m.breakpoint.y, reason: m.breakpoint.reason } : null, xte: m.xte },
      plan: settings.mission, packs: e.bay.packs.map((p) => ({ ...p, status: e.bay.status(p) })), chargeMinutes: e.bay.chargeMinutes,
      cov: { pct: cs.coveredPct, overlap: cs.overlapPct, img: withCovImg ? this.covImg : undefined }, checks: this.checks, starting: this.starting,
      world: withWorld ? this.worldGeo() : undefined, worldKey: `${WORLD.category}:${WORLD.seed}`, trail: this.trail,
    };
  }

  /** Execute a tablet command. Returns an error text ('' = ok). */
  command(c: GcsCmd): string {
    const e = this.e, armed = e.o('ARMED') > 0.5;
    if (e.lockAutoModes && ['rth', 'start', 'resume', 'takeoff', 'land'].includes(c.t)) return 'Not available during a training lesson — fly it by hand';
    switch (c.t) {
      case 'plan': {
        if (e.mission.active && armed) return 'Pause or land before editing the area';
        settings.mission = { ...settings.mission, ...c.plan }; saveSettings();
        this.hooks.missionChanged();
        return '';
      }
      case 'start': if (!this.starting) void this.startSequence(); return '';
      case 'abort': this.abortFlag = true; return '';
      case 'pause': e.gcsMode = 2; speak('Mission paused. Hovering', 1000); return '';
      case 'resume': e.gcsMode = 5; speak(e.mission.breakpoint ? 'Resuming from breakpoint' : 'Resuming mission', 1000); return '';
      case 'rth': e.gcsMode = 3; return '';
      case 'manual': e.gcsMode = null; speak('Manual control', 1000); return '';
      case 'pack': { const err = e.movePack(c.id, c.to); if (!err) this.hooks.beep(1200, 1, 0.06); return err; }
      case 'refill': { const err = e.refillTank(); if (!err) speak('Tank refilled', 1000); return err; }
      case 'takeoff': if (!this.starting) void this.takeoffSequence(); return '';
      case 'land': e.guided = null; e.gcsMode = 4; speak('Landing', 1000); return '';
      case 'photo': this.hooks.photo(); return '';
      case 'rec': this.hooks.rec(); return '';
      case 'gimbal': this.hooks.gimbal(Math.max(-90, Math.min(20, +c.pitch || 0))); return '';
      case 'gimbalMode': if (!['follow', 'fpv', 'track'].includes(c.mode)) return 'bad mode'; this.hooks.gimbalMode(c.mode); return '';
    }
    return '';
  }

  /** Camera drones: short checks, then auto take-off to 1.2 m and hover in P-GPS (like DJI Fly). */
  private async takeoffSequence() {
    const e = this.e, o = (k: Parameters<Engine['o']>[0]) => e.o(k), d = e.drone;
    if (o('ARMED') > 0.5 && o('LANDED') < 0.5) return;
    this.starting = true; this.abortFlag = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const pack = e.bay.inDrone, soc = o('BATT_SOC') * 100, sats = o('SATS');
    const list: [string, () => [boolean, string]][] = [
      ['RC link', () => [e.sticks.ok && !e.rcLost, e.sticks.ok && !e.rcLost ? 'Connected' : 'No signal']],
      ['GNSS / vision', () => [o('FIX') >= 3 && sats >= d.minSats, `${sats.toFixed(0)} satellites · vision positioning ready`]],
      ['Compass / IMU', () => [Math.abs(e.fail.compassErrDeg) < 15, Math.abs(e.fail.compassErrDeg) < 15 ? 'OK' : 'Interference — calibrate']],
      ['Battery', () => [!!pack && soc > d.lowBatt + 5, pack ? `${soc.toFixed(0)}% · ${o('BATT_V').toFixed(1)} V` : 'No battery']],
      ['Gimbal & camera', () => [true, 'Gimbal ready · SD card OK']],
    ];
    this.checks = list.map(([name]) => ({ name, state: 'pending', text: '' }));
    for (let i = 0; i < list.length; i++) {
      await wait(380);
      if (this.abortFlag) { this.starting = false; this.checks = []; return; }
      const [ok, text] = list[i][1]();
      this.checks[i] = { name: list[i][0], state: ok ? 'ok' : 'fail', text };
      this.hooks.beep(ok ? 1500 : 500, 1, 0.06);
      if (!ok) { speak(`${list[i][0]} not ready`, 0); this.hooks.toast(`Take-off blocked: ${list[i][0]} — ${text}`, true); this.starting = false; return; }
    }
    speak('Taking off', 0);
    e.guided = { x: o('EST_X'), y: o('EST_Y'), z: 1.2 };
    e.gcsMode = 5; e.requestArm();
    this.starting = false;
    // hand over to P-GPS hover once at height
    for (let i = 0; i < 100 && e.guided; i++) {
      await wait(100);
      if (o('ARMED') < 0.5) { e.guided = null; e.gcsMode = null; break; }
      if ((o('RADAR_AGL') >= 0 ? o('RADAR_AGL') : o('Z')) > 1.0) { e.guided = null; e.gcsMode = 2; speak('Hovering. Ready to fly', 0); }
    }
    this.checks = [];
  }

  /** Slide-to-start: pre-flight checks with tones + voice, ESC start-up tones, then AUTO take-off. */
  private async startSequence() {
    const e = this.e, o = (k: Parameters<Engine['o']>[0]) => e.o(k), d = e.drone;
    this.starting = true; this.abortFlag = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const inAir = o('ARMED') > 0.5 && o('LANDED') < 0.5;
    if (inAir) { e.gcsMode = 5; this.starting = false; speak(e.mission.breakpoint ? 'Resuming from breakpoint' : 'Starting mission'); return; }
    const sats = o('SATS'), hdop = o('HDOP'), soc = o('BATT_SOC') * 100;
    const pack = e.bay.inDrone;
    const lanes = e.mission.laneCount;
    const list: [string, () => [boolean, string]][] = [
      ['RC link', () => [e.sticks.ok && !e.rcLost, e.sticks.ok && !e.rcLost ? 'Connected' : 'No signal']],
      ['GNSS', () => [o('FIX') >= 3 && sats >= d.minSats && hdop <= 2, `${sats.toFixed(0)} satellites · HDOP ${hdop > 50 ? '--' : hdop.toFixed(1)}${d.rtk && sats >= 12 ? ' · RTK fixed' : ''}`]],
      ['Compass', () => [Math.abs(e.fail.compassErrDeg) < 15, Math.abs(e.fail.compassErrDeg) < 15 ? 'OK' : 'Interference — calibrate']],
      ['Battery', () => [!!pack && soc > d.lowBatt + 10, pack ? `Pack ${pack.id} · ${soc.toFixed(0)}% · ${o('BATT_V').toFixed(1)} V · ${pack.tempC.toFixed(0)} °C` : 'No battery installed']],
      ['Spray tank', () => [d.tankCap === 0 || o('TANK_L') > 0.3, d.tankCap ? `${o('TANK_L').toFixed(1)} / ${d.tankCap} L` : 'No tank']],
      ['Radar / sensors', () => [true, d.hasRadar ? 'Terrain radar OK' : 'Vision sensors OK']],
      ['Route', () => [lanes > 0, lanes ? `${lanes} lanes${e.mission.breakpoint ? ' · resume at breakpoint' : ''}` : 'No area planned']],
      ['Propellers & arms', () => [!e.o('CRASHED'), e.o('CRASHED') ? 'Damaged — reset' : 'Unfolded and locked']],
    ];
    this.checks = list.map(([name]) => ({ name, state: 'pending', text: '' }));
    speak('Starting pre-flight checks', 0);
    for (let i = 0; i < list.length; i++) {
      await wait(550);
      if (this.abortFlag) { this.starting = false; this.checks = []; return; }
      const [ok, text] = list[i][1]();
      this.checks[i] = { name: list[i][0], state: ok ? 'ok' : 'fail', text };
      this.hooks.beep(ok ? 1500 : 500, 1, 0.07);
      if (list[i][0] === 'GNSS' && ok) speak(`GPS ready. ${sats.toFixed(0)} satellites`, 0);
      if (!ok) {
        speak(`${list[i][0]} check failed`, 0);
        this.hooks.toast(`Pre-flight check failed: ${list[i][0]} — ${text}`, true);
        this.starting = false;
        return;
      }
    }
    await wait(400);
    speak('Checks complete. Stand clear. Motors starting', 0);
    // ESC start-up tones ("tuning up")
    for (const f of [523, 659, 784]) { this.hooks.beep(f, 1, 0.16); await wait(220); }
    await wait(900);
    if (this.abortFlag) { this.starting = false; return; }
    e.gcsMode = 5;
    e.requestArm();
    this.starting = false;
    await wait(1200);
    this.checks = [];
  }
}

/** Local ENU metres ↔ WGS-84 (generated grounds sit near Raipur; real maps use their own origin). */
export const GEO_BASE = { lat: 21.05320, lon: 81.73700 }; // farmland near Abhanpur, Raipur (Chhattisgarh)
export function toLatLon(x: number, y: number, b: { lat: number; lon: number } = GEO_BASE): [number, number] {
  return [b.lat + y / 111320, b.lon + x / (111320 * Math.cos(b.lat * Math.PI / 180))];
}
export function fromLatLon(lat: number, lon: number): [number, number] {
  return [(lon - GEO_BASE.lon) * 111320 * Math.cos(GEO_BASE.lat * Math.PI / 180), (lat - GEO_BASE.lat) * 111320];
}
