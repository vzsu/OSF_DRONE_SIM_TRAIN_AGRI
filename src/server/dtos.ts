// Bridge to the Drone Training OS (the learning platform that hosts students, exams and scores).
// The simulator server talks to it server-to-server with a shared key; the browser never sees the key.
//   DTOS_URL       default http://127.0.0.1:7870   (Drone Training OS on this PC)
//   DTOS_KEY_FILE  default ../OSF_DRONE_LEARNING_OS/data/sim-bridge.key (created by the Training OS)
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DTOS_URL = (process.env.DTOS_URL || 'http://127.0.0.1:7870').replace(/\/+$/, '');
const KEY_FILE = process.env.DTOS_KEY_FILE || path.resolve(process.cwd(), '..', 'OSF_DRONE_LEARNING_OS', 'data', 'sim-bridge.key');
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function key(): Promise<string> {
  try { return (await fs.readFile(KEY_FILE, 'utf8')).trim(); }
  catch { throw new Error(`Drone Training OS bridge key not found (${KEY_FILE}). Start the Training OS once, or set DTOS_KEY_FILE.`); }
}

/** Call the Training OS bridge; throws with its error message. */
export async function bridge(pathname: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-dtos-key', await key());
  let r: Response;
  try { r = await fetch(DTOS_URL + '/api/sim/bridge/' + pathname, { ...init, headers, cache: 'no-store' }); }
  catch { throw new Error(`Drone Training OS not reachable at ${DTOS_URL}`); }
  if (!r.ok) {
    let msg = `Training OS error ${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error || msg; } catch { /* not json */ }
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return r;
}
