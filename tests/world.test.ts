import { describe, it, expect } from 'vitest';
import { PLACES, generateWorld, setWorld, obstacleList, HOME } from '../src/data/world';
import { makeSim, takeoff } from './harness';

const seeds = [...PLACES.map((p) => [p.category, p.seed] as const), ['agri', 4242] as const, ['wedding', 777777] as const];

describe('generated training grounds', () => {
  for (const [cat, seed] of seeds) {
    it(`${cat} #${seed}: fits obstacle slots, pad clear, take-off + hold OK`, async () => {
      setWorld(generateWorld(cat, seed));
      const obs = obstacleList();
      expect(obs.length).toBeLessThanOrEqual(96);
      // nothing within 6 m of the pad (cylinders/spheres/boxes by centre distance minus size)
      for (const o of obs) {
        if (o[0] === 4) continue;
        const r = o[0] === 3 ? Math.hypot(o[4], o[5]) : o[4];
        expect(Math.hypot(o[1] - HOME.x, o[2] - HOME.y) - r).toBeGreaterThan(6);
      }
      const h = await makeSim('dji_mavic3pro');
      takeoff(h, 2, 5);
      h.run(5);
      expect(h.o('CRASHED')).toBe(0);
    });
  }
});

describe('fly area (geofence)', () => {
  it('measures how far outside the drawn area the drone is', async () => {
    const { fenceBreach } = await import('../src/data/world');
    const w = generateWorld('agri', 0); w.geofence = [[-20, 10], [20, 10], [20, 60], [-20, 60]]; setWorld(w);
    expect(fenceBreach(0, 30)).toBe(0);
    expect(fenceBreach(25, 30)).toBeCloseTo(5, 5);
    expect(fenceBreach(0, 0)).toBeCloseTo(10, 5);
    setWorld(generateWorld('agri', 0));
    expect(fenceBreach(500, 500)).toBe(0); // no fence → never breached
  });
});
