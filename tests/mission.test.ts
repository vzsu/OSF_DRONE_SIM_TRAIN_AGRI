import { describe, it, expect } from 'vitest';
import { makeSim, type Harness } from './harness';
import { MissionRunner, planLanes, planLegs, missionStats, defaultPlan, type MissionPlan } from '../src/sim/mission';
import { Coverage } from '../src/sim/coverage';

const AUTO = 5;

/** Drive the sim with the mission runner like the browser engine does (every 4 physics steps). */
function fly(h: Harness, m: MissionRunner, sec: number, cov?: Coverage, each?: () => void) {
  const steps = Math.round(sec * 100);
  for (let i = 0; i < steps; i++) {
    const agl = h.o('RADAR_AGL') >= 0 ? h.o('RADAR_AGL') : h.o('Z');
    const r = m.step({ mode: h.o('MODE'), armed: h.o('ARMED') > 0.5, landed: h.o('LANDED') > 0.5, x: h.o('EST_X'), y: h.o('EST_Y'), agl, soc: h.o('BATT_SOC'), lowBatt: 25, tank: h.o('TANK_L'), hasTank: true });
    h.inp.auto = r.cmd;
    if (h.o('MODE') === AUTO) h.inp.spray = r.spray;
    h.run(0.01);
    cov?.update(h.o('SPRAYING') > 0.5, h.o('X'), h.o('Y'), agl, h.o('WIND_X'), h.o('WIND_Y'), 4);
    each?.();
  }
}

const small: MissionPlan = { poly: [[-10, 15], [10, 15], [10, 31], [-10, 31]], spacing: 4, height: 2.5, speed: 4, angleDeg: 0, margin: 1 };

describe('mission planning', () => {
  it('makes back-and-forth lanes inside the area', () => {
    const lanes = planLanes(small);
    expect(lanes.length).toBe(4);
    expect(lanes[0].a[0]).toBeLessThan(lanes[0].b[0]);
    expect(lanes[1].a[0]).toBeGreaterThan(lanes[1].b[0]); // reversed
    for (const l of lanes) for (const p of [l.a, l.b]) { expect(p[0]).toBeGreaterThanOrEqual(-9.01); expect(p[0]).toBeLessThanOrEqual(9.01); }
    const st = missionStats(defaultPlan(), 1.5, 10, [0, 0]);
    expect(st.areaHa).toBeCloseTo(0.81, 2);
    expect(st.lanes).toBeGreaterThan(20);
    expect(planLegs(small, [0, 0]).at(-1)!.b).toEqual([0, 0]);
  });
});

describe('AUTO spray mission', () => {
  it('flies all lanes, sprays only on lanes, lands home; coverage high', async () => {
    const h = await makeSim('marut_ag365h', { windSpd: 1.5, turb: 0.2 });
    const m = new MissionRunner(); m.load(small, [0, 0]);
    const cov = new Coverage(); cov.setTarget(small.poly);
    h.inp.mode = AUTO; h.run(0.2); h.arm();
    let maxXte = 0, sprayOffLane = 0;
    fly(h, m, 200, cov, () => {
      if (m.phase === 'leg' && m.legs[m.idx]?.spray && h.o('GNDSPEED') > 3) maxXte = Math.max(maxXte, m.xte);
      if (h.o('SPRAYING') > 0.5 && !(m.phase === 'leg' && m.legs[m.idx]?.spray)) sprayOffLane++;
    });
    expect(h.o('CRASHED')).toBe(0);
    expect(m.phase).toBe('done');
    expect(h.o('ARMED')).toBe(0);
    expect(Math.hypot(h.o('X'), h.o('Y'))).toBeLessThan(1.5);
    expect(maxXte).toBeLessThan(0.8);
    expect(sprayOffLane).toBe(0);
    const s = cov.stats();
    expect(s.coveredPct).toBeGreaterThan(80);
  }, 60000);

  it('tank empty → RTL with breakpoint; after refill resumes at the breakpoint', async () => {
    const h = await makeSim('marut_ag365h', { tankFill: 0.03 }); // 0.3 L → runs dry mid-mission
    const m = new MissionRunner(); m.load(small, [0, 0]);
    h.inp.mode = AUTO; h.run(0.2); h.arm();
    fly(h, m, 120);
    expect(m.breakpoint).not.toBeNull();
    expect(m.breakpoint!.reason).toBe('tank empty');
    expect(h.o('ARMED')).toBe(0); // RTL landed + auto-disarm
    const bp = { ...m.breakpoint! };
    h.core.service(1, 10);
    h.inp.armSw = 0; h.run(0.3); h.arm();
    let reached = Infinity;
    fly(h, m, 60, undefined, () => { if (h.o('SPRAYING') > 0.5) reached = Math.min(reached, Math.hypot(h.o('X') - bp.x, h.o('Y') - bp.y)); });
    expect(h.o('MODE')).toBe(AUTO);
    expect(reached).toBeLessThan(1.5); // spraying restarted right at the breakpoint
    expect(h.o('CRASHED')).toBe(0);
  }, 60000);
});

describe('training score', () => {
  it('scores an AUTO spray flight from its log', async () => {
    const { Recorder, LOG_SCHEMA, COLS } = await import('../src/logs/recorder');
    const { scoreFlight } = await import('../src/logs/score');
    const { droneById } = await import('../src/data/drones');
    const { ENV_PRESETS } = await import('../src/sim/wasm');
    const h = await makeSim('marut_ag365h', { windSpd: 1.5 });
    const m = new MissionRunner(); m.load(small, [0, 0]);
    const cov = new Coverage(); cov.setTarget(small.poly);
    const rec = new Recorder({ schema: LOG_SCHEMA, simVersion: 't', id: 'f1', trainee: 't', startedAt: '', drone: droneById('marut_ag365h'), env: ENV_PRESETS.calm, controller: 'x', linkDelayMs: 0 });
    h.inp.mode = AUTO; h.run(0.2); h.arm();
    let k = 0;
    fly(h, m, 150, cov, () => {
      if (k++ % 2) return;
      const agl = h.o('RADAR_AGL') >= 0 ? h.o('RADAR_AGL') : h.o('Z');
      const row = COLS.map((c) => ({ t: h.o('T'), mode: h.o('MODE'), armed: h.o('ARMED'), x: h.o('X'), y: h.o('Y'), z: h.o('Z'), vz: h.o('VZ'), roll: h.o('ROLL'), pitch: h.o('PITCH'), batt_soc: h.o('BATT_SOC'), spraying: h.o('SPRAYING'), agl, gnd_speed: h.o('GNDSPEED'), tank_l: h.o('TANK_L') } as Record<string, number>)[c] ?? 0);
      rec.add(row);
    });
    const log = rec.finish('Completed', 0, h.o('FLIGHT_TIME'));
    const r = scoreFlight(log, cov.stats(), small, 1.1);
    const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
    expect(by.height.score).toBeGreaterThan(70);
    expect(by.coverage.score).toBeGreaterThan(80);
    expect(by.clearance).toBeDefined();
    expect(r.total).toBeGreaterThan(60);
  }, 60000);
});
