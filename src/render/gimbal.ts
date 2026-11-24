// 3-axis stabilised camera gimbal of DJI camera drones (Mavic 3 Pro, Air 3S, Phantom 4 Pro).
// One instance drives both the pilot's CAMERA view and the camera picture sent to tablets/phones.
//
// Modes (as in DJI Fly / DJI Pilot):
//  follow — horizon always level (roll 0), pan follows the aircraft heading with smoothing,
//           tilt held at the commanded angle regardless of how the aircraft pitches or rolls
//  fpv    — like follow, but the camera also rolls with the aircraft (immersive / dutch angle)
//  track  — Spotlight / point-of-interest: camera stays locked on a subject; the flight
//           controller yaws the aircraft to keep it inside the gimbal's pan range (aircraftYawAssist)
//
// Tilt moves at a limited rate with smooth acceleration ("gimbal smoothness"), never jumps.
// Mechanical limits: tilt −90…+20°, pan ±(panLimit) around the aircraft nose.
// Three.js frame: y up; aircraft heading angle h = atan2(-fwd.z, fwd.x) (0 = east, CCW+).
import * as THREE from 'three';

export type GimbalMode = 'follow' | 'fpv' | 'track';

const DEG = Math.PI / 180;
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Gimbal {
  mode: GimbalMode = 'follow';
  /** commanded tilt in degrees (−90 = straight down, 0 = horizon, +20 = up) */
  tiltCmd = -15;
  /** actual tilt (deg) after rate limiting */
  tilt = -15;
  private tiltRate = 0;
  /** actual pan heading of the camera (rad, three.js heading convention) */
  pan = NaN;
  /** subject for track mode (three.js world coordinates) */
  target: THREE.Vector3 | null = null;
  /** tilt speed limit (deg/s) and smoothing of pan follow (s) — like DJI "gimbal max speed / smoothness" */
  maxTiltRate = 60;
  panTau = 0.35;
  panLimit = 35 * DEG;
  readonly q = new THREE.Quaternion();

  setTilt(deg: number) { this.tiltCmd = Math.max(-90, Math.min(20, deg)); }

  /** Aircraft heading (rad) from its body quaternion: direction of the nose projected on the ground. */
  static heading(droneQ: THREE.Quaternion): number {
    const f = new THREE.Vector3(1, 0, 0).applyQuaternion(droneQ); f.y = 0;
    if (f.lengthSq() < 1e-8) return 0;
    return Math.atan2(-f.z, f.x);
  }

  /** Advance the gimbal. camPos = camera position (world), dt in s. Returns the camera orientation. */
  update(droneQ: THREE.Quaternion, camPos: THREE.Vector3, dt: number): THREE.Quaternion {
    const h = Gimbal.heading(droneQ);
    if (Number.isNaN(this.pan)) this.pan = h;
    let panWant = h, tiltWant = this.tiltCmd;
    if (this.mode === 'track' && this.target) {
      const d = this.target.clone().sub(camPos);
      const horiz = Math.hypot(d.x, d.z);
      panWant = Math.atan2(-d.z, d.x);
      tiltWant = Math.max(-90, Math.min(20, Math.atan2(d.y, horiz) / DEG));
      // the gimbal can only pan a little either side of the nose; the aircraft turns for the rest
      const off = wrap(panWant - h);
      panWant = h + Math.max(-this.panLimit, Math.min(this.panLimit, off));
    }
    // pan: first-order smoothing (follow), faster in track so the subject stays centred
    const tau = this.mode === 'track' ? 0.12 : this.panTau;
    this.pan = wrap(this.pan + wrap(panWant - this.pan) * (1 - Math.exp(-Math.max(dt, 0) / tau)));
    // tilt: rate-limited with smooth acceleration (no jumps)
    const err = tiltWant - this.tilt;
    const wantRate = Math.max(-this.maxTiltRate, Math.min(this.maxTiltRate, err * 4));
    this.tiltRate += (wantRate - this.tiltRate) * Math.min(1, dt * 12);
    this.tilt += this.tiltRate * dt;
    if (Math.abs(err) < 0.05 && Math.abs(this.tiltRate) < 0.5) { this.tilt = tiltWant; this.tiltRate = 0; }
    if (this.mode === 'track') this.tiltCmd = this.tilt; // so leaving track keeps the framing
    // orientation: pan about world up, tilt about the camera's right axis, roll only in FPV mode
    const e = new THREE.Euler(this.tilt * DEG, this.pan - Math.PI / 2, 0, 'YXZ');
    if (this.mode === 'fpv') {
      const right = new THREE.Vector3(0, 0, 1).applyQuaternion(droneQ); // aircraft left/right axis
      e.z = Math.asin(Math.max(-1, Math.min(1, -right.y)));
    }
    this.q.setFromEuler(e);
    return this.q;
  }

  /** Track mode: how much the aircraft must yaw (rad, + = turn left/CCW) to keep the subject centred. */
  aircraftYawError(droneQ: THREE.Quaternion, camPos: THREE.Vector3): number {
    if (this.mode !== 'track' || !this.target) return 0;
    const d = this.target.clone().sub(camPos);
    return wrap(Math.atan2(-d.z, d.x) - Gimbal.heading(droneQ));
  }

  /** Lock on whatever is in the centre of the picture: the point on the ground the camera looks at. */
  lockOnCentre(camPos: THREE.Vector3, fallback: THREE.Vector3) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
    if (dir.y < -0.05) {
      const t = -camPos.y / dir.y;
      this.target = camPos.clone().addScaledVector(dir, Math.min(t, 300));
    } else this.target = fallback.clone();
    this.mode = 'track';
  }
}
