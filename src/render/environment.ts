// Real-world 360° HDRI environments (CC0 scans from Poly Haven, the same library Blender users use).
// The HDRI provides: background (projected onto the ground with GroundedSkybox so the horizon and
// ground look right from a low camera), image-based lighting + reflections (PMREM), and the sun
// direction (brightest pixel) so the real-time shadow matches the photographed shadows.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GroundedSkybox } from 'three/examples/jsm/objects/GroundedSkybox.js';

export interface HdriInfo { id: string; name: string; note: string; captureHeight: number; credit: string }

export const HDRIS: HdriInfo[] = [
  { id: 'rural_asphalt_road', name: 'Rural road, midday', note: 'Open fields and trees, high sun, hard shadows', captureHeight: 1.7, credit: 'Poly Haven (CC0)' },
  { id: 'sunflowers', name: 'Farm fields, midday', note: 'Flat farmland with crops, partly cloudy', captureHeight: 1.7, credit: 'Poly Haven (CC0)' },
  { id: 'spruit_sunrise', name: 'Field at sunrise', note: 'Low sun — glare and long shadows for VLOS practice', captureHeight: 1.6, credit: 'Poly Haven (CC0)' },
];

const cache = new Map<string, Promise<THREE.DataTexture>>();

function load(url: string): Promise<THREE.DataTexture> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      new RGBELoader().setDataType(THREE.FloatType).load(url, (t) => res(t), undefined, rej);
    });
    cache.set(url, p);
  }
  return p;
}

/** Direction of the brightest region of an equirectangular HDR (three.js world axes). */
export function findSun(tex: THREE.DataTexture): THREE.Vector3 {
  const img = tex.image as unknown as { data: Float32Array; width: number; height: number };
  const { data, width: W, height: H } = img;
  let best = -1, br = 0, bc = 0;
  // only the upper half of the panorama can contain the sun
  for (let r = 0; r < H / 2; r += 2) {
    for (let c = 0; c < W; c += 2) {
      const i = (r * W + c) * 4;
      const l = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (l > best) { best = l; br = r; bc = c; }
    }
  }
  const el = (0.5 - (br + 0.5) / H) * Math.PI;
  const az = ((bc + 0.5) / W - 0.5) * 2 * Math.PI; // = atan2(z, x) in three's equirect mapping
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}

export interface LoadedEnv { skybox: GroundedSkybox; envMap: THREE.Texture; sunDir: THREE.Vector3; sunElevation: number; horizon: THREE.Color }

/** Average colour just above the horizon (for haze that matches the photo). */
function horizonColour(tex: THREE.DataTexture): THREE.Color {
  const img = tex.image as unknown as { data: Float32Array; width: number; height: number };
  const { data, width: W, height: H } = img;
  let r = 0, g = 0, b = 0, n = 0;
  for (let row = Math.floor(H * 0.46); row < Math.floor(H * 0.49); row++) for (let c = 0; c < W; c += 8) {
    const i = (row * W + c) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  const col = new THREE.Color(r / n, g / n, b / n);
  const m = Math.max(col.r, col.g, col.b, 1e-3);
  return col.multiplyScalar(Math.min(1, 0.85 / m)); // normalise HDR brightness to a usable fog colour
}

export async function loadHdri(renderer: THREE.WebGLRenderer, id: string, hd: boolean): Promise<LoadedEnv> {
  const info = HDRIS.find((h) => h.id === id) ?? HDRIS[0];
  const tex = await load(`/hdri/${info.id}_${hd ? '4k' : '2k'}.hdr`);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const sunDir = findSun(tex);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  // radius large enough that the field and power line sit well inside the projected ground
  const skybox = new GroundedSkybox(tex, info.captureHeight * 6, 900, 160);
  skybox.position.y = info.captureHeight * 6 - 0.02;
  (skybox.material as THREE.Material & { fog?: boolean }).fog = false; // the photo already contains the real haze
  return { skybox, envMap, sunDir, sunElevation: Math.asin(sunDir.y), horizon: horizonColour(tex) };
}
