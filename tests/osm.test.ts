import { describe, it, expect } from 'vitest';
import { worldFromOsm, enu, type OsmJson } from '../src/maps/osm';
import { setWorld, obstacleList } from '../src/data/world';
import { makeSim, takeoff } from './harness';

describe('real map → training ground', () => {
  it('builds trees, buildings, power line and the farmland outline from OSM data', async () => {
    const lat0 = 21.0532, lon0 = 81.737, c = enu(lat0, lon0);
    let id = 1;
    const els: OsmJson['elements'] = [];
    const node = (x: number, y: number, tags?: Record<string, string>) => { const [la, lo] = c.from(x, y); els.push({ type: 'node', id, lat: la, lon: lo, tags }); return id++; };
    const way = (pts: [number, number][], tags: Record<string, string>) => { const ids = pts.map(([x, y]) => node(x, y)); els.push({ type: 'way', id: id++, nodes: [...ids, ids[0]], tags }); };
    way([[-40, 20], [40, 20], [40, 100], [-40, 100]], { landuse: 'farmland' });
    way([[30, -30], [40, -30], [40, -22], [30, -22]], { building: 'house' });
    way([[-2, -2], [2, -2], [2, 2], [-2, 2]], { building: 'yes' }); // on the pad → must be skipped
    node(-50, 40, { natural: 'tree' }); node(-50, 60, { natural: 'tree' });
    const p1 = node(60, -40), p2 = node(60, 60), p3 = node(60, 140);
    els.push({ type: 'way', id: id++, nodes: [p1, p2, p3], tags: { power: 'minor_line' } });
    const w = worldFromOsm({ elements: els }, lat0, lon0, 'test field');
    expect(w.fieldPoly?.length).toBe(4);
    expect(w.field.x0).toBeCloseTo(-40, 0); expect(w.field.y1).toBeCloseTo(100, 0);
    expect(w.boxes.length).toBe(1);
    expect(w.trees.length).toBe(2);
    expect(w.poles.length).toBe(3);
    expect(w.wires.length).toBe(4);
    setWorld(w);
    expect(obstacleList().length).toBeLessThanOrEqual(96);
    const h = await makeSim('marut_ag365h');
    takeoff(h, 2, 5); h.run(4);
    expect(h.o('CRASHED')).toBe(0);
  });
});
