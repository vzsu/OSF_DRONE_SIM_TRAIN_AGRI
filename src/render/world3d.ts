// Three.js world: real 360° HDRI environment (or procedural sky), textured farm field with 3D crops,
// cameras (VLOS / chase / FPV / top), spray particles, training aids.
// Coordinates: physics ENU (x east, y north, z up) → three (x, z, -y).
import * as THREE from 'three';
import { FIELD, TREES, POLES, WIRES, HOUSE, WATER_TANK, HOME, WORLD, BOXES, PILLARS, CROWD } from '../data/world';
import type { DroneDef } from '../data/drones';
import { buildDrone, type DroneModel } from './droneModel';
import { loadHdri, HDRIS } from './environment';
import type { Engine } from '../sim/engine';
import { settings, type View } from '../settings';
import { cropById, grassById } from '../data/crops';
import { Gimbal } from './gimbal';

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const texLoader = new THREE.TextureLoader();

function tex(url: string, repeat: number, srgb: boolean) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function padTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3d40'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Leafy crop card texture (alpha-tested), drawn procedurally. */
function cropTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x0 = 64 + (rnd() - 0.5) * 16, y0 = 128;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.6, len = 60 + rnd() * 60;
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const hue = 85 + rnd() * 30, light = 22 + rnd() * 16;
    g.strokeStyle = `hsl(${hue} 55% ${light}%)`; g.lineWidth = 4 + rnd() * 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 30, (y0 + y1) / 2, x1, y1); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Foliage cards: crossed quads in both windings with upward-biased normals, so both sides are lit
 *  like foliage (no black back faces) without needing DoubleSide. */
function foliageCards(w: number, h: number, planes: number, yBase: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
    for (const flip of [false, true]) {
      const base = pos.length / 3;
      const corners = [[-cx, yBase, -cz, 0, 0], [cx, yBase, cz, 1, 0], [cx, yBase + h, cz, 1, 1], [-cx, yBase + h, -cz, 0, 1]];
      for (const [x, y, z, u, v] of corners) { pos.push(x, y, z); uv.push(u, v); nor.push(-Math.sin(a) * 0.25 * (flip ? -1 : 1), 0.95, Math.cos(a) * 0.25 * (flip ? -1 : 1)); }
      if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2); else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Leaf-cluster texture for tree crowns. */
function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = 14 + rnd() * 100, y = 14 + rnd() * 100, r = 5 + rnd() * 7, a = rnd() * Math.PI;
    g.fillStyle = `hsl(${88 + rnd() * 28} ${40 + rnd() * 20}% ${18 + rnd() * 22}%)`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.45, a, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Soft round droplet sprite. */
function dropletTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(235,245,255,0.35)'); grd.addColorStop(1, 'rgba(235,245,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Radial alpha mask so the near-ground grass blends into the HDRI ground. */
function radialMask(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#000');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class World3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 4000);
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a30, 1.0);
  drone: DroneModel | null = null;
  droneDef: DroneDef | null = null;
  private lookTarget = new THREE.Vector3();
  private chasePos = new THREE.Vector3();
  private windsock = new THREE.Group();
  private sock!: THREE.Mesh;
  private marker!: THREE.Mesh;
  private arrow!: THREE.ArrowHelper;
  private pilot = new THREE.Group();
  private proceduralGround!: THREE.Mesh;
  private nearGrass!: THREE.Mesh;
  private shadowCatcher!: THREE.Mesh;
  private skybox: THREE.Object3D | null = null;
  private sunOffset = new THREE.Vector3(30, 80, 20);
  envId = '';
  // spray particles
  private N = 3000;
  private pPos = new Float32Array(this.N * 3);
  private pVel = new Float32Array(this.N * 3);
  private pLife = new Float32Array(this.N);
  private pNext = 0;
  private pGeo = new THREE.BufferGeometry();
  private pts!: THREE.Points;
  private hq = settings.display.quality === 'high';
  private lessonGroup = new THREE.Group();
  private lessonMeshes: THREE.Object3D[] = [];
  private markerKey = '';
  private contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false, color: 0x000000 }));
  // training ground (rebuilt when the place changes)
  private site = new THREE.Group();
  private siteKey = '';
  // rotor downwash + wind sway on the crop canopy (vertex shader uniforms)
  private cropUniforms = { uDrone: { value: new THREE.Vector3(0, -100, 0) }, uStrength: { value: 0 }, uRad: { value: 2 }, uTime: { value: 0 }, uWind: { value: 0 } };
  // flight trail
  private TRAIL_MAX = 1500;
  private trailPos = new Float32Array(this.TRAIL_MAX * 3);
  private groundTrailPos = new Float32Array(this.TRAIL_MAX * 3);
  private trailCol = new Float32Array(this.TRAIL_MAX * 3);
  private trailGeo = new THREE.BufferGeometry();
  private groundTrailGeo = new THREE.BufferGeometry();
  private trail!: THREE.Line;
  private groundTrail!: THREE.Line;
  private trailN = 0;
  private trailLast = new THREE.Vector3(1e9, 1e9, 1e9);
  // stabilised gimbal camera (camera drones)
  /** one stabilised gimbal shared by the CAMERA view and the tablet / phone camera feed */
  gimbal = new Gimbal();
  get gimbalPitch() { return this.gimbal.tilt; }
  set gimbalPitch(v: number) { this.gimbal.setTilt(v); }
  /** camera position under the nose (world) — updated every frame */
  gimbalPos = new THREE.Vector3();
  // auxiliary drone-camera render for LAN screens (set by LinkHost)
  auxCtx: CanvasRenderingContext2D | null = null;
  private auxCam = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 4000);
  private auxQ = new THREE.Quaternion();
  private auxAt = 0;
  private auxBuf: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.hq && !lowMemoryPC() ? 1.5 : 1));
    // integrated GPUs share system RAM: if the GPU runs out, Chrome kills the context.
    // Show what happened and reload when it comes back, instead of a frozen black screen.
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); showGpuLost(); });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.hq;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera; sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 400;
    this.buildWorld();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** '' / 'procedural' = simple sky; otherwise an HDRI id from HDRIS. */
  async setEnvironment(id: string, hour: number) {
    if (id === this.envId) return;
    this.envId = id;
    if (this.skybox) { this.scene.remove(this.skybox); this.skybox = null; }
    if (!id || id === 'procedural' || !HDRIS.some((h) => h.id === id)) {
      this.scene.environment = null;
      this.proceduralGround.visible = true; this.nearGrass.visible = false; this.shadowCatcher.visible = false;
      this.hemi.visible = true;
      this.setTimeOfDay(hour);
      return;
    }
    // 4K HDRI ≈ 130 MB of GPU memory as float: only on PCs with more than 8 GB RAM
    const env = await loadHdri(this.renderer, id, this.hq && !lowMemoryPC());
    if (this.envId !== id) return; // user switched again while loading
    this.skybox = env.skybox;
    this.scene.add(env.skybox);
    this.scene.environment = env.envMap;
    this.scene.background = null;
    // aerial perspective: distant crops/trees fade into the photographed horizon colour
    this.scene.fog = new THREE.FogExp2(env.horizon, 0.0016);
    this.hemi.visible = false;
    this.proceduralGround.visible = false; this.nearGrass.visible = true; this.shadowCatcher.visible = true;
    // the sun light matches the photographed sun so shadows agree with the scan
    this.sunOffset.copy(env.sunDir).multiplyScalar(120);
    const el = Math.max(env.sunElevation, 0.05);
    this.sun.intensity = 1.2 + 2.4 * Math.min(el / 0.9, 1);
    this.sun.color.setRGB(1, 0.93 + 0.07 * Math.min(el / 0.6, 1), 0.82 + 0.18 * Math.min(el / 0.6, 1));
  }

  setTimeOfDay(hour: number) {
    if (this.skybox) return;
    const a = ((hour - 6) / 12) * Math.PI;
    const elev = Math.max(0.08, Math.sin(a));
    this.sunOffset.copy(v3(Math.cos(a) * 100, -40, elev * 120));
    const warm = 1 - elev;
    this.sun.color.setRGB(1, 0.92 - warm * 0.25, 0.85 - warm * 0.4);
    this.sun.intensity = 0.8 + elev * 2.4;
    const sky = new THREE.Color().setHSL(0.57, 0.55, 0.45 + elev * 0.3);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 250, 1600);
  }

  private buildWorld() {
    const s = this.scene;
    // procedural fallback ground
    this.proceduralGround = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), antiTile(new THREE.MeshStandardMaterial({ map: tex('/tex/aerial_grass_rock_diff.jpg', 400, true), roughness: 1 })));
    this.proceduralGround.rotation.x = -Math.PI / 2; this.proceduralGround.receiveShadow = true; s.add(this.proceduralGround);
    // near-ground grass that fades into the HDRI ground
    this.nearGrass = new THREE.Mesh(new THREE.CircleGeometry(160, 64), antiTile(new THREE.MeshStandardMaterial({
      map: tex('/tex/aerial_grass_rock_diff.jpg', 40, true), normalMap: tex('/tex/aerial_grass_rock_nor.jpg', 40, false),
      alphaMap: radialMask(), transparent: true, roughness: 1, depthWrite: false,
    })));
    this.nearGrass.rotation.x = -Math.PI / 2; this.nearGrass.position.copy(v3(0, 40, 0.01)); this.nearGrass.receiveShadow = true; this.nearGrass.renderOrder = 1;
    this.nearGrass.visible = false; s.add(this.nearGrass);
    // invisible plane that only shows shadows (over the HDRI ground)
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.45 }));
    this.shadowCatcher.rotation.x = -Math.PI / 2; this.shadowCatcher.position.y = 0.015; this.shadowCatcher.receiveShadow = true; this.shadowCatcher.renderOrder = 2;
    this.shadowCatcher.visible = false; s.add(this.shadowCatcher);
    // the training ground itself (rebuilt when the place changes)
    s.add(this.site);
    this.buildSite();

    const steel = metalM();
    // windsock (left of pad, visible from the pilot spot)
    const sockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5, 8), steel); sockPole.position.y = 2.5; sockPole.castShadow = true; this.windsock.add(sockPole);
    const sockPivot = new THREE.Group(); sockPivot.position.y = 5; this.windsock.add(sockPivot);
    const sockGeo = new THREE.ConeGeometry(0.3, 1.6, 16, 4, true); sockGeo.rotateZ(Math.PI / 2); sockGeo.translate(-0.8, 0, 0);
    this.sock = new THREE.Mesh(sockGeo, new THREE.MeshStandardMaterial({ color: 0xff5a1a, side: THREE.DoubleSide, roughness: 0.8 }));
    this.sock.castShadow = true; sockPivot.add(this.sock);
    this.windsock.position.copy(v3(-14, 4, 0)); s.add(this.windsock);
    // pilot figure
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color: 0x2a5ca8, roughness: 0.8 }));
    body.position.y = 0.75; this.pilot.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshStandardMaterial({ color: 0xb98a62, roughness: 0.7 }));
    head.position.y = 1.55; this.pilot.add(head);
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.225, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0x332200, roughness: 0.6 }));
    vest.position.y = 1.05; this.pilot.add(vest);
    this.pilot.traverse((o) => (o.castShadow = true));
    s.add(this.pilot);
    // pad
    const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.85 }));
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = -HOME.yaw + Math.PI / 2; pad.position.copy(v3(HOME.x, HOME.y, 0.045)); pad.receiveShadow = true; pad.renderOrder = 4; s.add(pad);
    s.add(this.lessonGroup);
    // contact shadow under the drone
    this.contact.rotation.x = -Math.PI / 2; this.contact.renderOrder = 4; s.add(this.contact);
    // training aids
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 32), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.renderOrder = 5; s.add(this.marker);
    this.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 2, 0x3ccf7a, 0.6, 0.35); s.add(this.arrow);
    // flight trail: 3D path (blue = oldest → yellow = newest) + faint ground track for the height cue
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    this.trail.frustumCulled = false; this.trail.renderOrder = 6; s.add(this.trail);
    this.groundTrailGeo.setAttribute('position', new THREE.BufferAttribute(this.groundTrailPos, 3));
    this.groundTrailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.groundTrailGeo.setDrawRange(0, 0);
    this.groundTrail = new THREE.Line(this.groundTrailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }));
    this.groundTrail.frustumCulled = false; this.groundTrail.renderOrder = 5; s.add(this.groundTrail);
    // spray particles
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pts = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ map: dropletTexture(), color: 0xf4faff, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
    this.pts.frustumCulled = false;
    for (let i = 0; i < this.N; i++) this.pPos[i * 3 + 1] = -100;
    s.add(this.pts);
  }

  /** Lesson gates / boxes / landing targets / orbit subject (rebuilt when the list changes). */
  /** Lesson markers as real field-training aids — NOT floating game rings:
   *  orange cones + a flat ground circle (lime = next, grey = done, white = later), a marker pole with a
   *  small disc when a target height matters, a ground square for hover boxes, a pole for orbit subjects. */
  setMarkers(list: { x: number; y: number; z: number; r: number; kind: string; state: string }[], _dronePos?: THREE.Vector3) {
    const key = list.map((m) => `${m.kind}:${m.r}:${m.z.toFixed(1)}`).join('|');
    if (this.markerKey !== key) {
      this.markerKey = key;
      this.lessonGroup.clear(); this.lessonMeshes = [];
      const coneM = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 });
      const bandM = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.5 });
      for (const m of list) {
        const g = new THREE.Group();
        const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
        if (m.kind === 'gate' || m.kind === 'pad') {
          const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(m.r - 0.12, 0.1), m.r, 64), flat);
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.renderOrder = 6; g.add(ring);
        }
        if (m.kind === 'gate') {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.72, 20), coneM); cone.position.y = 0.36; cone.castShadow = true; g.add(cone);
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.165, 0.1, 20), bandM); band.position.y = 0.42; g.add(band);
          if (m.z > 0.5) {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, m.z, 8), bandM); pole.position.y = m.z / 2; g.add(pole);
            const disc = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), flat); disc.rotation.x = -Math.PI / 2; disc.position.y = m.z; g.add(disc);
          }
        } else if (m.kind === 'box') {
          const r = m.r, pts = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([a2, b2]) => new THREE.Vector3(a2, 0.07, b2));
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
          for (const [a2, b2] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 16), coneM); c.position.set(a2, 0.25, b2); g.add(c); }
        } else if (m.kind === 'poi') {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 10), coneM); pole.position.y = 3; g.add(pole);
        }
        g.renderOrder = 6; this.lessonGroup.add(g); this.lessonMeshes.push(g);
      }
    }
    list.forEach((m, i) => {
      const g = this.lessonMeshes[i]; if (!g) return;
      g.position.copy(v3(m.x, m.y, 0));
      const col = m.state === 'next' ? 0xd8ff3d : m.state === 'done' ? 0x9aa39d : 0xffffff;
      g.traverse((o) => { const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (mat && mat.type === 'MeshBasicMaterial') { mat.color.setHex(col); mat.opacity = m.state === 'idle' ? 0.4 : 0.85; } if (mat && mat.type === 'LineBasicMaterial') (mat as unknown as THREE.LineBasicMaterial).color.setHex(col); });
    });
  }

  /** Rebuild the training ground after setWorld() (new place / category). */
  rebuildSite() {
    if (this.siteKey === this.siteId()) return;
    this.site.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) { const sm = mt as THREE.MeshStandardMaterial; sm.map?.dispose(); sm.normalMap?.dispose(); mt.dispose(); }
    });
    this.site.clear();
    this.buildSite();
  }

  private buildSite() {
    const s = this.site;
    this.siteKey = this.siteId();
    const tint = grassById(settings.env.grass).tint;
    for (const m of [this.proceduralGround, this.nearGrass]) (m.material as THREE.MeshStandardMaterial).color.setHex(tint);
    const addBox = (x: number, y: number, w: number, d: number, h: number, m: THREE.Material, z0 = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.copy(v3(x, y, z0 + h / 2)); b.receiveShadow = true; b.castShadow = true; s.add(b); return b;
    };
    const fw = FIELD.x1 - FIELD.x0, fh = FIELD.y1 - FIELD.y0;
    const fcx = (FIELD.x0 + FIELD.x1) / 2, fcy = (FIELD.y0 + FIELD.y1) / 2;
    if (WORLD.mockup) {
      // real map as a clean MOCKUP: flat ground, roads, water, buildings as outlined footprint blocks
      const groundM = new THREE.MeshStandardMaterial({ color: 0xc9d3b4, roughness: 1 });
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundM);
      gp.rotation.x = -Math.PI / 2; gp.position.copy(v3(0, 45, 0.02)); gp.receiveShadow = true; gp.renderOrder = 3; s.add(gp);
      const flat = (poly: [number, number][], color: number, z: number) => {
        const sh = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
        m.rotation.x = -Math.PI / 2; m.position.y = z; m.receiveShadow = true; m.renderOrder = 3; s.add(m); return m;
      };
      if (WORLD.fieldPoly) flat(WORLD.fieldPoly, 0xa9c27a, 0.03);
      for (const wt of WORLD.water ?? []) flat(wt, 0x6fa8d6, 0.035);
      const roadM = new THREE.MeshStandardMaterial({ color: 0xe8e2d3, roughness: 1 });
      for (const rd of WORLD.roads ?? []) for (let i = 1; i < rd.length; i++) {
        const [ax, ay] = rd[i - 1], [bx, by] = rd[i], L = Math.hypot(bx - ax, by - ay); if (L < 0.5) continue;
        const seg = new THREE.Mesh(new THREE.PlaneGeometry(L + 1, 4), roadM);
        seg.rotation.x = -Math.PI / 2; seg.rotation.z = Math.atan2(by - ay, bx - ax);
        seg.position.copy(v3((ax + bx) / 2, (ay + by) / 2, 0.04)); seg.receiveShadow = true; seg.renderOrder = 3; s.add(seg);
      }
      if (WORLD.fieldPoly) this.buildCrops();
      // buildings: real footprints extruded, light faces + dark outlines (architectural-model look)
      const wallM = new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.95 });
      const edgeM = new THREE.LineBasicMaterial({ color: 0x2b2b2b });
      for (const b of BOXES) {
        const poly = b.poly && b.poly.length >= 3 ? b.poly : [[b.x - b.hx, b.y - b.hy], [b.x + b.hx, b.y - b.hy], [b.x + b.hx, b.y + b.hy], [b.x - b.hx, b.y + b.hy]] as [number, number][];
        const geo = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y))), { depth: b.h, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // shape XY → ground XZ (y north → −z), extrusion → up
        const mesh = new THREE.Mesh(geo, wallM); mesh.castShadow = true; mesh.receiveShadow = true; s.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeM); s.add(edges);
      }
    } else if (WORLD.ground) {
      // real map: satellite picture as the ground, OSM buildings, crops inside the real field outline
      const gd = WORLD.ground;
      const t = texLoader.load(gd.url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const sat = new THREE.Mesh(new THREE.PlaneGeometry(gd.x1 - gd.x0, gd.y1 - gd.y0), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
      sat.rotation.x = -Math.PI / 2; sat.position.copy(v3((gd.x0 + gd.x1) / 2, (gd.y0 + gd.y1) / 2, 0.025)); sat.receiveShadow = true; sat.renderOrder = 3; s.add(sat);
      if (WORLD.fieldPoly) this.buildCrops();
      const wallM = new THREE.MeshStandardMaterial({ color: 0xe2d6c0, roughness: 0.95 });
      const roofM = new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.9 });
      for (const b of BOXES) {
        addBox(b.x, b.y, b.hx * 2, b.hy * 2, b.h, wallM);
        addBox(b.x, b.y, b.hx * 2 + 0.3, b.hy * 2 + 0.3, 0.25, roofM, b.h);
      }
    } else if (WORLD.category === 'agri') {
      // field: ploughed soil + instanced crop rows + bunds
      const crop = cropById(settings.env.crop);
      const soil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), antiTileM({
        map: tex('/tex/brown_mud_dry_diff.jpg', 25, true), normalMap: tex('/tex/brown_mud_dry_nor.jpg', 25, false), roughness: 0.95,
        color: new THREE.Color(crop.soil).lerp(new THREE.Color(0xffffff), 0.45),
      }));
      if (crop.id === 'paddy') {
        // flooded paddy: thin reflective water sheet between the plants
        const water = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshStandardMaterial({ color: 0x4a5a48, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.75 }));
        water.rotation.x = -Math.PI / 2; water.position.copy(v3(fcx, fcy, 0.06)); water.renderOrder = 3; s.add(water);
      }
      soil.rotation.x = -Math.PI / 2; soil.position.copy(v3(fcx, fcy, 0.03));
      soil.receiveShadow = true; soil.renderOrder = 3; s.add(soil);
      this.buildCrops();
      const bund = new THREE.MeshStandardMaterial({ map: tex('/tex/brown_mud_dry_diff.jpg', 4, true), color: 0xc8b49a, roughness: 1 });
      addBox(fcx, FIELD.y0, fw + 0.6, 0.6, 0.3, bund);
      addBox(fcx, FIELD.y1, fw + 0.6, 0.6, 0.3, bund);
      addBox(FIELD.x0, fcy, 0.6, fh, 0.3, bund);
      addBox(FIELD.x1, fcy, 0.6, fh, 0.3, bund);
      // distance flags every 25 m along the west edge
      const flagM = new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.6, side: THREE.DoubleSide });
      const poleM = new THREE.MeshStandardMaterial({ color: 0xdddddd });
      for (let y = FIELD.y0 + 13; y <= FIELD.y1; y += 25) {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), poleM); f.position.copy(v3(FIELD.x0 - 2, y, 0.9)); f.castShadow = true; s.add(f);
        const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), flagM); tag.position.copy(v3(FIELD.x0 - 1.7, y, 1.55)); s.add(tag);
      }
    } else {
      this.buildWedding(addBox);
    }
    // dirt track
    const road = new THREE.Mesh(new THREE.PlaneGeometry(300, 4.5), new THREE.MeshStandardMaterial({ map: tex('/tex/brown_mud_dry_diff.jpg', 1, true), color: 0xd8c8b0, roughness: 1 }));
    (road.material as THREE.MeshStandardMaterial).map!.repeat.set(60, 1);
    road.rotation.x = -Math.PI / 2; road.position.copy(v3(0, -8, 0.035)); road.receiveShadow = true; road.renderOrder = 3; s.add(road);
    this.buildTrees();
    // poles + cables (power line for agri, light poles + string lights for weddings)
    const concrete = new THREE.MeshStandardMaterial({ color: 0xa7a59c, roughness: 0.9 });
    const steel = metalM();
    const wedding = WORLD.category === 'wedding';
    for (const p of POLES) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(wedding ? 0.06 : 0.1, wedding ? 0.09 : 0.17, p.h, 12), wedding ? steel : concrete);
      pole.position.copy(v3(p.x, p.y, p.h / 2)); pole.castShadow = true; s.add(pole);
      if (!wedding) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), steel); cross.position.copy(v3(p.x, p.y, p.h - 0.3)); cross.castShadow = true; s.add(cross);
        for (const off of [-0.6, 0.6]) { const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.3 })); ins.position.copy(v3(p.x + off, p.y, p.h - 0.17)); s.add(ins); }
      }
    }
    const cableM = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
    const bulbs: THREE.Vector3[] = [];
    for (const w of WIRES) {
      const curve = new THREE.CatmullRomCurve3(w.pts.map(([x, y, z]) => v3(x, y, z)));
      s.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, w.lights ? 0.008 : 0.012, 5, false), cableM));
      if (w.lights) for (let k = 0; k <= 30; k++) bulbs.push(curve.getPoint(k / 30));
    }
    if (bulbs.length) {
      const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc04a, emissiveIntensity: 2.2 }), bulbs.length);
      const mm = new THREE.Matrix4();
      bulbs.forEach((b, i) => bm.setMatrixAt(i, mm.makeTranslation(b.x, b.y - 0.07, b.z)));
      s.add(bm);
    }
    // farmhouse / banquet hall
    if (HOUSE.hx < 0.5) { this.buildTank(steel); return; }
    const wall = new THREE.MeshStandardMaterial({ color: wedding ? 0xf1e9dc : 0xe4d6b8, roughness: 0.95 });
    addBox(HOUSE.x, HOUSE.y, HOUSE.hx * 2, HOUSE.hy * 2, HOUSE.h, wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(HOUSE.hx, HOUSE.hy) * 1.05, 2.2, 4), new THREE.MeshStandardMaterial({ color: 0x9a4430, roughness: 0.8, flatShading: true }));
    roof.rotation.y = Math.PI / 4; roof.scale.set(HOUSE.hx / HOUSE.hy * 0.9, 1, 1);
    roof.position.copy(v3(HOUSE.x, HOUSE.y, HOUSE.h + 1.1)); roof.castShadow = true; s.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshStandardMaterial({ color: 0x4a3322 })); door.position.copy(v3(HOUSE.x, HOUSE.y + HOUSE.hy + 0.01, 1.05)); s.add(door);
    this.buildTank(steel);
  }

  private buildTank(steel: THREE.Material) {
    const s = this.site;
    if (WORLD.waterTank) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, WATER_TANK.legH, 8), steel);
        leg.position.copy(v3(WATER_TANK.x + dx * 1.1, WATER_TANK.y + dy * 1.1, WATER_TANK.legH / 2)); leg.castShadow = true; s.add(leg);
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(WATER_TANK.r, WATER_TANK.r, WATER_TANK.tankH, 24), new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.7 }));
      tank.position.copy(v3(WATER_TANK.x, WATER_TANK.y, WATER_TANK.legH + WATER_TANK.tankH / 2)); tank.castShadow = true; s.add(tank);
    }
  }

  /** Wedding venue: lawn, stage, mandap, shamiana tents, guests. */
  private buildWedding(addBox: (x: number, y: number, w: number, d: number, h: number, m: THREE.Material, z0?: number) => THREE.Mesh) {
    const s = this.site;
    const fw = FIELD.x1 - FIELD.x0, fh = FIELD.y1 - FIELD.y0;
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), antiTileM({
      map: tex('/tex/aerial_grass_rock_diff.jpg', 12, true), color: 0x8fcf6a, roughness: 0.95,
    }));
    lawn.rotation.x = -Math.PI / 2; lawn.position.copy(v3((FIELD.x0 + FIELD.x1) / 2, (FIELD.y0 + FIELD.y1) / 2, 0.03)); lawn.receiveShadow = true; lawn.renderOrder = 3; s.add(lawn);
    const colors: Record<string, number> = { stage: 0x8a1c2b, canopy: 0xd94f2a, tent: 0xf4efe6, hall: 0xf1e9dc };
    for (const b of BOXES) {
      const m = new THREE.MeshStandardMaterial({ color: colors[b.kind] ?? 0xffffff, roughness: 0.85 });
      if (b.kind === 'tent') {
        // shamiana: open sides, fabric roof on poles
        addBox(b.x, b.y, b.hx * 2, b.hy * 2, 0.4, m, b.h - 0.4);
        const peak = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(b.hx, b.hy), 1.4, 4), new THREE.MeshStandardMaterial({ color: 0xc9302c, roughness: 0.8, flatShading: true }));
        peak.rotation.y = Math.PI / 4; peak.scale.set(b.hx / b.hy, 1, 1); peak.position.copy(v3(b.x, b.y, b.h + 0.7)); peak.castShadow = true; s.add(peak);
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, b.h, 8), m); p.position.copy(v3(b.x + dx * (b.hx - 0.2), b.y + dy * (b.hy - 0.2), b.h / 2)); s.add(p);
        }
      } else addBox(b.x, b.y, b.hx * 2, b.hy * 2, b.h, m, b.z0 ?? 0);
    }
    // mandap pillars with marigold garlands (orange)
    const pm = new THREE.MeshStandardMaterial({ color: 0xf2d16b, roughness: 0.5, metalness: 0.3 });
    for (const p of PILLARS) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, p.h, 12), pm); c.position.copy(v3(p.x, p.y, p.h / 2)); c.castShadow = true; s.add(c);
      const g = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 6, 12), new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.9 }));
      g.rotation.x = Math.PI / 2; g.position.copy(v3(p.x, p.y, p.h * 0.7)); s.add(g);
    }
    // guests (instanced, random clothing colours) + chairs implied by the seating area carpet
    for (const c of CROWD) {
      const carpet = new THREE.Mesh(new THREE.PlaneGeometry(c.x1 - c.x0, c.y1 - c.y0), new THREE.MeshStandardMaterial({ color: 0x7a2032, roughness: 1 }));
      carpet.rotation.x = -Math.PI / 2; carpet.position.copy(v3((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 0.04)); carpet.renderOrder = 3; s.add(carpet);
    }
    const ppl = WORLD.people;
    if (ppl.length) {
      const im = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.9, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), ppl.length);
      const mm = new THREE.Matrix4(), col = new THREE.Color();
      const palette = [0xe8b04a, 0xc2185b, 0x1e88e5, 0x43a047, 0xffffff, 0x8e24aa, 0xf4511e, 0x212121];
      ppl.forEach(([x, y], i) => {
        const p = v3(x, y, 0.65); im.setMatrixAt(i, mm.makeTranslation(p.x, p.y, p.z));
        im.setColorAt(i, col.setHex(palette[i % palette.length]));
      });
      im.castShadow = true; s.add(im);
    }
  }

  private siteId() { return `${WORLD.category}:${WORLD.seed}:${WORLD.mapId ?? ''}:${settings.env.crop}:${settings.env.grass}`; }

  private buildCrops() {
    const crop = cropById(settings.env.crop);
    if (!crop.height) return;
    // keep the instance count bounded: thin out dense crops (paddy, wheat) and make each card wider
    const area = (FIELD.x1 - FIELD.x0) * (FIELD.y1 - FIELD.y0);
    const maxN = this.hq ? 60000 : 22000;
    const k0 = Math.max(1, Math.sqrt(area / (crop.row * crop.step) / maxN));
    const row = crop.row * k0, step = crop.step * k0, w = crop.cardW * Math.min(k0, 2.2);
    const xs: number[] = [];
    for (let x = FIELD.x0 + 0.6; x < FIELD.x1 - 0.4; x += row) xs.push(x);
    const perRow = Math.floor((FIELD.y1 - FIELD.y0 - 1.2) / step);
    const count = xs.length * perRow;
    const geo = foliageCards(w, crop.height, crop.height > 1.5 ? 3 : 2, 0);
    const mat = new THREE.MeshStandardMaterial({ map: cropTexture(), alphaTest: 0.45, roughness: 0.85 });
    // bend the plants away from the rotor downwash and sway them in the wind (world-space vertex shader)
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.cropUniforms);
      sh.vertexShader = 'uniform vec3 uDrone; uniform float uStrength; uniform float uRad; uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wp = modelMatrix * mvPosition;
        float hh = max(wp.y, 0.0);
        vec2 dd = wp.xz - uDrone.xz; float rr = length(dd) + 0.001;
        float f = uStrength * exp(-rr * rr / (uRad * uRad)) * hh;
        wp.xz += dd / rr * f * 0.8; wp.y -= f * 0.3 * hh;
        wp.x += sin(uTime * 1.7 + wp.x * 0.6 + wp.z * 0.35) * 0.04 * hh * uWind;
        mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let k = 0, seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const poly = WORLD.fieldPoly;
    const inside = (x: number, y: number) => {
      if (!poly) return true;
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
      return c;
    };
    for (const x of xs) for (let j = 0; j < perRow; j++) {
      const y = FIELD.y0 + 0.6 + j * step + (rnd() - 0.5) * 0.12;
      if (!inside(x, y)) continue;
      p.copy(v3(x + (rnd() - 0.5) * 0.1, y, 0.03));
      q.setFromAxisAngle(up, rnd() * Math.PI);
      const s = 0.75 + rnd() * 0.5; sc.set(s, s * (0.85 + rnd() * 0.3), s);
      m.compose(p, q, sc); mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, col.setHSL(crop.hue + (rnd() - 0.5) * 0.04, crop.sat, crop.light + rnd() * 0.15));
      k++;
    }
    mesh.count = k;
    mesh.receiveShadow = true;
    this.site.add(mesh);
  }

  private buildTrees() {
    if (!TREES.length) return;
    const barkM = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 });
    const cardsPerTree = this.hq ? 220 : 110;
    const leaves = new THREE.InstancedMesh(foliageCards(1.3, 1.3, 2, -0.65), new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, roughness: 0.9 }), TREES.length * cardsPerTree);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let k = 0;
    TREES.forEach((t, i) => {
      const trunkH = t.trunkH + t.crownR * 0.5;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, trunkH, 9), barkM);
      tr.position.copy(v3(t.x, t.y, trunkH / 2)); tr.castShadow = true; this.site.add(tr);
      for (let b = 0; b < 4; b++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, t.crownR * 0.9, 6), barkM);
        const a = b * 1.57 + i;
        br.position.copy(v3(t.x + Math.cos(a) * t.crownR * 0.25, t.y + Math.sin(a) * t.crownR * 0.25, t.trunkH + t.crownR * 0.25));
        br.rotation.set(Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8); br.castShadow = true; this.site.add(br);
      }
      const hue = 0.25 + (i % 5) * 0.012;
      for (let c = 0; c < cardsPerTree; c++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.35);
        const sx = Math.sqrt(1 - u * u) * Math.cos(th) * rr, sz = Math.sqrt(1 - u * u) * Math.sin(th) * rr, sy = u * rr;
        p.copy(v3(t.x + sx * t.crownR, t.y + sz * t.crownR, t.trunkH + t.crownR * 0.75 + sy * t.crownR * 0.8));
        q.setFromEuler(e.set((rnd() - 0.5) * 0.9, rnd() * Math.PI, (rnd() - 0.5) * 0.9));
        const s = 0.7 + rnd() * 0.6; sc.set(s, s, s);
        m.compose(p, q, sc); leaves.setMatrixAt(k, m);
        leaves.setColorAt(k, col.setHSL(hue, 0.5, 0.42 + 0.25 * Math.max(0, sy) + 0.15 * rr));
        k++;
      }
    });
    leaves.castShadow = true;
    this.site.add(leaves);
    // soft ambient-occlusion pools under every crown (one instanced quad each)
    const ao = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5 }), TREES.length);
    const am = new THREE.Matrix4();
    TREES.forEach((t, i) => { const p2 = v3(t.x, t.y, 0.05); am.makeScale(t.crownR * 2.6, 1, t.crownR * 2.6).setPosition(p2); ao.setMatrixAt(i, am); });
    ao.renderOrder = 4; this.site.add(ao);
  }

  /** Reset the flight trail (new flight). */
  resetTrail() { this.trailN = 0; this.trailGeo.setDrawRange(0, 0); this.groundTrailGeo.setDrawRange(0, 0); this.trailLast.set(1e9, 1e9, 1e9); }

  private updateTrail(pos: THREE.Vector3, armed: boolean) {
    const show = settings.display.trail !== false;
    this.trail.visible = show; this.groundTrail.visible = show && pos.y > 0.5;
    if (!armed || this.trailLast.distanceToSquared(pos) < 0.25) return;
    this.trailLast.copy(pos);
    const M = this.TRAIL_MAX;
    if (this.trailN >= M) { // drop the oldest point
      this.trailPos.copyWithin(0, 3); this.groundTrailPos.copyWithin(0, 3); this.trailN = M - 1;
    }
    const i = this.trailN * 3;
    this.trailPos[i] = pos.x; this.trailPos[i + 1] = pos.y; this.trailPos[i + 2] = pos.z;
    this.groundTrailPos[i] = pos.x; this.groundTrailPos[i + 1] = 0.06; this.groundTrailPos[i + 2] = pos.z;
    this.trailN++;
    // colour gradient along the trail: blue (oldest) → yellow (newest)
    const n = this.trailN;
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) : 1;
      this.trailCol[k * 3] = 0.12 + 0.88 * u; this.trailCol[k * 3 + 1] = 0.45 + 0.45 * u; this.trailCol[k * 3 + 2] = 1.0 - 0.9 * u;
    }
    this.trailGeo.setDrawRange(0, n); this.groundTrailGeo.setDrawRange(0, n);
    (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.groundTrailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.groundTrailGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  setDrone(d: DroneDef) {
    if (this.drone) this.scene.remove(this.drone.group);
    this.drone = buildDrone(d); this.droneDef = d;
    this.scene.add(this.drone.group);
    this.marker.scale.setScalar(Math.max(d.bodyR, 0.4));
    this.arrow.setLength(Math.max(d.bodyR * 1.6, 0.8), Math.max(d.bodyR * 0.5, 0.25), Math.max(d.bodyR * 0.3, 0.15));
  }

  update(e: Engine, dtReal: number) {
    if (!this.drone || !this.droneDef) return;
    const o = (k: Parameters<Engine['o']>[0]) => e.o(k);
    const pos = v3(o('X'), o('Y'), o('Z'));
    const q = new THREE.Quaternion(o('QX'), o('QZ'), -o('QY'), o('QW'));
    this.drone.group.position.copy(pos);
    this.drone.group.quaternion.copy(q);
    for (let i = 0; i < this.drone.props.length; i++) this.drone.setRpm(i, e.o(('M' + Math.min(i, 7)) as 'M0'), dtReal);
    if (this.droneDef.tankCap > 0) this.drone.setLevel(o('TANK_L') / this.droneDef.tankCap);
    // sun/shadow camera follows the drone
    this.sun.target.position.copy(pos); this.sun.position.copy(pos).add(this.sunOffset);
    // aids
    {
      // soft contact shadow / ambient occlusion: darkest on the ground, widens and fades with height
      const hgt = Math.max(o('Z'), 0), r0 = Math.max(this.droneDef.bodyR, 0.3) * 2.2;
      this.contact.position.set(pos.x, 0.055, pos.z);
      this.contact.scale.setScalar(r0 * (1 + hgt * 0.12));
      (this.contact.material as THREE.MeshBasicMaterial).opacity = 0.62 / (1 + hgt * 0.45);
      this.contact.visible = hgt < 25;
    }
    this.marker.visible = settings.display.groundMarker && o('Z') > 0.8;
    this.marker.position.set(pos.x, 0.07, pos.z);
    this.arrow.visible = settings.display.orientArrow;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); fwd.y = 0; fwd.normalize();
    this.arrow.position.copy(pos).add(new THREE.Vector3(0, Math.max(this.droneDef.bodyR, 0.3) * 0.6 + 0.3, 0));
    this.arrow.setDirection(fwd);
    // windsock: ground wind
    const env = e.env;
    const wdir = env.windDir * Math.PI / 180;
    const toE = -Math.sin(wdir), toN = -Math.cos(wdir);
    const spd = env.windSpd * Math.pow(5 / 10, 0.143) + Math.sin(performance.now() / 700) * env.turb * 0.4;
    this.windsock.rotation.y = Math.atan2(-toN, -toE);
    const droop = (1 - Math.min(Math.max(spd, 0) / 7, 1)) * 1.3;
    (this.sock.parent as THREE.Object3D).rotation.z = droop;
    this.pilot.position.copy(v3(settings.camera.pilotX, settings.camera.pilotY, 0));
    this.pilot.lookAt(pos.x, 0, pos.z);
    this.updateSpray(e, pos, q, dtReal);
    this.updateTrail(pos, o('ARMED') > 0.5);
    if (this.droneDef.fc === 'dji') {
      this.gimbalPos.copy(pos).add(new THREE.Vector3(Math.max(this.droneDef.bodyR * 0.35, 0.08), -Math.max(this.droneDef.bodyR * 0.12, 0.05), 0).applyQuaternion(q));
      this.gimbal.update(q, this.gimbalPos, dtReal);
    }
    {
      const cu = this.cropUniforms, d = this.droneDef;
      const agl = Math.max(o('Z') - (e.env.cropH ?? 0), 0.3);
      cu.uDrone.value.copy(pos);
      cu.uStrength.value = Math.min(1.2, o('THRUST') / (o('MASS') * 9.81 + 1e-3) * d.propD * 1.6 / (0.4 + agl * 0.6));
      cu.uRad.value = d.bodyR * 1.3 + agl * 0.35;
      cu.uTime.value = performance.now() / 1000;
      cu.uWind.value = Math.min(3, e.env.windSpd / 3 + e.env.turb);
    }
    this.updateCamera(settings.camera.view, pos, q, dtReal);
    this.pilot.visible = true;
    if (this.auxCtx && performance.now() - this.auxAt > 66) { this.auxAt = performance.now(); this.renderAux(pos, q, dtReal); }
    this.pilot.visible = settings.camera.view !== 'vlos';
    this.drone.group.visible = settings.camera.view !== 'fpv' && settings.camera.view !== 'cam';
    this.renderer.render(this.scene, this.camera);
  }

  private updateSpray(e: Engine, pos: THREE.Vector3, q: THREE.Quaternion, dt: number) {
    const spraying = e.o('SPRAYING') > 0.5 && this.drone!.nozzles.length > 0;
    const wind = v3(e.o('WIND_X'), e.o('WIND_Y'), e.o('WIND_Z'));
    const vel = v3(e.o('VX'), e.o('VY'), e.o('VZ'));
    if (spraying && dt > 0) {
      const perNozzle = Math.ceil(260 * dt * Math.max(e.sticks.flow, 0.15));
      for (const nz of this.drone!.nozzles) {
        const wp = nz.clone().applyQuaternion(q).add(pos);
        for (let k = 0; k < perNozzle; k++) {
          const i = this.pNext; this.pNext = (this.pNext + 1) % this.N;
          this.pPos[i * 3] = wp.x; this.pPos[i * 3 + 1] = wp.y; this.pPos[i * 3 + 2] = wp.z;
          // rotor downwash pushes droplets down, cone spray adds spread
          const down = new THREE.Vector3((Math.random() - 0.5) * 1.4, -5 - Math.random() * 2.5, (Math.random() - 0.5) * 1.4).applyQuaternion(q);
          this.pVel[i * 3] = vel.x + down.x; this.pVel[i * 3 + 1] = vel.y + down.y; this.pVel[i * 3 + 2] = vel.z + down.z;
          this.pLife[i] = 4;
        }
      }
    }
    for (let i = 0; i < this.N; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const j = i * 3;
      const k = Math.min(1, 1.6 * dt);
      this.pVel[j] += (wind.x - this.pVel[j]) * k;
      this.pVel[j + 1] += (-1.2 - this.pVel[j + 1]) * k * 0.6;
      this.pVel[j + 2] += (wind.z - this.pVel[j + 2]) * k;
      this.pPos[j] += this.pVel[j] * dt; this.pPos[j + 1] += this.pVel[j + 1] * dt; this.pPos[j + 2] += this.pVel[j + 2] * dt;
      if (this.pPos[j + 1] < 0.05 || this.pLife[i] <= 0) { this.pLife[i] = 0; this.pPos[j + 1] = -100; }
    }
    (this.pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateCamera(view: View, pos: THREE.Vector3, q: THREE.Quaternion, dt: number) {
    const c = this.camera, cs = settings.camera, d = this.droneDef!;
    const a = 1 - Math.exp(-dt * 8);
    let fov = cs.fov;
    c.up.set(0, 1, 0);
    if (view === 'vlos') {
      const eye = v3(cs.pilotX, cs.pilotY, cs.eye);
      c.position.copy(eye);
      this.lookTarget.lerp(pos, 1 - Math.exp(-dt * 6));
      c.lookAt(this.lookTarget);
      if (cs.vlosZoom) { const dist = eye.distanceTo(pos); fov = Math.max(12, Math.min(cs.fov, cs.fov * 30 / Math.max(dist, 1))); }
    } else if (view === 'chase') {
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.set(1, 0, 0);
      fwd.normalize();
      const dist = Math.max(5, d.bodyR * 6);
      const want = pos.clone().addScaledVector(fwd, -dist).add(new THREE.Vector3(0, dist * 0.4, 0));
      want.y = Math.max(want.y, 0.6);
      this.chasePos.lerp(want, a);
      c.position.copy(this.chasePos);
      this.lookTarget.lerp(pos, Math.min(a * 1.5, 1));
      c.lookAt(this.lookTarget);
    } else if (view === 'fpv') {
      const off = new THREE.Vector3(Math.max(d.bodyR * 0.3, 0.1), Math.max(d.bodyR * 0.08, 0.05), 0).applyQuaternion(q);
      c.position.copy(pos).add(off);
      const look = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
      const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), cs.fpvTilt * Math.PI / 180);
      c.quaternion.copy(q).multiply(look).multiply(tilt);
      fov = Math.max(cs.fov, 75);
    } else if (view === 'cam') {
      // gimbal camera under the nose: 3-axis stabilised (horizon stays level), follows heading
      // smoothly, pitch set by the gimbal wheel (keys PageUp/PageDown or the radio knob)
      c.quaternion.copy(this.gimbal.q);
      c.position.copy(this.gimbalPos); void dt;
      fov = 52; // ~84° diagonal wide camera (Mavic / Air / Phantom class)
    } else {
      c.position.set(pos.x, Math.max(pos.y + 60, 60), pos.z);
      c.up.set(0, 0, -1);
      c.lookAt(pos.x, 0, pos.z);
    }
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  /** Render the drone's own camera into auxCtx (640×360): gimbal camera on DJI, nose FPV on agri.
   *  Drawn into a corner of the main framebuffer and read back before the main render clears it,
   *  so it gets the same tone mapping / colours as the screen. */
  private renderAux(pos: THREE.Vector3, q: THREE.Quaternion, dt: number) {
    const ctx = this.auxCtx!, W = ctx.canvas.width, H = ctx.canvas.height, d = this.droneDef!;
    void dt;
    if (d.fc === 'dji') { this.auxQ.copy(this.gimbal.q); this.auxCam.position.copy(this.gimbalPos); } // same gimbal as the pilot's view
    else {
      this.auxQ.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -20 * Math.PI / 180));
      this.auxCam.position.copy(pos).add(new THREE.Vector3(Math.max(d.bodyR * 0.35, 0.08), -Math.max(d.bodyR * 0.12, 0.05), 0).applyQuaternion(q));
    }
    this.auxCam.quaternion.copy(this.auxQ);
    this.auxCam.fov = d.fc === 'dji' ? 52 : 70; this.auxCam.updateProjectionMatrix();
    const r = this.renderer, dpr = r.getPixelRatio();
    const vis = this.drone!.group.visible; this.drone!.group.visible = false;
    r.setScissorTest(true); r.setViewport(0, 0, W / dpr, H / dpr); r.setScissor(0, 0, W / dpr, H / dpr);
    r.render(this.scene, this.auxCam);
    const gl = r.getContext();
    if (!this.auxBuf || this.auxBuf.length !== W * H * 4) this.auxBuf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.auxBuf);
    r.setScissorTest(false);
    const full = r.getSize(new THREE.Vector2()); r.setViewport(0, 0, full.x, full.y);
    this.drone!.group.visible = vis;
    const img = ctx.createImageData(W, H), src = this.auxBuf, row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(src.subarray((H - 1 - y) * row, (H - y) * row), y * row); // flip vertically
    ctx.putImageData(img, 0, 0);
  }

  snap(e: Engine) {
    const pos = v3(e.o('X'), e.o('Y'), e.o('Z'));
    this.lookTarget.copy(pos);
    this.chasePos.copy(pos).add(new THREE.Vector3(0, 4, 8));
    this.resetTrail();
    this.gimbal.pan = NaN; this.gimbal.mode = 'follow'; this.gimbal.target = null;
    for (let i = 0; i < this.N; i++) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -100; }
  }
}

/** ≤ 8 GB RAM (Chrome's navigator.deviceMemory) → integrated-GPU friendly settings. */
export function lowMemoryPC(): boolean {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return dm === undefined || dm <= 8;
}
function showGpuLost() {
  if (document.getElementById('gpu-lost')) return;
  const d = document.createElement('div'); d.id = 'gpu-lost'; d.className = 'pause'; d.style.zIndex = '95';
  d.innerHTML = `<div class="card" style="max-width:560px"><h2>Graphics memory ran out</h2>
    <p>The graphics card (it shares your PC's RAM) ran out of memory and the browser stopped 3D.</p>
    <ol><li>Close other programs (code editors, other browser tabs).</li><li>Settings → Display → <b>Low</b> quality, or Environment → <b>Simple sky</b>.</li>
    <li>If it keeps happening: fully quit Chrome and start it again (Chrome turns 3D off after repeated crashes).</li></ol>
    <button class="primary" onclick="location.reload()">Reload</button></div>`;
  document.body.appendChild(d);
}

/** Radial soft-shadow texture (ambient occlusion / contact shadow). */
let aoTex: THREE.Texture | null = null;
function aoTexture(): THREE.Texture {
  if (aoTex) return aoTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  aoTex = new THREE.CanvasTexture(c);
  // texture used as alpha: black material, alpha from the gradient
  return aoTex;
}

/** Anti-tiling ground shader: blends the texture with a rotated, rescaled copy of itself using a
 *  low-frequency noise mask, plus subtle macro brightness variation. Kills the visible repeat
 *  pattern of tiled ground textures for the cost of one extra texture read. */
function antiTile<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        float atHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float atNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(atHash(i), atHash(i + vec2(1, 0)), f.x), mix(atHash(i + vec2(0, 1)), atHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 atUv = vMapUv;
          float atN = atNoise(atUv * 0.35);
          vec2 atUv2 = mat2(0.8, -0.6, 0.6, 0.8) * atUv * 0.61 + vec2(0.37, 0.71);
          vec4 sampledDiffuseColor = mix(texture2D(map, atUv), texture2D(map, atUv2), smoothstep(0.35, 0.65, atN));
          sampledDiffuseColor.rgb *= 0.86 + 0.28 * atNoise(atUv * 0.05 + 3.1);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
  };
  return m;
}
const antiTileM = (p: THREE.MeshStandardMaterialParameters) => antiTile(new THREE.MeshStandardMaterial(p));

function metalM() { return new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: 0.45, metalness: 0.8 }); }
