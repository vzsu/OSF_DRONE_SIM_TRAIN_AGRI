import { describe, it, expect } from 'vitest';
import { BatteryBay } from '../src/sim/batteries';
import { makeSim, takeoff } from './harness';
import { writeParams, ENV_PRESETS } from '../src/sim/wasm';
import { droneById } from '../src/data/drones';
import { HOME, obstacleList, FIELD } from '../src/data/world';

describe('battery bay (3 packs, 1 charger)', () => {
  it('charges on the charger, refuses hot packs, enforces slots', () => {
    const b = new BatteryBay(); b.reset(1, 30, 6);
    expect(b.inDrone?.id).toBe('A');
    expect(b.move('C', 'drone')).toMatch(/Remove/);
    expect(b.move('C', 'charger')).toMatch(/busy/);
    const B = b.packs.find((p) => p.id === 'B')!;
    for (let i = 0; i < 6 * 60; i++) b.tick(1, 1, 0);
    expect(B.soc).toBe(1); expect(b.status(B)).toBe('Charged');
    // a hot pack waits to cool before charging
    b.move('B', 'ground'); const A = b.inDrone!; b.move('A', 'charger'); A.tempC = 60; A.soc = 0.3;
    b.tick(1, 0, 0); expect(A.soc).toBe(0.3); expect(b.status(A)).toMatch(/hot/);
    for (let i = 0; i < 900; i++) b.tick(1, 0, 0);
    expect(A.soc).toBeGreaterThan(0.3);
  });
});

describe('crop canopy radar', () => {
  it('holds ALT HOLD height above a 2.8 m sugarcane canopy over the field', async () => {
    const h = await makeSim('marut_ag365h');
    writeParams(h.core, droneById('marut_ag365h'), { ...ENV_PRESETS.calm, cropH: 2.8 }, HOME, obstacleList(), FIELD);
    h.core.setup();
    takeoff(h, 2, 4);
    // fly north into the field in LOITER, then check height above ground ≈ radar AGL + crop
    h.inp.pitch = 0.6; h.run(8); h.inp.pitch = 0; h.run(6);
    expect(h.o('Y')).toBeGreaterThan(FIELD.y0 + 3);
    expect(h.o('Z') - h.o('RADAR_AGL')).toBeCloseTo(2.8, 0);
    expect(h.o('CRASHED')).toBe(0);
  });
});
