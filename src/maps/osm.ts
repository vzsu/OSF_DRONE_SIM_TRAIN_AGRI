// Real-map training grounds (Chhattisgarh). Free sources only, no API keys:
//   • OpenStreetMap features via the Overpass API (buildings, trees, woods/orchards, farmland, power lines)
//   • Esri World Imagery satellite tiles for the ground picture
// Both go through the training server's proxy + disk cache (/geo/osm, /tiles/sat), so a saved map
// keeps working offline. The training box is the same size as every ground: x −80…80 m, y −50…140 m
// around the take-off point (home = 0,0).
import type { WorldDef, Tree, Pole, Wire, Box } from '../data/world';
import type { Pt } from '../sim/mission';

export const BOX = { x0: -80, x1: 80, y0: -50, y1: 140 };
/** ground picture area (bigger than the box, so the horizon looks real) */
export const GROUND = { x0: -200, x1: 200, y0: -150, y1: 250 };

const M_PER_DEG = 111320;
export function enu(lat0: number, lon0: number) {
  const k = Math.cos(lat0 * Math.PI / 180);
  return {
    to: (lat: number, lon: number): Pt => [(lon - lon0) * M_PER_DEG * k, (lat - lat0) * M_PER_DEG],
    from: (x: number, y: number): [number, number] => [lat0 + y / M_PER_DEG, lon0 + x / (M_PER_DEG * k)],
  };
}
export function bboxFor(lat0: number, lon0: number, r = BOX) {
  const c = enu(lat0, lon0);
  const [s, w] = c.from(r.x0, r.y0), [n, e] = c.from(r.x1, r.y1);
  return { s, w, n, e };
}

interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }
export interface OsmJson { elements: (OsmNode | OsmWay)[] }

const inBox = ([x, y]: Pt, m = 0) => x > BOX.x0 - m && x < BOX.x1 + m && y > BOX.y0 - m && y < BOX.y1 + m;
const clampBox = ([x, y]: Pt): Pt => [Math.max(BOX.x0, Math.min(BOX.x1, x)), Math.max(BOX.y0, Math.min(BOX.y1, y))];
function area(p: Pt[]) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }
function inPoly(x: number, y: number, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function rng(seed: number) { let s = seed % 2147483647 || 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

/** Build a training ground from OSM data around home (lat0, lon0). */
export function worldFromOsm(osm: OsmJson, lat0: number, lon0: number, name: string): WorldDef & { stats: Record<string, number> } {
  const c = enu(lat0, lon0);
  const nodes = new Map<number, OsmNode>();
  for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, e);
  const ways = osm.elements.filter((e): e is OsmWay => e.type === 'way');
  const pts = (w: OsmWay): Pt[] => w.nodes.map((id) => nodes.get(id)).filter((n): n is OsmNode => !!n).map((n) => c.to(n.lat, n.lon));
  const clearOfPad = (x: number, y: number, r: number) => Math.hypot(x, y) - r > 8;
  const r = rng(Math.round(Math.abs(lat0 * 1e5 + lon0 * 1e3)));

  // buildings → boxes (axis-aligned footprint), height from levels
  const boxes: Box[] = [];
  for (const w of ways) {
    if (!w.tags?.building) continue;
    const p = pts(w); if (p.length < 3 || !p.some((q) => inBox(q, 10))) continue;
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const hx = Math.max((x1 - x0) / 2, 1.5), hy = Math.max((y1 - y0) / 2, 1.5);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (!clearOfPad(cx, cy, Math.hypot(hx, hy))) continue;
    const lv = parseFloat(w.tags['building:levels'] ?? '');
    const h = Number.isFinite(lv) ? Math.min(lv * 3.2, 30) : w.tags.building === 'house' || w.tags.building === 'hut' ? 3.5 + r() * 2 : 4 + r() * 4;
    boxes.push({ x: cx, y: cy, hx: Math.min(hx, 30), hy: Math.min(hy, 30), h, kind: 'building', poly: p.slice(0, p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? -1 : undefined).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)] as Pt) });
  }
  boxes.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  // trees: mapped single trees, tree rows, and scattered trees in woods / orchards
  const trees: Tree[] = [];
  const addTree = (x: number, y: number) => {
    if (!inBox([x, y], 5) || !clearOfPad(x, y, 3) || trees.some((t) => Math.hypot(t.x - x, t.y - y) < 6)) return;
    trees.push({ x, y, trunkH: 2.5 + r() * 3, crownR: 2 + r() * 2 });
  };
  for (const n of nodes.values()) if (n.tags?.natural === 'tree') { const [x, y] = c.to(n.lat, n.lon); addTree(x, y); }
  for (const w of ways) {
    const t = w.tags ?? {};
    const p = pts(w);
    if (t.natural === 'tree_row') {
      for (let i = 1; i < p.length; i++) { const [a, b] = [p[i - 1], p[i]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d < L; d += 8) addTree(a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L); }
    } else if (t.natural === 'wood' || t.landuse === 'forest' || t.landuse === 'orchard' || t.natural === 'scrub') {
      if (p.length < 3) continue;
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      for (let k = 0; k < 60; k++) {
        const x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys));
        if (inPoly(x, y, p)) addTree(x, y);
      }
    }
  }
  trees.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  // power lines: poles at the way nodes, sagging wires between them
  const poles: Pole[] = [], wires: Wire[] = [];
  for (const w of ways) {
    const t = w.tags?.power; if (t !== 'line' && t !== 'minor_line') continue;
    const p = pts(w); const h = t === 'line' ? 18 : 9;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      if (!inBox(a, 30) && !inBox(b, 30)) continue;
      for (const q of [a, b]) if (!poles.some((o) => Math.hypot(o.x - q[0], o.y - q[1]) < 1)) poles.push({ x: q[0], y: q[1], h });
      for (const off of t === 'line' ? [-1.5, 1.5] : [-0.5, 0.5]) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * off, ny = (b[0] - a[0]) / L * off;
        const wp: [number, number, number][] = [];
        for (let k = 0; k <= 6; k++) { const u = k / 6; wp.push([a[0] + (b[0] - a[0]) * u + nx, a[1] + (b[1] - a[1]) * u + ny, h - 0.6 - Math.min(L / 40, 3) * 4 * u * (1 - u)]); }
        wires.push({ pts: wp });
      }
    }
  }

  // roads and water for the mockup ground (visual only)
  const roads: Pt[][] = [], water: Pt[][] = [];
  for (const w of ways) {
    const t = w.tags ?? {};
    const p = pts(w); if (p.length < 2 || !p.some((q) => inBox(q, 60))) continue;
    if (t.highway && roads.length < 40) roads.push(p.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)] as Pt));
    else if ((t.natural === 'water' || t.waterway === 'riverbank') && p.length > 3 && water.length < 10) water.push(p.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)] as Pt));
  }

  // farmland: the largest field touching the box becomes the spray field
  let fieldPoly: Pt[] | undefined;
  let best = 0;
  for (const w of ways) {
    const t = w.tags ?? {};
    if (t.landuse !== 'farmland' && t.landuse !== 'meadow') continue;
    const p = pts(w); if (p.length < 4) continue;
    const cp = p.map(clampBox);
    const a = area(cp);
    if (a > best && a > 400) { best = a; fieldPoly = cp.slice(0, cp[0][0] === cp[cp.length - 1][0] && cp[0][1] === cp[cp.length - 1][1] ? -1 : undefined); }
  }
  let field = { x0: -40, x1: 40, y0: 20, y1: 110, rowSpacing: 1.2 };
  if (fieldPoly) {
    const xs = fieldPoly.map((q) => q[0]), ys = fieldPoly.map((q) => q[1]);
    field = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), rowSpacing: 1.2 };
  }
  return {
    category: 'agri', seed: Math.round(lat0 * 1e4) * 100000 + Math.round(lon0 * 1e4), name,
    field, fieldPoly, trees: trees.slice(0, 30), poles: poles.slice(0, 10), wires: wires.slice(0, 24),
    house: { x: 1e4, y: 1e4, hx: 0.1, hy: 0.1, h: 0.1 }, waterTank: null,
    boxes: boxes.slice(0, 22), pillars: [], crowd: [], people: [],
    geo: { lat: lat0, lon: lon0 }, mockup: true, roads, water,
    stats: { buildings: boxes.length, trees: trees.length, poles: poles.length, fieldM2: Math.round(best) },
  };
}

/** Compose satellite tiles (zoom 18) into one ground picture covering GROUND (north up). */
export async function groundImage(lat0: number, lon0: number, px = 1024): Promise<string> {
  const c = enu(lat0, lon0);
  const [s, w] = c.from(GROUND.x0, GROUND.y0), [n, e] = c.from(GROUND.x1, GROUND.y1);
  const z = 18, N = 2 ** z;
  const tx = (lon: number) => (lon + 180) / 360 * N;
  const ty = (lat: number) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N; };
  const X0 = tx(w), X1 = tx(e), Y0 = ty(n), Y1 = ty(s);
  const cv = document.createElement('canvas'); cv.width = px; cv.height = px;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#5b6a3c'; g.fillRect(0, 0, px, px);
  const jobs: Promise<void>[] = [];
  for (let x = Math.floor(X0); x <= Math.floor(X1); x++) for (let y = Math.floor(Y0); y <= Math.floor(Y1); y++) {
    jobs.push(new Promise((res) => {
      const im = new Image();
      im.onload = () => { g.drawImage(im, (x - X0) / (X1 - X0) * px, (y - Y0) / (Y1 - Y0) * px, px / (X1 - X0) + 0.5, px / (Y1 - Y0) + 0.5); res(); };
      im.onerror = () => res();
      im.src = `/tiles/sat/${z}/${x}/${y}`;
    }));
  }
  await Promise.all(jobs);
  return cv.toDataURL('image/jpeg', 0.85);
}
