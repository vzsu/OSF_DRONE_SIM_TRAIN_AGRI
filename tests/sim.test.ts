import { describe, it, expect } from 'vitest';
import { makeSim, takeoff } from './harness';
import { DRONES } from '../src/data/drones';

const STAB = 0, ALTHOLD = 1, LOITER = 2, RTL = 3;

describe('arming', () => {
  it('arms with switch at low throttle, refuses with throttle up', async () => {
    const h = await makeSim();
    h.inp.thr = 0.5; h.inp.armSw = 1; h.run(0.5);
    expect(h.o('ARMED')).toBe(0);
    expect(h.events).toContain(4);
    h.inp.armSw = 0; h.inp.thr = 0; h.run(0.2); h.inp.armSw = 1; h.run(0.5);
    expect(h.o('ARMED')).toBe(1);
  });
  it('arms with stick gesture (throttle low + yaw right)', async () => {
    const h = await makeSim();
    h.inp.armSwEnabled = false; h.inp.thr = 0; h.inp.yaw = 1; h.run(2.0);
    expect(h.o('ARMED')).toBe(1);
  });
});

describe('AG365H flight', () => {
  it('climbs and holds altitude in ALT HOLD (calm)', async () => {
    const h = await makeSim();
    takeoff(h, ALTHOLD, 6);
    const z0 = h.o('Z');
    h.run(10);
    expect(h.o('CRASHED')).toBe(0);
    expect(Math.abs(h.o('Z') - z0)).toBeLessThan(0.6);
    expect(Math.abs(h.o('VZ'))).toBeLessThan(0.3);
  });

  it('LOITER holds position in calm air', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 6);
    const x0 = h.o('X'), y0 = h.o('Y');
    h.run(20);
    const drift = Math.hypot(h.o('X') - x0, h.o('Y') - y0);
    expect(drift).toBeLessThan(2.0);
  });

  it('LOITER holds in 6 m/s wind; ALT HOLD drifts downwind', async () => {
    const env = { windSpd: 6, windDir: 270, gust: 0.5, turb: 0.8 };
    const h = await makeSim('marut_ag365h', env);
    takeoff(h, LOITER, 8);
    const x0 = h.o('X'), y0 = h.o('Y');
    h.run(20);
    expect(Math.hypot(h.o('X') - x0, h.o('Y') - y0)).toBeLessThan(3.5);
    const h2 = await makeSim('marut_ag365h', { ...env, holdAssist: false }); // real ATTI: no position hold
    takeoff(h2, ALTHOLD, 8);
    const ax = h2.o('X');
    h2.run(6); // longer and it drifts into the power line (x=58) — realistic!
    // wind from west (270) blows east (+x)
    expect(h2.o('X') - ax).toBeGreaterThan(8);
    expect(h2.o('CRASHED')).toBe(0);
  });

  it('forward stick in LOITER reaches commanded speed', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 8);
    h.inp.pitch = 1; h.run(8);
    const gs = h.o('GNDSPEED');
    expect(gs).toBeGreaterThan(6);
    expect(gs).toBeLessThan(8);
    h.inp.pitch = 0; h.run(6);
    expect(h.o('GNDSPEED')).toBeLessThan(0.5);
    expect(h.o('CRASHED')).toBe(0);
  });

  it('attitude step response is stable (STABILIZE)', async () => {
    const h = await makeSim('marut_ag365h', { holdAssist: false });
    takeoff(h, ALTHOLD, 10);
    h.inp.roll = 0.6; // 15 deg
    let peak = 0; let t90 = -1; const tgt = 0.6 * 25 * Math.PI / 180; let t = 0;
    h.run(2.0, () => { t += 0.01; const r = h.o('ROLL'); peak = Math.max(peak, r); if (t90 < 0 && r > 0.9 * tgt) t90 = t; });
    expect(t90).toBeGreaterThan(0);
    expect(t90).toBeLessThan(1.2); // includes input shaping (heavy 30 kg airframe)
    expect(peak).toBeLessThan(tgt * 1.3);
    h.inp.roll = 0; h.run(3);
    expect(Math.abs(h.o('ROLL'))).toBeLessThan(0.05);
  });

  it('STABILIZE mid-stick roughly hovers', async () => {
    const h = await makeSim();
    // STABILIZE has no altitude hold: mid-stick ≈ hover thrust, so vertical speed should barely change
    takeoff(h, STAB, 6);
    const v0 = h.o('VZ');
    h.run(1);
    expect(Math.abs(h.o('VZ') - v0)).toBeLessThan(1.0);
    expect(h.o('CRASHED')).toBe(0);
  });

  it('hover endurance is plausible (full and empty tank)', async () => {
    for (const [fill, lo, hi] of [[1, 8, 18], [0, 16, 32]] as const) {
      const h = await makeSim('marut_ag365h', { tankFill: fill });
      takeoff(h, LOITER, 5);
      const s0 = h.o('BATT_SOC');
      h.run(30);
      const rate = (s0 - h.o('BATT_SOC')) / 30; // per second
      const minutes = (1 - 0.12) / rate / 60;
      expect(minutes).toBeGreaterThan(lo);
      expect(minutes).toBeLessThan(hi);
    }
  });

  it('spraying empties the tank and reduces mass', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 4);
    const m0 = h.o('MASS');
    h.inp.spray = true; h.run(60);
    expect(h.o('TANK_L')).toBeLessThan(10 - 1.3);
    expect(h.o('MASS')).toBeLessThan(m0 - 1.3);
    expect(h.o('SPRAYING')).toBe(1);
  });

  it('GPS loss in LOITER falls back to ALT HOLD', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 6);
    h.fail.gps = true; h.run(2);
    expect(h.o('MODE')).toBe(ALTHOLD);
    expect(h.events).toContain(6);
    expect(h.o('CRASHED')).toBe(0);
  });

  it('LOITER is denied without GPS', async () => {
    const h = await makeSim();
    h.fail.gps = true;
    takeoff(h, ALTHOLD, 5);
    h.inp.mode = LOITER; h.run(0.5);
    expect(h.o('MODE')).toBe(ALTHOLD);
    expect(h.events).toContain(17);
  });

  it('RC loss triggers RTL, returns home, lands and disarms', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 6);
    h.inp.pitch = 1; h.run(6); h.inp.pitch = 0; h.run(3);
    expect(h.o('HOME_DIST')).toBeGreaterThan(20);
    h.inp.rcOk = false;
    let maxGs = 0;
    h.run(70, () => { maxGs = Math.max(maxGs, h.o('GNDSPEED')); });
    expect(maxGs).toBeLessThan(7.5); // RTL must not overshoot the speed limit while turning
    expect(h.events).toContain(7);
    expect(h.o('HOME_DIST')).toBeLessThan(2.5);
    expect(h.o('ARMED')).toBe(0);
    expect(h.o('CRASHED')).toBe(0);
  });

  it('cutting throttle in STABILIZE from 12 m is a hard-landing crash', async () => {
    const h = await makeSim();
    takeoff(h, STAB, 12);
    h.inp.thr = 0.0; h.run(5);
    expect(h.o('CRASHED')).toBe(1);
    expect(h.o('CRASH_CAUSE')).toBe(1);
  });

  it('flying into the power line crashes with cause 6', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 8);
    // turn to face east (yaw right 90 deg), then fly forward toward the line at x=58
    h.inp.yaw = 1; h.run(1.5); h.inp.yaw = 0; h.run(1);
    h.inp.pitch = 1; h.run(20);
    expect(h.o('CRASHED')).toBe(1);
    expect(h.o('CRASH_CAUSE')).toBe(6);
  });

  it('motor failure on hexa (half tank): stays upright long enough to land', async () => {
    const h = await makeSim('marut_ag365h', { tankFill: 0.5 });
    takeoff(h, LOITER, 10);
    h.fail.motor = 1;
    let worst = 0;
    h.run(3, () => { worst = Math.max(worst, Math.abs(h.o('ROLL')), Math.abs(h.o('PITCH'))); });
    expect(h.o('CRASHED')).toBe(0);
    expect(h.o('Z')).toBeGreaterThan(4);
    expect(worst).toBeLessThan(1.2);
    expect(h.events).toContain(14);
  });

  it('is deterministic', async () => {
    const a = await makeSim('marut_ag365h', { windSpd: 5, turb: 1, gust: 0.6 });
    const b = await makeSim('marut_ag365h', { windSpd: 5, turb: 1, gust: 0.6 });
    takeoff(a, LOITER, 6); takeoff(b, LOITER, 6);
    a.run(5); b.run(5);
    expect(a.o('X')).toBe(b.o('X'));
    expect(a.o('Z')).toBe(b.o('Z'));
  });
});

describe('fixes from real Pocket flights (2026-11-22)', () => {
  it('full-stick roll reversal does not overshoot the tilt limit (input shaping + anti-windup)', async () => {
    const h = await makeSim();
    takeoff(h, ALTHOLD, 6);
    const lim = 25;
    let worst = 0;
    h.inp.roll = 1; h.run(1.2, () => { worst = Math.max(worst, Math.abs(h.o('ROLL') * 57.3)); });
    h.inp.roll = -1; h.run(1.5, () => { worst = Math.max(worst, Math.abs(h.o('ROLL') * 57.3)); });
    h.inp.roll = 0; h.run(3);
    expect(worst).toBeLessThan(lim * 1.12);
    expect(Math.abs(h.o('ROLL') * 57.3)).toBeLessThan(3); // small residual = liquid slosh settling
  });

  it('ALT HOLD full-down stick from 3 m lands softly (radar slows the descent near ground)', async () => {
    const h = await makeSim();
    takeoff(h, ALTHOLD, 3);
    h.inp.thr = 0; h.run(8);
    expect(h.o('CRASHED')).toBe(0);
    expect(h.o('LANDED')).toBe(1);
  });

  it('STABILIZE throttle near hover is gentle (0.40 → slow descent, not a drop)', async () => {
    const h = await makeSim();
    takeoff(h, STAB, 8);
    h.inp.thr = 0.5; h.run(1.5);
    const v0 = h.o('VZ');
    h.inp.thr = 0.4; h.run(1.5);
    expect(h.o('VZ') - v0).toBeGreaterThan(-2.0);
    expect(h.o('VZ') - v0).toBeLessThan(0);
  });

  it('emergency stop cuts motors in the air', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 6);
    h.inp.kill = true; h.run(0.3);
    expect(h.o('ARMED')).toBe(0);
    expect(h.events).toContain(22);
    h.run(3);
    expect(h.o('Z')).toBeLessThan(1);
  });

  it('cannot arm with the emergency stop switch on', async () => {
    const h = await makeSim();
    h.inp.kill = true; h.arm();
    expect(h.o('ARMED')).toBe(0);
    expect(h.events).toContain(23);
  });

  it('pump flow knob scales the spray rate', async () => {
    const h = await makeSim();
    takeoff(h, LOITER, 4);
    h.inp.spray = true; h.inp.flow = 0.5; h.run(40);
    const used = 10 - h.o('TANK_L');
    expect(used).toBeGreaterThan(0.45);
    expect(used).toBeLessThan(0.55); // 1.5 L/min × 50% × 40 s = 0.5 L
  });
});

describe('roster sanity', () => {
  for (const d of DRONES) {
    it(`${d.name} takes off and holds in LOITER`, async () => {
      const h = await makeSim(d.id, { windSpd: 2, turb: 0.3 });
      takeoff(h, LOITER, 6);
      const x0 = h.o('X'), y0 = h.o('Y'), z0 = h.o('Z');
      h.run(10);
      expect(h.o('CRASHED')).toBe(0);
      expect(Math.abs(h.o('Z') - z0)).toBeLessThan(1.0);
      expect(Math.hypot(h.o('X') - x0, h.o('Y') - y0)).toBeLessThan(2.5);
      expect(h.o('THR_OUT')).toBeGreaterThan(0.2);
      expect(h.o('THR_OUT')).toBeLessThan(0.75);
    });
  }
});

describe('hold modes do not drift (bug 2026-11-22)', () => {
  for (const id of ['marut_ag365h', 'dji_mavic3pro']) {
    it(`${id}: ALT HOLD/ATTI with hold assist and LOITER/P-GPS hold in 6 m/s wind`, async () => {
      for (const mode of [1, 2]) {
        const h = await makeSim(id, { windSpd: 6, turb: 0.4, gust: 0.3 });
        takeoff(h, mode, 6);
        const x0 = h.o('X'), y0 = h.o('Y');
        let mx = 0;
        h.run(20, () => { mx = Math.max(mx, Math.hypot(h.o('X') - x0, h.o('Y') - y0)); });
        expect(mx).toBeLessThan(id.startsWith('dji') ? 0.5 : 2.0);
      }
    });
  }
});
