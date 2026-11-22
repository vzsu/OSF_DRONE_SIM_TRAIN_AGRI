// OSF Agri Drone Sim — physics, environment, sensors and flight controller.
// Frames: world ENU (x east, y north, z up). Body FLU (x forward, y left, z up).
// Fixed step: call step(dt, n). No allocations after init (stub runtime).
import * as L from './layout';

const PA = new StaticArray<f64>(L.P_SIZE);
const IN = new StaticArray<f64>(L.I_SIZE);
const OUT = new StaticArray<f64>(L.O_SIZE);

export function paramsPtr(): usize { return changetype<usize>(PA); }
export function inputsPtr(): usize { return changetype<usize>(IN); }
export function outputsPtr(): usize { return changetype<usize>(OUT); }
export function version(): i32 { return 1; }

@inline function p(i: i32): f64 { return unchecked(PA[i]); }
@inline function inp(i: i32): f64 { return unchecked(IN[i]); }
@inline function o(i: i32, v: f64): void { unchecked(OUT[i] = v); }
@inline function clamp(v: f64, lo: f64, hi: f64): f64 { return v < lo ? lo : (v > hi ? hi : v); }
@inline function sq(v: f64): f64 { return v * v; }

const G: f64 = 9.80665;
const PI: f64 = 3.141592653589793;

// Flight modes
const M_STAB: i32 = 0;
const M_ALTHOLD: i32 = 1;
const M_LOITER: i32 = 2;
const M_RTL: i32 = 3;
const M_LAND: i32 = 4;
const M_AUTO: i32 = 5; // mission: follows the leg given by the AUTO_* inputs

// Event codes (mirrored in src/sim/events.ts)
const EV_ARMED: i32 = 1, EV_DISARMED: i32 = 2, EV_PREARM_THR: i32 = 4, EV_PREARM_GPS: i32 = 5,
  EV_GPS_LOST: i32 = 6, EV_FS_RC: i32 = 7, EV_FS_BATT_LOW: i32 = 8, EV_FS_BATT_CRIT: i32 = 9,
  EV_CRASH: i32 = 10, EV_TANK_EMPTY: i32 = 11, EV_GPS_OK: i32 = 12, EV_LANDED: i32 = 13,
  EV_MOTOR_FAIL: i32 = 14, EV_VRS: i32 = 15, EV_PREARM_BATT: i32 = 16, EV_MODE_DENIED: i32 = 17,
  EV_TAKEOFF: i32 = 18, EV_DISARM_REFUSED: i32 = 19, EV_PREARM_CRASHED: i32 = 20, EV_RC_OK: i32 = 21,
  EV_ESTOP: i32 = 22, EV_PREARM_KILL: i32 = 23;

// ---------- RNG ----------
let rng: u64 = 0x9E3779B97F4A7C15;
function rnd(): f64 {
  rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
  return <f64>(rng >> 11) / 9007199254740992.0;
}
function gauss(): f64 {
  let u = rnd(); if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * PI * rnd());
}

// ---------- airframe (derived in setup) ----------
let nMot: i32 = 6;
const MX = new StaticArray<f64>(8);
const MY = new StaticArray<f64>(8);
const MS = new StaticArray<f64>(8); // +1 CCW prop, -1 CW prop
const MOT = new StaticArray<f64>(8);  // normalized rpm 0..1
const MF = new StaticArray<f64>(8);   // actual thrust per motor (N)
const MCMD = new StaticArray<f64>(8); // commanded thrust (N)
let sumX2: f64 = 1, sumY2: f64 = 1, discArea: f64 = 1, propR: f64 = 0.3;
let rho: f64 = 1.225;

// ---------- state ----------
let px: f64 = 0, py: f64 = 0, pz: f64 = 0, vx: f64 = 0, vy: f64 = 0, vz: f64 = 0;
let qw: f64 = 1, qx: f64 = 0, qy: f64 = 0, qz: f64 = 0;
let wx: f64 = 0, wy: f64 = 0, wz: f64 = 0;
let axPrev: f64 = 0, ayPrev: f64 = 0;
let t: f64 = 0, flightTime: f64 = 0;
let soc: f64 = 1, mahUsed: f64 = 0, battV: f64 = 50, battI: f64 = 0, powerW: f64 = 0;
let tankL: f64 = 0, mass: f64 = 20, Ixy: f64 = 1, Iz: f64 = 2;
let armed = false, crashed = false, crashCause: i32 = 0, onGround = true, landed = true, wasOnGround = true;
let mode: i32 = M_ALTHOLD, lastReq: i32 = -1;
let spraying = false, tankEmptyFlag = false;
let homeX: f64 = 0, homeY: f64 = 0;
let thrTotal: f64 = 0, thrOut: f64 = 0;
let failMotorPrev: i32 = 0;
let vrsActive = false;

// wind
let windX: f64 = 0, windY: f64 = 0, windZ: f64 = 0;
let tu: f64 = 0, tv: f64 = 0, tw: f64 = 0;
let gustT: f64 = 0, gustDur: f64 = 0, gustAmp: f64 = 0, gustDir: f64 = 0, gustNext: f64 = 8;

// slosh (world horizontal)
let sdx: f64 = 0, sdy: f64 = 0, svx: f64 = 0, svy: f64 = 0;

// sensors
let sats: f64 = 16, satTimer: f64 = 0, hdop: f64 = 1, fix: i32 = 3;
let gex: f64 = 0, gey: f64 = 0, glx: f64 = 0, gly: f64 = 0;
let estX: f64 = 0, estY: f64 = 0, estVX: f64 = 0, estVY: f64 = 0, estVZ: f64 = 0;
let baroErr: f64 = 0, baroAlt: f64 = 0, radarAgl: f64 = 0, radarValid = false, altEst: f64 = 0;
let gpsGood = true, gpsBadTimer: f64 = 0, gpsGoodTimer: f64 = 0;
let yawEst: f64 = 0;

// controller state
let zTgt: f64 = 0, yawTgt: f64 = 0, posTX: f64 = 0, posTY: f64 = 0, velTX: f64 = 0, velTY: f64 = 0;
let iVz: f64 = 0, iVx: f64 = 0, iVy: f64 = 0, iWx: f64 = 0, iWy: f64 = 0, iWz: f64 = 0;
let massEst: f64 = 20;
let armSwPrev = false, armGestTimer: f64 = 0, disarmGestTimer: f64 = 0, gestLatch = false;
let landedTimer: f64 = 0, autoDisarmTimer: f64 = 0;
let fsRc = false, fsLow = false, fsCrit = false;
let rtlPhase: i32 = 0;
let rollD: f64 = 0, pitchD: f64 = 0, tgtAltOut: f64 = 0;
let vtxPrev: f64 = 0, vtyPrev: f64 = 0;
let rollS: f64 = 0, pitchS: f64 = 0; // shaped attitude targets
let pilotAtt = true; // attitude target comes straight from the sticks (not from the position controller)
let vrsTimer: f64 = 0, vrsClearTimer: f64 = 10;
let holdLatched = false;

// attitude gains derived from motor time constant
function attKr(): f64 { return p(L.P_RESP) * 0.6 / p(L.P_TAU_MOTOR); }
function attKa(): f64 { return attKr() * 0.42; }

// scratch for rotations
let rx: f64 = 0, ry: f64 = 0, rz: f64 = 0;
function b2w(x: f64, y: f64, z: f64): void {
  const a = qx, b = qy, c = qz, w = qw;
  rx = (1 - 2 * (b * b + c * c)) * x + 2 * (a * b - w * c) * y + 2 * (a * c + w * b) * z;
  ry = 2 * (a * b + w * c) * x + (1 - 2 * (a * a + c * c)) * y + 2 * (b * c - w * a) * z;
  rz = 2 * (a * c - w * b) * x + 2 * (b * c + w * a) * y + (1 - 2 * (a * a + b * b)) * z;
}
function w2b(x: f64, y: f64, z: f64): void {
  const a = qx, b = qy, c = qz, w = qw;
  rx = (1 - 2 * (b * b + c * c)) * x + 2 * (a * b + w * c) * y + 2 * (a * c - w * b) * z;
  ry = 2 * (a * b - w * c) * x + (1 - 2 * (a * a + c * c)) * y + 2 * (b * c + w * a) * z;
  rz = 2 * (a * c + w * b) * x + 2 * (b * c - w * a) * y + (1 - 2 * (a * a + b * b)) * z;
}
function roll(): f64 { return Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy)); }
function pitch(): f64 { return Math.asin(clamp(2 * (qw * qy - qz * qx), -1, 1)); }
function yaw(): f64 { return Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)); }
function wrapPi(a: f64): f64 { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }

function ev(code: i32): void {
  const n = <i32>unchecked(OUT[L.O_EV_COUNT]);
  unchecked(OUT[L.O_EV + (n % L.EV_MAX)] = <f64>code);
  unchecked(OUT[L.O_EV_COUNT] = <f64>(n + 1));
}

// ---------- setup / reset ----------
export function setup(): void {
  nMot = <i32>p(L.P_N_MOTORS);
  if (nMot < 4) nMot = 4; if (nMot > 8) nMot = 8;
  const arm = p(L.P_ARM_LEN);
  const coax = p(L.P_COAX) > 0.5;
  sumX2 = 0; sumY2 = 0;
  for (let i = 0; i < nMot; i++) {
    let ang: f64, s: f64;
    if (coax) { // nMot/2 arms, top+bottom per arm
      const arms = nMot / 2;
      const k = i % arms;
      ang = PI / <f64>arms + 2 * PI * <f64>k / <f64>arms;
      if (arms == 4) ang = PI / 4 + PI / 2 * <f64>k;
      s = (i < arms ? 1.0 : -1.0) * ((k % 2) == 0 ? 1.0 : -1.0);
    } else {
      ang = PI / <f64>nMot + 2 * PI * <f64>i / <f64>nMot;
      s = (i % 2) == 0 ? 1.0 : -1.0;
    }
    unchecked(MX[i] = arm * Math.cos(ang));
    unchecked(MY[i] = arm * Math.sin(ang));
    unchecked(MS[i] = s);
    sumX2 += sq(unchecked(MX[i])); sumY2 += sq(unchecked(MY[i]));
  }
  propR = p(L.P_PROP_D) * 0.5;
  const discs: f64 = coax ? <f64>nMot / 2 : <f64>nMot;
  discArea = discs * PI * propR * propR;
  // air density from elevation + temperature
  const h = p(L.P_ELEV);
  const pr = Math.pow(1 - 2.25577e-5 * h, 5.25588) * 101325.0;
  rho = pr / (287.05 * (p(L.P_TEMP) + 273.15));
  rng = <u64>(p(L.P_SEED) * 1000.0 + 12345.0) * 0x9E3779B97F4A7C15 | 1;
  reset();
}

export function reset(): void {
  px = p(L.P_HOME_X); py = p(L.P_HOME_Y);
  const yaw0 = p(L.P_HOME_YAW);
  qw = Math.cos(yaw0 / 2); qx = 0; qy = 0; qz = Math.sin(yaw0 / 2);
  vx = 0; vy = 0; vz = 0; wx = 0; wy = 0; wz = 0;
  for (let i = 0; i < 8; i++) { unchecked(MOT[i] = 0); unchecked(MF[i] = 0); unchecked(MCMD[i] = 0); }
  tankL = p(L.P_TANK_INIT_L);
  soc = p(L.P_BATT_INIT_SOC); mahUsed = 0;
  updateMass();
  // settle on gear
  pz = p(L.P_GEAR_H) - mass * G / (mass * G / 0.015);
  armed = false; crashed = false; crashCause = 0; onGround = true; landed = true; wasOnGround = true;
  mode = M_ALTHOLD; lastReq = -1; spraying = false; tankEmptyFlag = false;
  homeX = px; homeY = py; t = 0; flightTime = 0;
  sdx = 0; sdy = 0; svx = 0; svy = 0; tu = 0; tv = 0; tw = 0; gustT = 0; gustDur = 0; gustNext = 5 + 10 * rnd();
  sats = p(L.P_GPS_BASE_SATS); gex = 0; gey = 0; glx = 0; gly = 0; baroErr = 0;
  estX = px; estY = py; gpsGood = true; gpsBadTimer = 0; gpsGoodTimer = 0;
  zTgt = 0; yawTgt = yaw0; posTX = px; posTY = py; velTX = 0; velTY = 0;
  iVz = 0; iVx = 0; iVy = 0; iWx = 0; iWy = 0; iWz = 0;
  massEst = mass; armSwPrev = false; armGestTimer = 0; disarmGestTimer = 0; gestLatch = false;
  landedTimer = 0; autoDisarmTimer = 0; fsRc = false; fsLow = false; fsCrit = false; rtlPhase = 0;
  failMotorPrev = 0; vrsActive = false;
  o(L.O_EV_COUNT, 0);
  battV = ocv(soc) * p(L.P_BATT_S);
  writeOut();
}

function updateMass(): void {
  mass = p(L.P_MASS_EMPTY) + tankL * p(L.P_LIQ_DENS);
  Ixy = mass * sq(p(L.P_RG_XY));
  Iz = mass * sq(p(L.P_RG_Z));
}

// ---------- battery ----------
function ocv(s: f64): f64 {
  // per-cell open-circuit voltage
  const liion = p(L.P_BATT_CHEM) > 0.5;
  const x = clamp(s, 0, 1);
  // table at soc 0,0.1,0.2,0.4,0.6,0.8,1.0
  let a0: f64, a1: f64, a2: f64, a3: f64, a4: f64, a5: f64, a6: f64;
  if (liion) { a0 = 3.0; a1 = 3.3; a2 = 3.45; a3 = 3.6; a4 = 3.75; a5 = 3.95; a6 = 4.15; }
  else { a0 = 3.3; a1 = 3.6; a2 = 3.7; a3 = 3.78; a4 = 3.87; a5 = 4.0; a6 = 4.2; }
  if (x < 0.1) return a0 + (a1 - a0) * x / 0.1;
  if (x < 0.2) return a1 + (a2 - a1) * (x - 0.1) / 0.1;
  if (x < 0.4) return a2 + (a3 - a2) * (x - 0.2) / 0.2;
  if (x < 0.6) return a3 + (a4 - a3) * (x - 0.4) / 0.2;
  if (x < 0.8) return a4 + (a5 - a4) * (x - 0.6) / 0.2;
  return a5 + (a6 - a5) * (x - 0.8) / 0.2;
}

function fmaxEff(): f64 {
  const nomV = 3.85 * p(L.P_BATT_S);
  const vr = clamp(battV / nomV, 0.3, 1.12);
  return p(L.P_FMAX) * vr * vr * (rho / 1.225);
}

// ---------- environment ----------
function updateWind(dt: f64): void {
  const spd = inp(L.I_WIND_SPD), dirDeg = inp(L.I_WIND_DIR);
  const gustF = inp(L.I_GUST), turb = inp(L.I_TURB);
  const d = dirDeg * PI / 180.0; // direction wind comes FROM, clockwise from north
  const hz = clamp(pz, 0.5, 200);
  const shear = Math.pow(hz / 10.0, 0.143);
  let mx = -spd * Math.sin(d) * shear, my = -spd * Math.cos(d) * shear;
  // gusts: 1-cos events
  if (gustT > 0) {
    gustT += dt;
    if (gustT > gustDur) { gustT = 0; gustNext = t + 4 + 14 * rnd(); }
  } else if (t > gustNext && spd > 0.1 && gustF > 0) {
    gustT = 1e-6; gustDur = 2 + 3 * rnd(); gustAmp = gustF * spd * (0.5 + 0.5 * rnd());
    gustDir = d + (rnd() - 0.5) * 0.7;
  }
  if (gustT > 0) {
    const g = 0.5 * gustAmp * (1 - Math.cos(2 * PI * gustT / gustDur)) * shear;
    mx += -g * Math.sin(gustDir); my += -g * Math.cos(gustDir);
  }
  // turbulence: Ornstein-Uhlenbeck per axis (Dryden-like spectrum)
  const sig = turb * Math.max(spd, 0.5) * 0.35;
  const Lu = 20 + 2 * hz;
  const Tc = Lu / Math.max(spd, 1.5);
  const k = Math.sqrt(2 * dt / Tc);
  tu += -tu / Tc * dt + sig * k * gauss();
  tv += -tv / Tc * dt + sig * k * gauss();
  tw += -tw / (Tc * 0.5) * dt + 0.5 * sig * Math.sqrt(2 * dt / (Tc * 0.5)) * gauss();
  const groundDamp = clamp(pz / 3.0, 0.2, 1.0);
  windX = mx + tu * groundDamp; windY = my + tv * groundDamp; windZ = tw * groundDamp * groundDamp;
}

// ---------- sensors ----------
function updateSensors(dt: f64): void {
  const base = p(L.P_GPS_BASE_SATS);
  const rtk = p(L.P_RTK) > 0.5;
  satTimer += dt;
  if (satTimer > 1.0) {
    satTimer = 0;
    sats += Math.round((rnd() - 0.5) * 2.2);
    sats = clamp(sats, base - 4, base + 3);
    if (sats < 0) sats = 0;
  }
  let s = sats;
  if (inp(L.I_FAIL_GPS) > 0.5) s = 0;
  hdop = s < 4 ? 99.0 : 0.6 + 22.0 / Math.pow(s, 1.5);
  fix = s < 4 ? 0 : (s < 6 ? 2 : 3);
  const vision = p(L.P_FC_PROFILE) > 0.5 && pz < 30.0 && s >= 6; // DJI downward vision positioning
  const sigma = (rtk && s >= 12) || vision ? 0.03 : 0.3 * hdop;
  const Tg: f64 = 25.0;
  gex += -gex / Tg * dt + sigma * Math.sqrt(2 * dt / Tg) * gauss();
  gey += -gey / Tg * dt + sigma * Math.sqrt(2 * dt / Tg) * gauss();
  // glitches when geometry is poor
  if (hdop > 1.7 && hdop < 50 && rnd() < 0.004 * dt) {
    const a = rnd() * 2 * PI, m = 3 + 5 * rnd();
    glx += m * Math.cos(a); gly += m * Math.sin(a);
  }
  glx -= glx * dt / 3.0; gly -= gly * dt / 3.0;
  if (fix >= 3) {
    estX = px + gex + glx; estY = py + gey + gly;
    estVX = vx + 0.05 * gauss(); estVY = vy + 0.05 * gauss();
  } else {
    // dead-reckoning drift: estimate freezes, velocity unknown
    estVX = 0; estVY = 0;
  }
  estVZ = vz + 0.03 * gauss();
  // baro
  baroErr += -baroErr / 30.0 * dt + 0.35 * Math.sqrt(2 * dt / 30.0) * gauss();
  baroAlt = pz + baroErr + 0.04 * gauss();
  radarValid = p(L.P_HAS_RADAR) > 0.5 && pz < 30.0;
  radarAgl = pz + 0.02 * gauss();
  altEst = radarValid ? radarAgl : baroAlt;
  yawEst = wrapPi(yaw() + inp(L.I_COMPASS_ERR) * PI / 180.0);
  // gps health with hysteresis
  const minS = p(L.P_MIN_SATS);
  const ok = fix >= 3 && s >= minS && hdop <= 2.0;
  const bad = fix < 3 || s < minS - 2 || hdop > 2.5;
  if (bad) { gpsBadTimer += dt; gpsGoodTimer = 0; } else if (ok) { gpsGoodTimer += dt; gpsBadTimer = 0; }
  if (gpsGood && gpsBadTimer > 0.5) { gpsGood = false; onGpsLost(); }
  if (!gpsGood && gpsGoodTimer > 2.0) { gpsGood = true; ev(EV_GPS_OK); }
}

function onGpsLost(): void {
  if (armed && (mode == M_LOITER || mode == M_RTL || mode == M_AUTO)) { setMode(M_ALTHOLD); }
  ev(EV_GPS_LOST);
}

// ---------- flight controller ----------
function needsGps(m: i32): bool { return m == M_LOITER || m == M_RTL || m == M_AUTO; }

/** Ground service on the pad: swap battery / refill tank. Re-applies the mode switch so AUTO can resume. */
export function service(newSoc: f64, newTankL: f64): void {
  if (armed) return;
  soc = clamp(newSoc, 0, 1); tankL = clamp(newTankL, 0, p(L.P_TANK_CAP_L));
  fsLow = false; fsCrit = false; tankEmptyFlag = false; mahUsed = 0;
  updateMass();
  battV = ocv(soc) * p(L.P_BATT_S);
  lastReq = -1;
  writeOut();
}

function setMode(m: i32): void {
  mode = m;
  zTgt = altEst; posTX = estX; posTY = estY; velTX = estVX; velTY = estVY; yawTgt = yawEst;
  iVx = 0; iVy = 0; rtlPhase = 0;
  ev(100 + m);
}

function tryArm(thr: f64): void {
  if (crashed) { ev(EV_PREARM_CRASHED); return; }
  if (inp(L.I_KILL) > 0.5) { ev(EV_PREARM_KILL); return; }
  if (thr > 0.08) { ev(EV_PREARM_THR); return; }
  if (soc * 100 < p(L.P_LOW_BATT) + 3) { ev(EV_PREARM_BATT); return; }
  if (needsGps(mode) && !gpsGood) { ev(EV_PREARM_GPS); return; }
  armed = true; homeX = estX; homeY = estY; zTgt = altEst; yawTgt = yawEst; massEst = mass;
  iVz = 0; iWx = 0; iWy = 0; iWz = 0; autoDisarmTimer = 0; fsLow = false; fsCrit = false;
  if (onGround) { landedTimer = 1.0; landed = true; } // arming on the pad must not read as a takeoff
  ev(EV_ARMED);
}

function disarm(): void { armed = false; ev(EV_DISARMED); }

function control(dt: f64): void {
  const rcOk = inp(L.I_RC_OK) > 0.5;
  let sR = inp(L.I_ROLL), sP = inp(L.I_PITCH), sY = inp(L.I_YAW), sT = inp(L.I_THR);
  if (!rcOk) {
    sR = 0; sP = 0; sY = 0; sT = 0.5;
    if (!fsRc) { fsRc = true; if (armed) { ev(EV_FS_RC); setMode(gpsGood ? M_RTL : M_LAND); } }
  } else if (fsRc) { fsRc = false; ev(EV_RC_OK); lastReq = -2; }

  // mode selection from RC (edge-triggered so failsafes can override)
  if (rcOk) {
    const req: i32 = inp(L.I_RTL_SW) > 0.5 ? M_RTL : <i32>inp(L.I_MODE);
    if (req != lastReq) {
      if (lastReq == -2) { lastReq = req; } // after RC regain, wait for a switch change
      else {
        lastReq = req;
        if (req != mode) {
          if (needsGps(req) && !gpsGood) ev(EV_MODE_DENIED); else setMode(req);
        }
      }
    }
  }

  // arming
  if (inp(L.I_ARM_SW_EN) > 0.5) {
    const sw = inp(L.I_ARM_SW) > 0.5;
    if (sw && !armSwPrev && !armed) tryArm(sT);
    if (!sw && armSwPrev && armed) { if (landed || crashed) disarm(); else ev(EV_DISARM_REFUSED); }
    armSwPrev = sw;
  }
  if (sT < 0.06 && sY > 0.85 && !armed) armGestTimer += dt; else armGestTimer = 0;
  if (sT < 0.06 && sY < -0.85 && armed && landed) disarmGestTimer += dt; else disarmGestTimer = 0;
  if (!gestLatch && armGestTimer > 1.5) { tryArm(sT); gestLatch = true; }
  if (!gestLatch && disarmGestTimer > 1.5) { disarm(); gestLatch = true; }
  if (armGestTimer == 0 && disarmGestTimer == 0) gestLatch = false;

  // emergency motor stop (kill switch): cuts motors immediately, even in the air
  if (inp(L.I_KILL) > 0.5 && armed) { armed = false; ev(EV_ESTOP); }

  // battery failsafes
  if (armed && !landed) {
    if (!fsLow && soc * 100 < p(L.P_LOW_BATT)) {
      fsLow = true; ev(EV_FS_BATT_LOW);
      if (gpsGood && mode != M_LAND) setMode(M_RTL);
    }
    if (!fsCrit && soc * 100 < p(L.P_CRIT_BATT)) { fsCrit = true; ev(EV_FS_BATT_CRIT); setMode(M_LAND); }
  }

  // landed detection & auto-disarm
  if (onGround && Math.abs(vz) < 0.35 && thrTotal < 0.75 * mass * G) landedTimer += dt; else landedTimer = 0;
  const wasLanded = landed;
  landed = landedTimer > 0.4 || (!armed && onGround);
  if (armed && landed && !wasLanded) ev(EV_LANDED);
  if (armed && !landed && wasLanded) ev(EV_TAKEOFF);
  const autoLand = mode == M_AUTO && inp(L.I_AUTO_ON) > 0.5 && inp(L.I_AUTO_Z) < 0;
  if (armed && landed && (sT < 0.1 || mode == M_LAND || mode == M_RTL || autoLand)) autoDisarmTimer += dt; else autoDisarmTimer = 0;
  if (armed && autoDisarmTimer > (mode == M_LAND || mode == M_RTL || autoLand ? 1.5 : 4.0)) disarm();

  if (!armed) { for (let i = 0; i < nMot; i++) unchecked(MCMD[i] = 0); thrOut = 0; rollD = 0; pitchD = 0; return; }

  const fmx = fmaxEff();
  const tMax = fmx * <f64>nMot;
  // hover learning (like MOT_THST_HOVER learn)
  massEst += (mass - massEst) * dt / 4.0;
  const hoverT = massEst * G;
  const maxTilt = p(L.P_MAX_TILT);
  const resp = p(L.P_RESP);

  // yaw
  let yawRateFF: f64 = 0;
  if (Math.abs(sY) > 0.05) { yawTgt = yawEst; yawRateFF = -sY * p(L.P_MAX_YAWRATE); }

  let collective: f64 = 0;
  let idle = false;
  rollD = sR * maxTilt; pitchD = sP * maxTilt;
  pilotAtt = true;
  const cr = Math.cos(roll()), cp = Math.cos(pitch());
  const tiltComp = 1.0 / Math.max(cr * cp, 0.6);

  if (mode == M_STAB) {
    // throttle curve with expo around mid-stick (like MOT_THST_HOVER + throttle expo):
    // small stick moves near hover give gentle climb/descent, the ends still reach idle / full power
    if (sT < 0.03) { idle = true; }
    else {
      const dd = clamp((sT - 0.5) / 0.5, -1, 1);
      const f = dd * (0.3 + 0.7 * dd * dd);
      collective = f >= 0 ? hoverT + (tMax - hoverT) * f : hoverT * (1 + f);
    }
    collective *= tiltComp;
    tgtAltOut = altEst;
  } else {
    // ---- vertical target ----
    let vzT: f64 = 0;
    const d = sT - 0.5;
    if (mode == M_LAND) {
      vzT = altEst > 10 ? -Math.max(p(L.P_LAND_SPEED) * 2.5, 1.5) : -p(L.P_LAND_SPEED);
    } else if (mode == M_RTL) {
      vzT = 0;
    } else if (mode == M_AUTO) {
      if (inp(L.I_AUTO_ON) > 0.5) {
        const zc = inp(L.I_AUTO_Z);
        if (zc < 0) vzT = altEst > 10 ? -Math.max(p(L.P_LAND_SPEED) * 2.5, 1.5) : -p(L.P_LAND_SPEED);
        else vzT = clamp((zc - altEst) * 0.8, -p(L.P_MAX_DESC) * 0.8, p(L.P_MAX_CLIMB) * 0.8);
      }
    } else {
      if (d > 0.06) vzT = (d - 0.06) / 0.44 * p(L.P_MAX_CLIMB);
      else if (d < -0.06) vzT = (d + 0.06) / 0.44 * p(L.P_MAX_DESC);
    }
    // radar / vision-equipped drones slow the descent near the ground (agri radar, DJI downward sensors)
    if (vzT < 0 && (radarValid || p(L.P_FC_PROFILE) > 0.5)) {
      const h = Math.max(altEst - p(L.P_GEAR_H), 0);
      vzT = Math.max(vzT, -Math.max(0.5, h * 0.7));
    }
    // ---- horizontal ----
    let aX: f64 = 0, aY: f64 = 0, usePos = false;
    // tilt is expressed in the frame of the yaw TARGET (the desired attitude uses yawTgt)
    const cy = Math.cos(yawTgt), sy = Math.sin(yawTgt);
    if ((mode == M_LOITER || mode == M_RTL || mode == M_AUTO || (mode == M_LAND && gpsGood)) && gpsGood) {
      usePos = true;
      let vdX: f64 = 0, vdY: f64 = 0;
      const acc = p(L.P_LOIT_ACC);
      if (mode == M_LOITER) {
        const vf = sP * p(L.P_MAX_SPEED), vr = sR * p(L.P_MAX_SPEED);
        vdX = vf * cy + vr * sy; vdY = vf * sy - vr * cy;
      } else if (mode == M_RTL) {
        const rtlAlt = p(L.P_RTL_ALT);
        if (rtlPhase == 0) { // climb
          vzT = altEst < rtlAlt - 0.3 ? p(L.P_MAX_CLIMB) * 0.8 : 0;
          if (altEst >= rtlAlt - 0.5) rtlPhase = 1;
          if (Math.sqrt(sq(homeX - estX) + sq(homeY - estY)) < 2.0) rtlPhase = 2;
        } else if (rtlPhase == 1) {
          const dx = homeX - estX, dy = homeY - estY, dist = Math.sqrt(dx * dx + dy * dy);
          const spd = Math.min(p(L.P_MAX_SPEED) * 0.8, Math.sqrt(2 * acc * 0.6 * Math.max(dist - 0.5, 0)));
          if (dist > 0.01) { vdX = dx / dist * spd; vdY = dy / dist * spd; }
          if (dist < 1.5 && Math.sqrt(estVX * estVX + estVY * estVY) < 0.5) { rtlPhase = 2; posTX = homeX; posTY = homeY; }
          // turn to face home, slewed at 80% of the max yaw rate
          if (dist > 5) {
            const err = wrapPi(Math.atan2(dy, dx) - yawTgt);
            const mx = p(L.P_MAX_YAWRATE) * 0.8 * dt;
            yawTgt = wrapPi(yawTgt + clamp(err, -mx, mx));
          }
        } else {
          mode = M_LAND; ev(100 + M_LAND);
        }
        if (rtlPhase == 1) vzT = (rtlAlt - altEst) * 0.5;
      } else if (mode == M_AUTO && inp(L.I_AUTO_ON) > 0.5) {
        // straight-line leg A→B: along-track speed profile (stops at lane ends like agri FCs),
        // plus cross-track correction back onto the line
        const ax_ = inp(L.I_AUTO_AX), ay_ = inp(L.I_AUTO_AY), bx_ = inp(L.I_AUTO_BX), by_ = inp(L.I_AUTO_BY);
        let ux = bx_ - ax_, uy = by_ - ay_;
        const len = Math.sqrt(ux * ux + uy * uy);
        const dxB = bx_ - estX, dyB = by_ - estY, dB = Math.sqrt(dxB * dxB + dyB * dyB);
        let remaining = dB, exT: f64 = 0, eyT: f64 = 0;
        if (len > 0.5) {
          ux /= len; uy /= len;
          const rx0 = estX - ax_, ry0 = estY - ay_;
          const along = rx0 * ux + ry0 * uy;
          remaining = len - along;
          exT = rx0 - along * ux; eyT = ry0 - along * uy;
        } else if (dB > 0.05) { ux = dxB / dB; uy = dyB / dB; } else { ux = 0; uy = 0; }
        let spd = Math.min(Math.min(inp(L.I_AUTO_SPD), p(L.P_MAX_SPEED)), Math.sqrt(2 * acc * 0.6 * Math.max(remaining - 0.2, 0)));
        // finish the turn at the lane end before accelerating (heading error gates the speed)
        if (len > 2 && remaining > 1.5) {
          const he = Math.abs(wrapPi(Math.atan2(uy, ux) - yawEst));
          spd *= clamp(1 - (he - 0.12) / 0.4, 0, 1);
        }
        let cxv = -exT * 0.8, cyv = -eyT * 0.8;
        const cl = Math.sqrt(cxv * cxv + cyv * cyv);
        if (cl > 2.0) { cxv *= 2.0 / cl; cyv *= 2.0 / cl; }
        const over = Math.min(remaining, 0) * 0.8; // overshot the end point → come back
        vdX = ux * (spd + over) + cxv; vdY = uy * (spd + over) + cyv;
        // face the direction of travel (slewed)
        if (len > 2 && remaining > 1.5) {
          const err = wrapPi(Math.atan2(uy, ux) - yawTgt);
          const mx = p(L.P_MAX_YAWRATE) * 0.9 * dt;
          yawTgt = wrapPi(yawTgt + clamp(err, -mx, mx));
        }
      }
      // shape velocity target with accel limit (stronger braking)
      vtxPrev = velTX; vtyPrev = velTY;
      const brake = Math.abs(vdX) + Math.abs(vdY) < 0.01 ? 1.6 : 1.0;
      const dvx = vdX - velTX, dvy = vdY - velTY, dv = Math.sqrt(dvx * dvx + dvy * dvy);
      const maxDv = acc * brake * dt;
      if (dv > maxDv) { velTX += dvx / dv * maxDv; velTY += dvy / dv * maxDv; } else { velTX = vdX; velTY = vdY; }
      if (landed) { velTX = 0; velTY = 0; posTX = estX; posTY = estY; }
      posTX += velTX * dt; posTY += velTY * dt;
      // leash
      let ex = posTX - estX, ey = posTY - estY;
      const el = Math.sqrt(ex * ex + ey * ey), leash: f64 = 4.0;
      if (el > leash) { posTX = estX + ex / el * leash; posTY = estY + ey / el * leash; ex = posTX - estX; ey = posTY - estY; }
      // gains scaled to the attitude-loop bandwidth (heavy drones respond slower)
      const KaH = attKa();
      const Kv = Math.min(0.42 * KaH, 2.5), Kp = Math.min(0.35 * Kv, 1.0);
      let pcx = Kp * ex, pcy = Kp * ey;
      const pcl = Math.sqrt(pcx * pcx + pcy * pcy);
      if (pcl > 1.5) { pcx *= 1.5 / pcl; pcy *= 1.5 / pcl; }
      const vcx = velTX + pcx, vcy = velTY + pcy;
      const evx = vcx - estVX, evy = vcy - estVY;
      // strong integrator for wind rejection when holding; softer on AUTO legs (avoids cross-track overshoot after turns)
      const ki = mode == M_AUTO ? 0.3 : 0.7;
      if (!landed) { iVx = clamp(iVx + evx * ki * Kv * dt, -4, 4); iVy = clamp(iVy + evy * ki * Kv * dt, -4, 4); }
      // feed-forward of the shaped target acceleration
      aX = Kv * evx + iVx + (velTX - vtxPrev) / dt * 0.8;
      aY = Kv * evy + iVy + (velTY - vtyPrev) / dt * 0.8;
      // accel -> tilt in heading frame
      const af = aX * cy + aY * sy, al = -aX * sy + aY * cy;
      pitchD = clamp(Math.atan(af / G), -maxTilt, maxTilt);
      rollD = clamp(Math.atan(-al / G), -maxTilt, maxTilt);
      if (landed) { pitchD = 0; rollD = 0; }
    }
    // beginner hold assist: ALT HOLD / ATTI with centred sticks brakes to a stop and holds
    // (uses the inertial/optical velocity, not GPS) — instructors switch it off for real ATTI training
    if (!usePos && !landed && mode == M_ALTHOLD && p(L.P_HOLD_ASSIST) > 0.5 && Math.abs(sR) < 0.05 && Math.abs(sP) < 0.05) {
      usePos = true;
      if (!holdLatched) { holdLatched = true; posTX = px; posTY = py; iVx = 0; iVy = 0; }
      const KaH = attKa();
      const Kv = Math.min(0.42 * KaH, 2.5), Kp = Math.min(0.35 * Kv, 1.0);
      let pcx = Kp * (posTX - px), pcy = Kp * (posTY - py);
      const pcl = Math.sqrt(pcx * pcx + pcy * pcy);
      if (pcl > 1.5) { pcx *= 1.5 / pcl; pcy *= 1.5 / pcl; }
      const evx = pcx - vx, evy = pcy - vy;
      iVx = clamp(iVx + evx * 0.7 * Kv * dt, -4, 4); iVy = clamp(iVy + evy * 0.7 * Kv * dt, -4, 4);
      const aX = Kv * evx + iVx, aY = Kv * evy + iVy;
      const af = aX * cy + aY * sy, al = -aX * sy + aY * cy;
      pitchD = clamp(Math.atan(af / G), -maxTilt, maxTilt);
      rollD = clamp(Math.atan(-al / G), -maxTilt, maxTilt);
    } else if (mode == M_ALTHOLD) holdLatched = false;
    if (!usePos && landed) { rollD = 0; pitchD = 0; }
    pilotAtt = !usePos;

    // ---- vertical controller ----
    if (landed && vzT <= 0.05) {
      idle = true; zTgt = altEst; iVz = 0;
    } else {
      zTgt += vzT * dt;
      zTgt = clamp(zTgt, altEst - 2.5, altEst + 2.5);
      const vzc = clamp(vzT + 1.0 * (zTgt - altEst), -p(L.P_MAX_DESC) * 1.2, p(L.P_MAX_CLIMB) * 1.2);
      const evz = vzc - estVZ;
      iVz = clamp(iVz + evz * 1.0 * dt, -4, 4);
      const azc = clamp(3.0 * evz + iVz, -6, 6);
      collective = massEst * (G + azc) * tiltComp;
    }
    tgtAltOut = zTgt;
  }

  if (idle) {
    for (let i = 0; i < nMot; i++) unchecked(MCMD[i] = 0.015 * fmx);
    iWx = 0; iWy = 0; iWz = 0; thrOut = 0;
    yawTgt = yawEst; rollS = 0; pitchS = 0;
    return;
  }

  // input shaping (ArduPilot ATC_INPUT_TC): the attitude target follows the stick through a
  // first-order filter with an angular-rate limit, so full-stick reversals don't overshoot
  const tcIn = p(L.P_TAU_MOTOR) * 1.6 + 0.05;
  const kIn = Math.min(dt / tcIn, 1.0);
  const rateLim = 1.2 * p(L.P_RESP) * dt;
  // pilot is actively changing the attitude command → pause rate integrators (anti-windup)
  const manoeuvre = pilotAtt && (Math.abs(rollD - rollS) > 0.05 || Math.abs(pitchD - pitchS) > 0.05);
  if (pilotAtt) {
    rollS += clamp((rollD - rollS) * kIn, -rateLim, rateLim);
    pitchS += clamp((pitchD - pitchS) * kIn, -rateLim, rateLim);
    rollD = rollS; pitchD = pitchS;
  } else { rollS = rollD; pitchS = pitchD; } // position controller output is already smooth

  // ---- attitude controller (quaternion error, in compass-estimated frame) ----
  const ce = inp(L.I_COMPASS_ERR) * PI / 180.0;
  const cz = Math.cos(ce / 2), sz = Math.sin(ce / 2);
  // q_est = qz(ce) * q
  const ew = cz * qw - sz * qz, ex2 = cz * qx - sz * qy, ey2 = cz * qy + sz * qx, ez = cz * qz + sz * qw;
  // desired from euler ZYX
  const hr = rollD * 0.5, hp = pitchD * 0.5, hy = yawTgt * 0.5;
  const cr2 = Math.cos(hr), sr2 = Math.sin(hr), cp2 = Math.cos(hp), sp2 = Math.sin(hp), cy2 = Math.cos(hy), sy2 = Math.sin(hy);
  const dw = cr2 * cp2 * cy2 + sr2 * sp2 * sy2;
  const dx = sr2 * cp2 * cy2 - cr2 * sp2 * sy2;
  const dy = cr2 * sp2 * cy2 + sr2 * cp2 * sy2;
  const dz = cr2 * cp2 * sy2 - sr2 * sp2 * cy2;
  // q_err = conj(q_est) * q_d
  let rw = ew * dw + ex2 * dx + ey2 * dy + ez * dz;
  let rxe = ew * dx - ex2 * dw - ey2 * dz + ez * dy;
  let rye = ew * dy + ex2 * dz - ey2 * dw - ez * dx;
  let rze = ew * dz - ex2 * dy + ey2 * dx - ez * dw;
  if (rw < 0) { rw = -rw; rxe = -rxe; rye = -rye; rze = -rze; }
  const Kr = attKr(), Ka = attKa();
  const KrY = Kr * 0.6, KaY = Ka * 0.5;
  const maxRate = 1.8 * resp;
  // yaw FF in body z (approx)
  const wcx = clamp(Ka * 2 * rxe, -maxRate, maxRate);
  const wcy = clamp(Ka * 2 * rye, -maxRate, maxRate);
  const wcz = clamp(KaY * 2 * rze + yawRateFF, -p(L.P_MAX_YAWRATE) * 1.3, p(L.P_MAX_YAWRATE) * 1.3);
  const erx = wcx - wx, ery = wcy - wy, erz = wcz - wz;
  // integrators large enough to absorb a lost motor or offset CG, but with anti-windup:
  // only integrate while the pilot is not changing the attitude command
  if (!manoeuvre) {
    iWx = clamp(iWx + erx * dt * Kr * 1.5, -12, 12);
    iWy = clamp(iWy + ery * dt * Kr * 1.5, -12, 12);
  }
  if (Math.abs(yawRateFF) < 0.01) iWz = clamp(iWz + erz * dt * KrY * 0.5, -3, 3);
  let tx = Ixy * (Kr * erx + iWx) + (Iz - Ixy) * wy * wz * -1.0;
  let ty = Ixy * (Kr * ery + iWy) - (Iz - Ixy) * wx * wz * -1.0;
  let tzq = Iz * (KrY * erz + iWz);

  mix(collective, tx, ty, tzq, fmx);
  thrOut = collective / tMax;
}

// mixer with desaturation: attitude priority, yaw first to give up.
function mix(T: f64, tx: f64, ty: f64, tz: f64, fmx: f64): void {
  const n = <f64>nMot;
  const yawK = p(L.P_KQ) * p(L.P_YAW_AUTH);
  const fmin = 0.015 * fmx;
  let c = clamp(T / n, fmin, fmx);
  // roll/pitch part
  let rpMax: f64 = -1e9, rpMin: f64 = 1e9;
  for (let i = 0; i < nMot; i++) {
    const rp = tx * unchecked(MY[i]) / sumY2 - ty * unchecked(MX[i]) / sumX2;
    if (rp > rpMax) rpMax = rp; if (rp < rpMin) rpMin = rp;
  }
  let rpScale: f64 = 1;
  const span = rpMax - rpMin;
  if (span > fmx - fmin) rpScale = (fmx - fmin) / span;
  rpMax *= rpScale; rpMin *= rpScale;
  c = clamp(c, fmin - rpMin, fmx - rpMax);
  // yaw part: as much as fits
  const yUnit = tz / (yawK * n);
  let yScale: f64 = 1;
  for (let i = 0; i < nMot; i++) {
    const rp = (tx * unchecked(MY[i]) / sumY2 - ty * unchecked(MX[i]) / sumX2) * rpScale;
    const yv = -unchecked(MS[i]) * yUnit;
    const base = c + rp;
    if (yv > 0 && base + yv > fmx) yScale = Math.min(yScale, (fmx - base) / yv);
    if (yv < 0 && base + yv < fmin) yScale = Math.min(yScale, (base - fmin) / -yv);
  }
  yScale = clamp(yScale, 0, 1);
  for (let i = 0; i < nMot; i++) {
    const rp = (tx * unchecked(MY[i]) / sumY2 - ty * unchecked(MX[i]) / sumX2) * rpScale;
    const yv = -unchecked(MS[i]) * yUnit * yScale;
    unchecked(MCMD[i] = clamp(c + rp + yv, 0, fmx));
  }
}

// ---------- physics ----------
let contactWasMax: f64 = 0;
function physics(dt: f64): void {
  const fmx = fmaxEff();
  const failIdx = <i32>inp(L.I_FAIL_MOTOR);
  if (failIdx != failMotorPrev) { if (failIdx > 0) ev(EV_MOTOR_FAIL); failMotorPrev = failIdx; }
  const tau = p(L.P_TAU_MOTOR);

  // air-relative velocity
  const ax0 = vx - windX, ay0 = vy - windY, az0 = vz - windZ;
  w2b(ax0, ay0, az0);
  const vbx = rx, vby = ry, vbz = rz;
  const vh = Math.sqrt(vbx * vbx + vby * vby);

  // induced velocity at hover thrust for ETL / VRS
  const vi = Math.sqrt(Math.max(thrTotal, mass * G * 0.3) / (2 * rho * discArea));
  const etl = 1.0 + 0.12 * (1 - Math.exp(-vh / Math.max(vi, 0.5)));
  // ground effect
  const hR = Math.max(pz, propR * 0.6);
  let ge = 1.0 / (1.0 - sq(propR / (4.0 * hR)));
  ge = clamp(ge, 1.0, 1.25);
  // vortex ring state
  let vrs: f64 = 1.0;
  const descent = -vbz;
  const nowVrs = armed && !onGround && pz > 1.5 && thrTotal > 0.3 * mass * G &&
    descent > 0.45 * vi && descent < 1.6 * vi && vh < 0.7 * vi;
  if (nowVrs) {
    const sev = 1 - Math.abs(descent - vi) / vi;
    vrs = 1.0 - 0.3 * clamp(sev, 0, 1);
    vrsTimer += dt; vrsClearTimer = 0;
  } else { vrsTimer = 0; vrsClearTimer += dt; }
  if (!vrsActive && vrsTimer > 0.3) { vrsActive = true; ev(EV_VRS); }
  if (vrsActive && vrsClearTimer > 2.0) vrsActive = false;
  const aero = etl * ge * vrs;

  // motors
  let T: f64 = 0, tx: f64 = 0, ty: f64 = 0, tz: f64 = 0, pw: f64 = 0;
  const yawK = p(L.P_KQ) * p(L.P_YAW_AUTH);
  const coax = p(L.P_COAX) > 0.5;
  const aPer = coax ? discArea / (<f64>nMot / 2) : discArea / <f64>nMot;
  const powK = 1.0 / (p(L.P_FM) * Math.sqrt(2 * rho * aPer) * p(L.P_ETA));
  for (let i = 0; i < nMot; i++) {
    let target: f64 = 0;
    if (armed && !crashed) target = Math.sqrt(clamp(unchecked(MCMD[i]) / fmx, 0, 1));
    if (failIdx == i + 1) target = 0;
    let m = unchecked(MOT[i]);
    const tc = target > m ? tau : tau * 1.4;
    m += (target - m) * Math.min(dt / tc, 1.0);
    unchecked(MOT[i] = m);
    const f = fmx * m * m * aero;
    unchecked(MF[i] = f);
    T += f;
    tx += f * unchecked(MY[i]);
    ty -= f * unchecked(MX[i]);
    tz -= unchecked(MS[i]) * yawK * f;
    pw += Math.pow(f, 1.5) * powK + (m > 0.01 ? 12.0 : 0);
  }
  thrTotal = T;
  if (vrsActive && T > 0) { tx += (rnd() - 0.5) * 0.08 * T * 0.3; ty += (rnd() - 0.5) * 0.08 * T * 0.3; }

  // body forces
  const half = 0.5 * rho;
  let fbx = -half * p(L.P_CDA_XY) * Math.abs(vbx) * vbx - p(L.P_KH) * T * vbx;
  let fby = -half * p(L.P_CDA_XY) * Math.abs(vby) * vby - p(L.P_KH) * T * vby;
  let fbz = -half * p(L.P_CDA_Z) * Math.abs(vbz) * vbz + T;
  b2w(fbx, fby, fbz);
  let Fx = rx, Fy = ry, Fz = rz - mass * G;

  // slosh (horizontal, world)
  const liq = tankL * p(L.P_LIQ_DENS);
  const ms = liq * p(L.P_SLOSH_FRAC);
  if (ms > 0.05) {
    const om = 2 * PI * p(L.P_SLOSH_FREQ);
    const k = ms * om * om, c = 2 * p(L.P_SLOSH_ZETA) * Math.sqrt(k * ms);
    const sax = -(k * sdx + c * svx) / ms - axPrev;
    const say = -(k * sdy + c * svy) / ms - ayPrev;
    svx += sax * dt; svy += say * dt; sdx += svx * dt; sdy += svy * dt;
    sdx = clamp(sdx, -0.15, 0.15); sdy = clamp(sdy, -0.15, 0.15);
    // only the liquid's DEVIATION from rigid motion acts on the airframe (its rigid inertia is
    // already in `mass`): spring+damper force plus ms*a cancels in steady acceleration
    const fsx = k * sdx + c * svx + ms * axPrev, fsy = k * sdy + c * svy + ms * ayPrev;
    Fx += fsx; Fy += fsy;
    w2b(fsx, fsy, 0);
    const lz = -p(L.P_TANK_Z);
    // torque r x F with r = (0,0,lz)
    tx += -lz * ry; ty += lz * rx;
  } else { sdx = 0; sdy = 0; svx = 0; svy = 0; }

  // rotational aero damping
  tx -= 0.15 * Ixy * wx; ty -= 0.15 * Ixy * wy; tz -= 0.25 * Iz * wz;

  // ground contact: 4 gear points
  const gw = p(L.P_GEAR_W), gh = p(L.P_GEAR_H);
  const kc = mass * G / (4.0 * 0.015);
  const cc = 2.0 * 0.9 * Math.sqrt(kc * mass / 4.0);
  let contacts: i32 = 0;
  let maxImpact: f64 = 0;
  for (let j = 0; j < 4; j++) {
    const bx = (j & 1) == 0 ? gw : -gw, by = (j & 2) == 0 ? gw : -gw;
    b2w(bx, by, -gh);
    const rwx = rx, rwy = ry, rwz = rz;
    const wz2 = pz + rwz;
    if (wz2 < 0) {
      contacts++;
      // point velocity = v + w_world x r
      b2w(wx, wy, wz);
      const wwx = rx, wwy = ry, wwz = rz;
      const pvx = vx + wwy * rwz - wwz * rwy;
      const pvy = vy + wwz * rwx - wwx * rwz;
      const pvz = vz + wwx * rwy - wwy * rwx;
      if (-pvz > maxImpact) maxImpact = -pvz;
      let N = -kc * wz2 - cc * pvz;
      if (N < 0) N = 0;
      const vt = Math.sqrt(pvx * pvx + pvy * pvy);
      const mu: f64 = 0.6;
      const ft = Math.min(mu * N, 4.0 * mass * vt);
      const fx = vt > 1e-4 ? -ft * pvx / vt : 0, fy = vt > 1e-4 ? -ft * pvy / vt : 0;
      Fx += fx; Fy += fy; Fz += N;
      // torque world = r x F
      const twx = rwy * N - rwz * fy, twy = rwz * fx - rwx * N, twz = rwx * fy - rwy * fx;
      w2b(twx, twy, twz);
      tx += rx; ty += ry; tz += rz;
    }
  }
  onGround = contacts > 0;
  // hard landing judged on the vertical speed of the airframe (CG) at touchdown
  if (onGround && !wasOnGround && -vz > p(L.P_CRASH_VZ) && !crashed) crash(1);
  wasOnGround = onGround;
  // tip-over / body strike
  b2w(0, 0, 1);
  if (onGround && rz < 0.5 && !crashed) crash(2);
  if (pz < p(L.P_GEAR_H) * 0.35 && !crashed && t > 0.5) crash(2);
  // floor penetration hard stop for body
  if (pz < -0.2) { pz = -0.2; if (vz < 0) vz = 0; }

  // integrate linear
  const axl = Fx / mass, ayl = Fy / mass, azl = Fz / mass;
  vx += axl * dt; vy += ayl * dt; vz += azl * dt;
  px += vx * dt; py += vy * dt; pz += vz * dt;
  axPrev = axl; ayPrev = ayl;

  // integrate angular (Euler's equations)
  const dwx = (tx - (Iz - Ixy) * wy * wz) / Ixy;
  const dwy = (ty - (Ixy - Iz) * wx * wz) / Ixy;
  const dwz = tz / Iz;
  wx += dwx * dt; wy += dwy * dt; wz += dwz * dt;
  // quaternion
  const hq = 0.5 * dt;
  const nw = qw + hq * (-qx * wx - qy * wy - qz * wz);
  const nx = qx + hq * (qw * wx + qy * wz - qz * wy);
  const ny = qy + hq * (qw * wy - qx * wz + qz * wx);
  const nz = qz + hq * (qw * wz + qx * wy - qy * wx);
  const nn = Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
  qw = nw / nn; qx = nx / nn; qy = ny / nn; qz = nz / nn;

  // obstacles
  if (!crashed) collide();

  // battery
  // pump is cut automatically during RTL / LAND (as real agri flight controllers do)
  spraying = armed && !landed && inp(L.I_SPRAY) > 0.5 && tankL > 0 && mode != M_RTL && mode != M_LAND;
  if (armed) pw += p(L.P_AVIONICS_W) + (spraying ? p(L.P_PUMP_W) : 0);
  else pw += p(L.P_AVIONICS_W) * 0.5;
  powerW = pw;
  const S = p(L.P_BATT_S);
  const Voc = ocv(soc) * S, R = p(L.P_BATT_R);
  const disc = Voc * Voc - 4 * pw * R;
  battV = disc > 0 ? (Voc + Math.sqrt(disc)) * 0.5 : Voc * 0.5;
  battI = pw / battV;
  const capAs = p(L.P_BATT_MAH) * 3.6;
  soc -= battI * dt / capAs; if (soc < 0) soc = 0;
  mahUsed += battI * dt / 3.6;
  if (soc <= 0.0 && armed) { /* brownout: thrust collapses via voltage */ }

  // tank
  if (spraying) {
    tankL -= p(L.P_FLOW_LPM) * clamp(inp(L.I_FLOW), 0, 1) / 60.0 * dt; // pump knob scales flow
    if (tankL <= 0) {
      tankL = 0;
      if (!tankEmptyFlag) {
        tankEmptyFlag = true; ev(EV_TANK_EMPTY);
        // agri FC: tank empty during a mission → return home (mission keeps a breakpoint)
        if (armed && mode == M_AUTO && gpsGood) setMode(M_RTL);
      }
    }
  }
  updateMass();
}

function crash(cause: i32): void {
  crashed = true; crashCause = cause; armed = false;
  ev(EV_CRASH);
}

function collide(): void {
  const n = <i32>p(L.P_OBS_COUNT);
  const r = p(L.P_BODY_R);
  for (let k = 0; k < n && k < L.OBS_MAX; k++) {
    const b = L.P_OBS + k * L.OBS_STRIDE;
    const typ = <i32>p(b);
    const a1 = p(b + 1), a2 = p(b + 2), a3 = p(b + 3), a4 = p(b + 4), a5 = p(b + 5), a6 = p(b + 6), a7 = p(b + 7);
    if (typ == 1) { // vertical cylinder: x,y,z0,radius,height
      if (pz + r > a3 && pz - r < a3 + a5) {
        if (sq(px - a1) + sq(py - a2) < sq(a4 + r)) { crash(3); return; }
      }
    } else if (typ == 2) { // sphere: x,y,z,r
      if (sq(px - a1) + sq(py - a2) + sq(pz - a3) < sq(a4 + r * 0.7)) { crash(4); return; }
    } else if (typ == 3) { // box: cx,cy,cz,hx,hy,hz
      if (Math.abs(px - a1) < a4 + r && Math.abs(py - a2) < a5 + r && Math.abs(pz - a3) < a6 + r) { crash(5); return; }
    } else if (typ == 4) { // wire segment
      const sx = a4 - a1, sy = a5 - a2, sz2 = a6 - a3;
      const l2 = sx * sx + sy * sy + sz2 * sz2;
      let u = l2 > 0 ? ((px - a1) * sx + (py - a2) * sy + (pz - a3) * sz2) / l2 : 0;
      u = clamp(u, 0, 1);
      const cx = a1 + u * sx, cy = a2 + u * sy, cz = a3 + u * sz2;
      if (sq(px - cx) + sq(py - cy) + sq(pz - cz) < sq(r + a7)) { crash(6); return; }
    }
  }
}

// ---------- main step ----------
export function step(dt: f64, n: i32): void {
  for (let k = 0; k < n; k++) {
    t += dt;
    updateWind(dt);
    updateSensors(dt);
    control(dt);
    physics(dt);
    if (armed && !landed) flightTime += dt;
  }
  writeOut();
}

function writeOut(): void {
  o(L.O_T, t); o(L.O_X, px); o(L.O_Y, py); o(L.O_Z, pz);
  o(L.O_VX, vx); o(L.O_VY, vy); o(L.O_VZ, vz);
  o(L.O_QW, qw); o(L.O_QX, qx); o(L.O_QY, qy); o(L.O_QZ, qz);
  o(L.O_ROLL, roll()); o(L.O_PITCH, pitch()); o(L.O_YAW, yaw());
  o(L.O_P, wx); o(L.O_Q, wy); o(L.O_R, wz);
  for (let i = 0; i < 8; i++) o(L.O_M0 + i, i < nMot ? unchecked(MOT[i]) : 0);
  o(L.O_BATT_V, battV); o(L.O_BATT_I, battI); o(L.O_BATT_SOC, soc); o(L.O_BATT_MAH_USED, mahUsed);
  o(L.O_TANK_L, tankL); o(L.O_MASS, mass);
  o(L.O_WIND_X, windX); o(L.O_WIND_Y, windY); o(L.O_WIND_Z, windZ);
  o(L.O_SATS, inp(L.I_FAIL_GPS) > 0.5 ? 0 : sats); o(L.O_HDOP, hdop); o(L.O_FIX, <f64>fix);
  o(L.O_EST_X, estX); o(L.O_EST_Y, estY); o(L.O_BARO_ALT, baroAlt); o(L.O_RADAR_AGL, radarValid ? radarAgl : -1);
  o(L.O_MODE, <f64>mode); o(L.O_ARMED, armed ? 1 : 0); o(L.O_CRASHED, crashed ? 1 : 0); o(L.O_CRASH_CAUSE, <f64>crashCause);
  o(L.O_AIRSPEED, Math.sqrt(sq(vx - windX) + sq(vy - windY) + sq(vz - windZ)));
  o(L.O_GNDSPEED, Math.sqrt(vx * vx + vy * vy)); o(L.O_VSPEED, vz);
  o(L.O_THRUST, thrTotal); o(L.O_THR_OUT, thrOut);
  o(L.O_SPRAYING, spraying ? 1 : 0); o(L.O_ON_GROUND, onGround ? 1 : 0);
  o(L.O_HOME_DIST, Math.sqrt(sq(estX - homeX) + sq(estY - homeY)));
  let w: i32 = 0;
  if (fsLow) w |= 1;
  if (fsCrit) w |= 2;
  if (!gpsGood) w |= 4;
  if (Math.sqrt(windX * windX + windY * windY) > 8) w |= 8;
  if (vrsActive) w |= 16;
  if (tankEmptyFlag) w |= 32;
  if (fsRc) w |= 64;
  if (p(L.P_HAS_RADAR) > 0.5 && !radarValid) w |= 128;
  if (hdop > 1.5 && hdop < 50) w |= 256;
  o(L.O_WARN, <f64>w);
  o(L.O_SLOSH_X, sdx); o(L.O_SLOSH_Y, sdy); o(L.O_LANDED, landed ? 1 : 0);
  let hd = 90.0 - yawEst * 180.0 / PI; while (hd < 0) hd += 360; while (hd >= 360) hd -= 360;
  o(L.O_HEADING, hd);
  o(L.O_TGT_ALT, tgtAltOut); o(L.O_POWER_W, powerW); o(L.O_FLIGHT_TIME, flightTime);
}
