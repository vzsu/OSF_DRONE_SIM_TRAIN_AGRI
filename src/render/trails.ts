// Flight trails (training aid), drawn as camera-facing ribbons so their width is exact in screen pixels
// (WebGL lines are always 1 px). Styles:
//   wingtip — two white, semi-transparent lines from the left/right arm tips; each point fades out
//             and disappears after 15 s (shows recent manoeuvres without clutter)
//   path    — one 4 px line, blue (oldest) → yellow (newest), kept for the whole flight
//   both    — wingtip + path
import * as THREE from 'three';

export type TrailStyle = 'off' | 'wingtip' | 'path' | 'both';
export const TRAIL_STYLES: TrailStyle[] = ['off', 'wingtip', 'path', 'both'];
export const TRAIL_LABEL: Record<TrailStyle, string> = { off: 'Off', wingtip: 'Wingtip (white, fades after 15 s)', path: 'Path (blue → yellow, 4 px)', both: 'Both' };

interface Pt { p: THREE.Vector3; t: number }

/** A screen-facing strip through a list of points, per-vertex RGBA, width in pixels. */
class Ribbon {
  mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private col: Float32Array;
  constructor(private max: number) {
    this.pos = new Float32Array(max * 2 * 3); this.col = new Float32Array(max * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 8;
  }
  /** pts oldest → newest; colour(i, n) → [r,g,b,a]; widthPx in screen pixels */
  update(pts: THREE.Vector3[], colour: (i: number, n: number) => [number, number, number, number], widthPx: number, cam: THREE.PerspectiveCamera, screenH: number) {
    const n = Math.min(pts.length, this.max);
    const k = 2 * Math.tan((cam.fov * Math.PI / 180) / 2) / Math.max(screenH, 1); // world size of 1 px at distance 1
    const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = pts[pts.length - n + i];
      const a = pts[pts.length - n + Math.max(0, i - 1)], b = pts[pts.length - n + Math.min(n - 1, i + 1)];
      dir.subVectors(b, a); if (dir.lengthSq() < 1e-10) dir.set(1, 0, 0);
      toCam.subVectors(cam.position, p);
      const half = widthPx * 0.5 * k * toCam.length();
      side.crossVectors(dir, toCam).normalize().multiplyScalar(half);
      tmp.copy(p).add(side); this.pos.set([tmp.x, tmp.y, tmp.z], i * 6);
      tmp.copy(p).sub(side); this.pos.set([tmp.x, tmp.y, tmp.z], i * 6 + 3);
      const c = colour(i, n); this.col.set(c, i * 8); this.col.set(c, i * 8 + 4);
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Trails {
  group = new THREE.Group();
  style: TrailStyle = 'path';
  private left: Pt[] = []; private right: Pt[] = []; private path: Pt[] = [];
  private rl = new Ribbon(400); private rr = new Ribbon(400); private rp = new Ribbon(1500);
  private lastSample = -1;
  static readonly FADE_S = 15;

  constructor() { this.group.add(this.rl.mesh, this.rr.mesh, this.rp.mesh); }

  reset() { this.left = []; this.right = []; this.path = []; this.lastSample = -1; }

  /** Sample the aircraft (three.js coords). span = distance from centre to each arm tip (m). */
  sample(pos: THREE.Vector3, q: THREE.Quaternion, span: number, armed: boolean, t: number) {
    if (!armed || t - this.lastSample < 0.05) return;
    const last = this.path[this.path.length - 1];
    if (last && last.p.distanceToSquared(pos) < 0.04 && t - last.t < 1) return; // hovering: don't pile up points
    this.lastSample = t;
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(span);
    this.left.push({ p: pos.clone().sub(right), t }); this.right.push({ p: pos.clone().add(right), t });
    this.path.push({ p: pos.clone(), t });
    if (this.path.length > 1500) this.path.shift();
  }

  /** Rebuild the ribbons for this frame. */
  draw(cam: THREE.PerspectiveCamera, screenH: number, t: number) {
    const wing = this.style === 'wingtip' || this.style === 'both', path = this.style === 'path' || this.style === 'both';
    // expire wingtip points older than 15 s
    while (this.left.length && t - this.left[0].t > Trails.FADE_S) { this.left.shift(); this.right.shift(); }
    this.rl.mesh.visible = this.rr.mesh.visible = wing && this.left.length > 1;
    this.rp.mesh.visible = path && this.path.length > 1;
    if (this.rl.mesh.visible) {
      const fade = (list: Pt[]) => (i: number): [number, number, number, number] => { const age = t - list[i].t; const a = 0.55 * Math.max(0, 1 - age / Trails.FADE_S); return [1, 1, 1, a]; };
      const lp = this.left.slice(-400), rp2 = this.right.slice(-400);
      this.rl.update(lp.map((x) => x.p), fade(lp), 2.5, cam, screenH);
      this.rr.update(rp2.map((x) => x.p), fade(rp2), 2.5, cam, screenH);
    }
    if (this.rp.mesh.visible) {
      // blue (oldest) → yellow (newest), 4 px
      this.rp.update(this.path.map((x) => x.p), (i, n) => { const u = n > 1 ? i / (n - 1) : 1; return [0.12 + 0.88 * u, 0.45 + 0.45 * u, 1 - 0.9 * u, 0.95]; }, 4, cam, screenH);
    }
  }

  /** points for the minimap (world xy via the caller's conversion) */
  get pathPoints() { return this.path; }
}
