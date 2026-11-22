// Procedural drone audio (Web Audio API), driven by the physics every frame. No sample files.
//  • Rotor tone: blade-pass frequency f = rpm/60 × blades for EVERY motor separately, so unequal
//    motor speeds (manoeuvres, wind, a failed motor) beat against each other like a real multirotor.
//    rpm = rpmMax × normalised motor speed, rpmMax from a ~185 m/s tip-speed limit: 60·v/(π·D).
//  • Motor whine: electrical frequency = rpm/60 × pole pairs (14 for agri, 7 for small motors).
//  • Broadband rotor noise: filtered noise ∝ thrust^1.5 (≈ aero power).
//  • Listener: inverse-distance level + air absorption (low-pass falls with distance) + Doppler
//    shift from the radial speed, relative to the camera (VLOS pilot / chase / FPV).
//  • Wind on the microphone, spray pump hum, and RC-radio style alert beeps.
import type { Engine } from '../sim/engine';
import { settings } from '../settings';

const C = 343; // speed of sound m/s

interface Rotor { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; whine: OscillatorNode; wg: GainNode }

export class DroneSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private distLp!: BiquadFilterNode;
  private rotors: Rotor[] = [];
  private noise!: AudioBufferSourceNode;
  private noiseGain!: GainNode;
  private noiseBp!: BiquadFilterNode;
  private windGain!: GainNode;
  private pumpGain!: GainNode;
  private pumpOsc!: OscillatorNode;
  private droneKey = '';
  private lastDist = 0;
  private beepAt = 0;
  private lastWarn = 0;

  /** Browsers only allow audio after a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.distLp = c.createBiquadFilter(); this.distLp.type = 'lowpass'; this.distLp.frequency.value = 8000;
    this.distLp.connect(this.master);
    // white noise source shared by rotor broadband, wind and pump hiss
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = c.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true; this.noise.start();
    this.noiseBp = c.createBiquadFilter(); this.noiseBp.type = 'bandpass'; this.noiseBp.Q.value = 0.7;
    this.noiseGain = c.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseBp).connect(this.noiseGain).connect(this.distLp);
    const wlp = c.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 300;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    this.noise.connect(wlp).connect(this.windGain).connect(this.master);
    this.pumpOsc = c.createOscillator(); this.pumpOsc.type = 'square'; this.pumpOsc.frequency.value = 95;
    const plp = c.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 400;
    this.pumpGain = c.createGain(); this.pumpGain.gain.value = 0;
    this.pumpOsc.connect(plp).connect(this.pumpGain).connect(this.distLp); this.pumpOsc.start();
  }

  private build(e: Engine) {
    const c = this.ctx!;
    for (const r of this.rotors) { r.osc.stop(); r.osc2.stop(); r.whine.stop(); r.gain.disconnect(); r.wg.disconnect(); }
    this.rotors = [];
    const n = e.drone.nMotors;
    for (let i = 0; i < n; i++) {
      const osc = c.createOscillator(); osc.type = 'sawtooth';
      const osc2 = c.createOscillator(); osc2.type = 'triangle'; // 2nd harmonic body
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.8;
      const g2 = c.createGain(); g2.gain.value = 0.5;
      const gain = c.createGain(); gain.gain.value = 0;
      osc.connect(lp); osc2.connect(g2).connect(lp); lp.connect(gain).connect(this.distLp);
      const whine = c.createOscillator(); whine.type = 'sine';
      const wg = c.createGain(); wg.gain.value = 0;
      whine.connect(wg).connect(this.distLp);
      osc.start(); osc2.start(); whine.start();
      this.rotors.push({ osc, osc2, gain, whine, wg });
    }
    this.droneKey = e.drone.id;
  }

  update(e: Engine, cam: { x: number; y: number; z: number }, dt: number) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const on = settings.audio.on && !e.paused;
    this.master.gain.setTargetAtTime(on ? settings.audio.volume * 0.5 : 0, now, 0.05);
    if (!on) return;
    if (this.droneKey !== e.drone.id) this.build(e);
    const d = e.drone;
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    // listener geometry (sim ENU)
    const dx = o('X') - cam.x, dy = o('Y') - cam.y, dz = o('Z') - cam.z;
    const dist = Math.max(Math.hypot(dx, dy, dz), 0.5);
    const vr = dt > 0 ? (dist - this.lastDist) / dt : 0; this.lastDist = dist;
    const doppler = C / (C + Math.max(-60, Math.min(60, vr)));
    const att = 1 / (1 + dist / 4);                         // inverse distance (near-field limited)
    this.distLp.frequency.setTargetAtTime(Math.max(900, 12000 / (1 + dist / 25)), now, 0.05);
    const rpmMax = 60 * 185 / (Math.PI * d.propD);
    const blades = 2, poles = d.propD > 0.5 ? 14 : 7;
    const sizeK = Math.min(1.6, 0.35 + d.propD); // big props = more sound power
    let thrust = 0;
    this.rotors.forEach((r, i) => {
      const mi = o(('M' + i) as 'M0');
      thrust += mi * mi;
      const f = Math.max(1, rpmMax * mi / 60 * blades * doppler);
      r.osc.frequency.setTargetAtTime(f, now, 0.02);
      r.osc2.frequency.setTargetAtTime(f * 2, now, 0.02);
      r.gain.gain.setTargetAtTime(mi < 0.02 ? 0 : 0.10 * sizeK * mi * mi * att, now, 0.03);
      r.whine.frequency.setTargetAtTime(Math.max(1, rpmMax * mi / 60 * poles * doppler), now, 0.02);
      r.wg.gain.setTargetAtTime(mi < 0.02 ? 0 : 0.012 * mi * att, now, 0.03);
    });
    thrust /= Math.max(this.rotors.length, 1);
    this.noiseBp.frequency.setTargetAtTime(Math.max(200, rpmMax / 60 * blades * 4 * Math.sqrt(thrust)), now, 0.05);
    this.noiseGain.gain.setTargetAtTime(0.35 * sizeK * Math.pow(thrust, 0.75) * att, now, 0.05);
    // wind noise on the listener: pilot hears ground wind, FPV/chase hears airspeed
    const wind = settings.camera.view === 'vlos' || settings.camera.view === 'top' ? e.env.windSpd * 0.6 : o('AIRSPEED');
    this.windGain.gain.setTargetAtTime(Math.min(0.25, wind * wind * 0.004), now, 0.2);
    // spray pump
    this.pumpGain.gain.setTargetAtTime(o('SPRAYING') > 0.5 ? 0.05 * att : 0, now, 0.05);
    this.pumpOsc.frequency.setTargetAtTime(80 + 40 * e.sticks.flow, now, 0.1);
    // radio-style alert beeps for warnings (battery, GPS, RC loss)
    const w = o('WARN');
    if ((w & (1 | 2 | 4 | 64)) && now > this.beepAt) {
      const crit = (w & (2 | 64)) !== 0;
      this.beep(crit ? 1400 : 1000, crit ? 3 : 2);
      this.beepAt = now + (crit ? 1.5 : 4);
    }
    if (w !== this.lastWarn && (w & 128)) this.beep(600, 1);
    this.lastWarn = w;
  }

  silence() { if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }

  /** Short beep sequence (arming tones, mode change, alerts). */
  beep(freq: number, count = 1, len = 0.09) {
    if (!this.ctx || !settings.audio.on) return;
    const c = this.ctx, t0 = c.currentTime;
    for (let k = 0; k < count; k++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = freq;
      const s = t0 + k * len * 1.8;
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.06 * settings.audio.volume, s + 0.005);
      g.gain.setValueAtTime(0.06 * settings.audio.volume, s + len); g.gain.linearRampToValueAtTime(0, s + len + 0.01);
      o.connect(g).connect(c.destination); o.start(s); o.stop(s + len + 0.02);
    }
  }

  /** Event tones: arm = rising, disarm = falling, mode = chirp, crash = low buzz. */
  event(code: number) {
    if (code === 1) { this.beep(880, 1); setTimeout(() => this.beep(1320, 1), 120); }
    else if (code === 2) { this.beep(1320, 1); setTimeout(() => this.beep(880, 1), 120); }
    else if (code === 103) { [1318, 1046, 784].forEach((f, i) => setTimeout(() => this.beep(f, 1, 0.14), i * 190)); } // RTH: falling triple
    else if (code >= 100) this.beep(1760, 1, 0.05);
    else if (code === 10) this.beep(180, 1, 0.5);
    else if (code === 22) this.beep(300, 3, 0.15);
  }
}
