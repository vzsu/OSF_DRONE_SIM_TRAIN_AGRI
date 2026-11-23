// Saved real-map training grounds: data/maps/<id>.json (ground definition + weather) and <id>.jpg
// (satellite picture). Shared by every PC on the LAN.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = path.join(process.cwd(), 'data', 'maps');
const ID_RE = /^m[0-9a-f]{12,24}$/;
export const validMapId = (id: string) => ID_RE.test(id);

export interface SavedMap {
  id: string; name: string; lat: number; lon: number; createdAt: string; by: string; byId: string;
  env: Record<string, unknown>; stats: Record<string, number>; world: Record<string, unknown>;
}

export async function saveMap(m: { name: string; lat: number; lon: number; env: Record<string, unknown>; stats: Record<string, number>; world: Record<string, unknown>; ground: string }, user: { id: string; name: string }): Promise<SavedMap> {
  if (!(m.lat > 17.7 && m.lat < 24.2 && m.lon > 80.2 && m.lon < 84.5)) throw new Error('Only Chhattisgarh is supported');
  const id = 'm' + crypto.randomBytes(8).toString('hex');
  const b64 = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(m.ground ?? '')?.[1];
  await fs.mkdir(DIR, { recursive: true });
  const world: Record<string, unknown> = { ...m.world, mapId: id };
  if (b64) {
    await fs.writeFile(path.join(DIR, `${id}.jpg`), Buffer.from(b64, 'base64'));
    world.ground = { ...(m.world.ground as object), url: `/api/maps/${id}/ground` };
  }
  const rec: SavedMap = { id, name: String(m.name || 'Field').slice(0, 60), lat: m.lat, lon: m.lon, createdAt: new Date().toISOString(), by: user.name, byId: user.id, env: m.env ?? {}, stats: m.stats ?? {}, world };
  await fs.writeFile(path.join(DIR, `${id}.json`), JSON.stringify(rec));
  return rec;
}
export async function getMap(id: string): Promise<SavedMap | null> {
  if (!validMapId(id)) return null;
  try { return JSON.parse(await fs.readFile(path.join(DIR, `${id}.json`), 'utf8')); } catch { return null; }
}
export async function mapGround(id: string): Promise<Buffer | null> {
  if (!validMapId(id)) return null;
  try { return await fs.readFile(path.join(DIR, `${id}.jpg`)); } catch { return null; }
}
export async function listMaps() {
  let names: string[] = [];
  try { names = await fs.readdir(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try { const { world: _w, ...m } = JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8')) as SavedMap; out.push(m); } catch { /* skip */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function deleteMap(id: string) {
  if (!validMapId(id)) return;
  await fs.rm(path.join(DIR, `${id}.json`), { force: true });
  await fs.rm(path.join(DIR, `${id}.jpg`), { force: true });
}
