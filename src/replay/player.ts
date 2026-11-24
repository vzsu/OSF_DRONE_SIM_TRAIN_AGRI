// 3D replay of a recorded flight (50 Hz log). Drives the normal renderer with a stand-in for the
// engine whose outputs come from the log, interpolated between samples. No physics runs.
import type { FlightLog } from '../logs/recorder';
import type { Engine } from '../sim/engine';
import { MODES } from '../sim/wasm';

export class ReplayPlayer {
  t = 0; speed = 1; playing = true;
  readonly duration: number;
  private d: Float32Array; private w: number; private n: number;
  private k: Record<string, number> = {};
  private i = 0;
  /** a stand-in for Engine used by World3D.update */
  readonly fake: Engine;

  constructor(readonly log: FlightLog) {
    this.d = new Float32Array(log.data); this.w = log.cols.length; this.n = log.rows;
    log.cols.forEach((c, j) => (this.k[c] = j));
    this.duration = this.n ? this.d[(this.n - 1) * this.w + this.k.t] : 0;
    const self = this, mass = log.header.drone.massEmpty;
    this.fake = {
      env: log.header.env, sticks: { flow: 1 },
      o(name: string) { return self.out(name, mass); },
    } as unknown as Engine;
  }

  /** value of a log column at time t (linear interpolation; yaw unwrapped) */
  col(c: string): number {
    const j = this.k[c];
    if (j === undefined || !this.n) return 0;
    const i = this.i, a = this.d[i * this.w + j];
    if (i + 1 >= this.n) return a;
    const t0 = this.d[i * this.w + this.k.t], t1 = this.d[(i + 1) * this.w + this.k.t];
    const u = t1 > t0 ? Math.min(1, Math.max(0, (this.t - t0) / (t1 - t0))) : 0;
    let b = this.d[(i + 1) * this.w + j];
    if (c === 'yaw' && Math.abs(b - a) > Math.PI) b += b > a ? -2 * Math.PI : 2 * Math.PI;
    return ['mode', 'armed', 'spraying', 'warn', 'crashed', 'sats'].includes(c) ? (u < 0.5 ? a : b) : a + (b - a) * u;
  }

  private out(name: string, mass: number): number {
    switch (name) {
      case 'X': return this.col('x');
      case 'Y': return this.col('y');
      case 'Z': return this.col('z');
      case 'VX': return this.col('vx');
      case 'VY': return this.col('vy');
      case 'VZ': return this.col('vz');
      case 'QW': case 'QX': case 'QY': case 'QZ': {
        // ZYX (yaw, pitch, roll) → quaternion, same convention as the physics core
        const cr = Math.cos(this.col('roll') / 2), sr = Math.sin(this.col('roll') / 2);
        const cp = Math.cos(this.col('pitch') / 2), sp = Math.sin(this.col('pitch') / 2);
        const cy = Math.cos(this.col('yaw') / 2), sy = Math.sin(this.col('yaw') / 2);
        return name === 'QW' ? cr * cp * cy + sr * sp * sy : name === 'QX' ? sr * cp * cy - cr * sp * sy : name === 'QY' ? cr * sp * cy + sr * cp * sy : cr * cp * sy - sr * sp * cy;
      }
      case 'ARMED': return this.col('armed');
      case 'MODE': return this.col('mode');
      case 'SPRAYING': return this.col('spraying');
      case 'TANK_L': return this.col('tank_l');
      case 'WIND_X': return this.col('wind_x');
      case 'WIND_Y': return this.col('wind_y');
      case 'WIND_Z': return this.col('wind_z');
      case 'MASS': return mass;
      case 'THRUST': return this.col('armed') > 0.5 ? mass * 9.81 * Math.min(1.5, 0.4 + this.col('thr_out')) : 0;
      case 'RADAR_AGL': return this.col('agl');
      default:
        if (/^M[0-7]$/.test(name)) return this.col('armed') > 0.5 ? 250 + 700 * this.col('thr_out') : 0;
        return 0;
    }
  }

  /** advance playback; returns true when it jumped backwards (trails must be cleared) */
  step(dt: number) {
    if (this.playing) this.t = Math.min(this.duration, this.t + dt * this.speed);
    if (this.t >= this.duration) this.playing = false;
    this.locate();
  }
  seek(t: number) { this.t = Math.max(0, Math.min(this.duration, t)); this.i = 0; this.locate(); }
  private locate() {
    const tc = this.k.t;
    while (this.i + 1 < this.n && this.d[(this.i + 1) * this.w + tc] <= this.t) this.i++;
    while (this.i > 0 && this.d[this.i * this.w + tc] > this.t) this.i--;
  }
  modeName() { return MODES[Math.round(this.col('mode'))] ?? '—'; }
}
