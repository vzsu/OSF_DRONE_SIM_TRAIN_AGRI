// Parametric PBR drone models built from the drone definition (true size, arm count, prop layout).
// Model space: +X = drone forward, +Y = up, -Z = drone left (three.js view of body FLU).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { DroneDef } from '../data/drones';

export interface DroneModel {
  group: THREE.Group;
  props: THREE.Object3D[];      // rotating hubs
  blades: THREE.Mesh[][];       // per prop, fade out at speed
  discs: THREE.Mesh[];          // motion-blur discs, fade in at speed
  spin: number[];
  nozzles: THREE.Vector3[];
  liquid: THREE.Mesh | null;    // scaled by tank level
  tankH: number;
  setLevel(frac: number): void;
  setRpm(i: number, m: number, dt: number): void;
}

/** Motor positions in body FLU, identical to assembly/index.ts setup(). */
export function motorLayout(d: DroneDef): { x: number; y: number; s: number; top: boolean }[] {
  const out: { x: number; y: number; s: number; top: boolean }[] = [];
  const n = d.nMotors;
  for (let i = 0; i < n; i++) {
    let ang: number, s: number, top = true;
    if (d.coax) {
      const arms = n / 2, k = i % arms;
      ang = arms === 4 ? Math.PI / 4 + (Math.PI / 2) * k : Math.PI / arms + (2 * Math.PI * k) / arms;
      s = (i < arms ? 1 : -1) * (k % 2 === 0 ? 1 : -1);
      top = i < arms;
    } else {
      ang = Math.PI / n + (2 * Math.PI * i) / n;
      s = i % 2 === 0 ? 1 : -1;
    }
    out.push({ x: d.armLen * Math.cos(ang), y: d.armLen * Math.sin(ang), s, top });
  }
  return out;
}

// ---------- materials ----------
function carbonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1c1e'; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
    g.fillStyle = ((x + y) / 8) % 2 ? '#2a2c30' : '#141517';
    g.fillRect(x, y, 8, 8);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 8); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function blurDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grd.addColorStop(0, 'rgba(20,20,20,0.0)'); grd.addColorStop(0.15, 'rgba(20,20,20,0.35)');
  grd.addColorStop(0.85, 'rgba(25,25,25,0.22)'); grd.addColorStop(0.97, 'rgba(25,25,25,0.30)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let CARBON: THREE.CanvasTexture | null = null;
let BLUR: THREE.CanvasTexture | null = null;

const plastic = (color: number, rough = 0.35) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const metal = (color: number, rough = 0.35) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.85 });
const rubber = () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0 });

/** Tapered, slightly twisted propeller blade (length along +X from hub). */
function bladeGeometry(r: number, chord: number, thick: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const root = r * 0.12;
  s.moveTo(root, -chord * 0.35);
  s.bezierCurveTo(r * 0.35, -chord * 0.55, r * 0.75, -chord * 0.42, r, -chord * 0.12);
  s.quadraticCurveTo(r * 1.01, chord * 0.05, r * 0.97, chord * 0.14);
  s.bezierCurveTo(r * 0.7, chord * 0.3, r * 0.35, chord * 0.45, root, chord * 0.32);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2); // lie flat (XZ plane), thickness along +Y
  // twist: pitch angle decreasing from root (~18°) to tip (~6°)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const u = Math.min(Math.max(v.x / r, 0), 1);
    const a = (0.32 - 0.22 * u);
    const z = v.z, y = v.y;
    pos.setXYZ(i, v.x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a));
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildDrone(d: DroneDef): DroneModel {
  CARBON ??= carbonTexture();
  BLUR ??= blurDiscTexture();
  const g = new THREE.Group();
  const props: THREE.Object3D[] = [], blades: THREE.Mesh[][] = [], discs: THREE.Mesh[] = [], spin: number[] = [];
  const nozzles: THREE.Vector3[] = [];
  const L = d.armLen;
  const agri = d.look === 'agri-hexa' || d.look === 'agri-coax';
  const consumer = d.look === 'consumer-fold';
  const phantom = d.look === 'phantom';
  const bodyM = plastic(d.color, 0.3), accentM = plastic(d.accent, 0.35);
  const carbonM = new THREE.MeshStandardMaterial({ map: CARBON, color: 0xffffff, roughness: 0.32, metalness: 0.35 });
  const darkM = metal(0x222326, 0.45), alu = metal(0xb8bcc2, 0.3);
  let liquid: THREE.Mesh | null = null;
  let tankH = 0, tankY = 0;

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };

  if (agri) {
    // central body: rounded shell + canopy + accent stripe
    const bw = L * 0.62, bh = L * 0.2;
    add(new RoundedBoxGeometry(bw, bh, bw, 4, bh * 0.35), bodyM, 0, L * 0.05, 0);
    const canopy = add(new THREE.SphereGeometry(bw * 0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), bodyM, 0, L * 0.15, 0);
    canopy.scale.set(1.15, 0.45, 1);
    add(new RoundedBoxGeometry(bw * 1.01, bh * 0.18, bw * 1.01, 2, bh * 0.05), accentM, 0, L * 0.0, 0);
    // GPS mast + puck, antennas
    add(new THREE.CylinderGeometry(0.012, 0.012, L * 0.22, 8), carbonM, -bw * 0.25, L * 0.3, 0);
    add(new THREE.CylinderGeometry(0.05, 0.055, 0.025, 20), plastic(0x2b2b2b, 0.5), -bw * 0.25, L * 0.42, 0);
    for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 6), rubber(), -bw * 0.45, L * 0.22, sz * bw * 0.3);
    // spray tank (translucent HDPE) with liquid inside
    tankH = Math.cbrt(d.tankCap / 1000) * 1.25;
    const tw = tankH * 0.95;
    tankY = -tankH * 0.5 - L * 0.04;
    add(new RoundedBoxGeometry(tw, tankH, tw, 4, tw * 0.12), /* no `transmission`: it re-renders the whole scene every frame (6 → 160 ms on integrated GPUs) */ new THREE.MeshStandardMaterial({ color: 0xf4f6f6, roughness: 0.4, transparent: true, opacity: 0.45, depthWrite: false }), 0, tankY, 0);
    liquid = add(new THREE.BoxGeometry(tw * 0.9, 1, tw * 0.9), new THREE.MeshStandardMaterial({ color: 0x4f8fbf, roughness: 0.15, transparent: true, opacity: 0.75 }), 0, 0, 0);
    add(new THREE.CylinderGeometry(tw * 0.18, tw * 0.18, 0.05, 20), plastic(0x1e1e1e, 0.5), 0, tankY + tankH / 2 + 0.02, 0); // filler cap
    // radar under the nose
    add(new RoundedBoxGeometry(0.16, 0.06, 0.12, 2, 0.015), plastic(0x161616, 0.4), bw * 0.42, tankY - tankH * 0.25, 0);
    // landing gear: two T-legs with skids
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const leg = add(new THREE.CylinderGeometry(0.018, 0.022, d.gearH * 1.05, 10), carbonM, sx * d.gearW * 0.55, -d.gearH * 0.5 + L * 0.02, sz * d.gearW * 0.9);
        leg.rotation.x = sz * 0.22;
      }
      const skid = add(new THREE.CylinderGeometry(0.022, 0.022, d.gearW * 2.6, 12), carbonM, 0, -d.gearH + 0.025, sz * d.gearW * 1.1);
      skid.rotation.z = Math.PI / 2;
      for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.03, 10, 8), rubber(), sx * d.gearW * 1.3, -d.gearH + 0.025, sz * d.gearW * 1.1);
    }
  } else if (phantom) {
    const shell = add(new THREE.SphereGeometry(L * 0.55, 32, 20), plastic(0xf7f7f7, 0.2));
    shell.scale.set(1.15, 0.5, 1);
    add(new THREE.CylinderGeometry(L * 0.5, L * 0.55, L * 0.08, 32), plastic(0xd8d8d8, 0.3), 0, -L * 0.18, 0);
    for (const sz of [-1, 1]) {
      const leg = add(new THREE.CylinderGeometry(0.007, 0.008, d.gearH, 8), plastic(0xf2f2f2, 0.3), 0, -d.gearH / 2, sz * d.gearW);
      leg.rotation.x = sz * 0.15;
      const skid = add(new THREE.CylinderGeometry(0.008, 0.008, d.gearW * 2.2, 8), plastic(0xf2f2f2, 0.3), 0, -d.gearH, sz * d.gearW * 1.05);
      skid.rotation.z = Math.PI / 2;
    }
    add(new THREE.SphereGeometry(L * 0.12, 16, 12), metal(0x2a2a2a, 0.25), L * 0.15, -L * 0.36, 0); // gimbal camera
  } else if (consumer) {
    const b = add(new RoundedBoxGeometry(L * 1.5, L * 0.42, L * 0.55, 4, L * 0.12), plastic(d.color, 0.45));
    b.scale.set(1, 1, 1);
    add(new RoundedBoxGeometry(L * 0.3, L * 0.3, L * 0.32, 3, L * 0.06), metal(0x1d1d1f, 0.2), L * 0.85, -L * 0.05, 0); // gimbal
    add(new THREE.CylinderGeometry(L * 0.07, L * 0.07, L * 0.05, 16), new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.2, clearcoat: 1 }), L * 1.0, -L * 0.05, 0).rotation.z = Math.PI / 2;
  }

  // arms, motors, props
  const lay = motorLayout(d);
  const propR = d.propD / 2;
  const drawn = new Set<string>();
  const bladeGeo = bladeGeometry(propR, propR * (agri ? 0.2 : 0.17), Math.max(0.004, propR * 0.025));
  const bladeM = agri ? carbonM : plastic(consumer ? 0x9a9da1 : 0x8c8c8c, 0.4);
  for (const m of lay) {
    const key = `${m.x.toFixed(3)},${m.y.toFixed(3)}`;
    const front = m.x > 0.01;
    const armY = agri ? L * 0.08 : consumer ? (front ? L * 0.08 : -L * 0.05) : 0;
    const motorTop = agri ? (d.coax ? L * 0.22 : L * 0.17) : armY + L * 0.1;
    if (!drawn.has(key)) {
      drawn.add(key);
      const len = Math.hypot(m.x, m.y);
      const pivot = new THREE.Group();
      pivot.rotation.y = Math.atan2(m.y, m.x);
      pivot.position.y = armY;
      const armR = agri ? L * 0.032 : L * 0.05;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(armR, armR * 1.1, len, 14), agri ? carbonM : plastic(d.color, 0.45));
      arm.rotation.z = Math.PI / 2; arm.position.x = len / 2; pivot.add(arm);
      if (agri) {
        // folding joint near the body + motor mount clamp
        const joint = new THREE.Mesh(new THREE.CylinderGeometry(armR * 1.9, armR * 1.9, armR * 3, 14), alu);
        joint.position.x = len * 0.42; joint.rotation.z = Math.PI / 2; pivot.add(joint);
        if (front) { const stripe = new THREE.Mesh(new THREE.CylinderGeometry(armR * 1.05, armR * 1.05, len * 0.25, 14), accentM); stripe.rotation.z = Math.PI / 2; stripe.position.x = len * 0.75; pivot.add(stripe); }
      }
      g.add(pivot);
      // motor: stator base + bell + shaft
      const mr = agri ? Math.max(0.06, propR * 0.16) : L * 0.09;
      const mh = agri ? mr * 0.9 : L * 0.12;
      const motorM = metal(agri ? 0x2d2f33 : 0x3b3d40, 0.3);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(mr * 1.05, mr * 1.1, mh * 0.35, 24), darkM);
      base.position.set(m.x, armY + mh * 0.2, -m.y); g.add(base);
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(mr, mr, mh * 0.75, 24), motorM);
      bell.position.set(m.x, armY + mh * 0.75, -m.y); g.add(bell);
      if (d.coax) {
        const bell2 = bell.clone(); bell2.position.y = armY - mh * 0.55; g.add(bell2);
      }
      if (agri) {
        // pressure nozzle with hose under each motor
        const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, 0.08, 10), metal(0x9aa0a6, 0.3));
        noz.position.set(m.x * 0.98, armY - 0.18, -m.y * 0.98); g.add(noz);
        const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), rubber());
        hose.position.set(m.x * 0.98, armY - 0.09, -m.y * 0.98); g.add(hose);
        nozzles.push(new THREE.Vector3(m.x * 0.98, armY - 0.24, -m.y * 0.98));
        // nav LED under motor: red left / green right at the front, white at the rear
        const lc = front ? (m.y > 0 ? 0xff1a1a : 0x1aff4a) : 0xffffff;
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: lc, emissive: lc, emissiveIntensity: 3 }));
        led.position.set(m.x, armY - 0.02, -m.y); g.add(led);
      }
    }
    // propeller (hub + 2 blades + blur disc)
    const py = d.coax ? (m.top ? motorTop + 0.02 : armY - L * 0.18) : motorTop + 0.01;
    const prop = new THREE.Group();
    prop.position.set(m.x, py, -m.y);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(propR * 0.07, propR * 0.09, propR * 0.06, 16), alu); prop.add(hub);
    const bl: THREE.Mesh[] = [];
    for (let b = 0; b < 2; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeM.clone());
      (blade.material as THREE.Material).transparent = true;
      blade.rotation.y = b * Math.PI;
      if (m.s < 0) blade.scale.z = -1; // mirrored blade for CW props
      prop.add(blade); bl.push(blade);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(propR, 48), new THREE.MeshBasicMaterial({ map: BLUR, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005; prop.add(disc);
    g.add(prop);
    props.push(prop); blades.push(bl); discs.push(disc); spin.push(m.s);
  }

  g.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && !(me.material as THREE.Material).transparent) me.castShadow = true; });

  const model: DroneModel = {
    group: g, props, blades, discs, spin, nozzles, liquid, tankH,
    setLevel(frac: number) {
      if (!liquid) return;
      const h = Math.max(0.001, tankH * 0.94 * Math.min(Math.max(frac, 0), 1));
      liquid.scale.y = h; liquid.position.y = tankY - tankH * 0.47 + h / 2; liquid.visible = frac > 0.005;
    },
    setRpm(i: number, m: number, dt: number) {
      const p = props[i]; if (!p) return;
      // visual rotation is aliased on purpose (like a camera); blades fade into a blur disc
      p.rotation.y += spin[i] * Math.min(m * 60, 25) * dt;
      const blur = Math.min(Math.max((m - 0.12) / 0.25, 0), 1);
      for (const b of blades[i]) { const mat = b.material as THREE.Material; mat.opacity = 1 - blur * 0.85; b.visible = mat.opacity > 0.05; }
      (discs[i].material as THREE.MeshBasicMaterial).opacity = blur;
    },
  };
  return model;
}
