// Flight-log store = part of the per-student database.
//   data/students/<userId>/flights/<flightId>.osfz      (compressed, see flightCodec.ts)
//   data/students/_unassigned/flights/<flightId>.osfz   (flights without an account)
// Older logs in data/logs/<id>.json (plain JSON) are still read, listed and replayed.
// Shared by every PC on the LAN, so an instructor can review and replay all trainees' flights.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { encodeFlight, decodeFlight, readFlightMeta } from './flightCodec';

const ROOT = path.join(process.cwd(), 'data', 'students');
const LEGACY = path.join(process.cwd(), 'data', 'logs');
const ID_RE = /^f\d{10,16}[a-z0-9]{0,8}$/;
const USER_RE = /^u[0-9a-f]{12}$/;

export interface WireLog {
  header: { id: string; startedAt: string; trainee: string; userId?: string; [k: string]: unknown };
  summary: Record<string, unknown>;
  cols: string[]; rows: number; events: unknown[];
  dataB64: string;
}
export interface LogListItem { header: WireLog['header']; summary: WireLog['summary']; rows: number; bytes?: number }

export function validId(id: string) { return ID_RE.test(id); }
const owner = (userId?: unknown) => (typeof userId === 'string' && USER_RE.test(userId) ? userId : '_unassigned');
const flightDir = (userId?: unknown) => path.join(ROOT, owner(userId), 'flights');

/** id → file path (rebuilt from disk when an id is missing) */
let index: Map<string, string> | null = null;
async function scan(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  let owners: string[] = [];
  try { owners = await fs.readdir(ROOT); } catch { /* none yet */ }
  for (const o of owners) {
    let names: string[] = [];
    try { names = await fs.readdir(path.join(ROOT, o, 'flights')); } catch { continue; }
    for (const n of names) if (n.endsWith('.osfz')) m.set(n.slice(0, -5), path.join(ROOT, o, 'flights', n));
  }
  try { for (const n of await fs.readdir(LEGACY)) if (n.endsWith('.json') && !m.has(n.slice(0, -5))) m.set(n.slice(0, -5), path.join(LEGACY, n)); } catch { /* none */ }
  index = m;
  return m;
}
async function locate(id: string) {
  if (!validId(id)) return null;
  return (index ?? await scan()).get(id) ?? (await scan()).get(id) ?? null;
}

export async function putLog(log: WireLog) {
  if (!log?.header || !validId(log.header.id) || typeof log.dataB64 !== 'string' || !Array.isArray(log.cols)) throw new Error('invalid log');
  const dir = flightDir(log.header.userId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${log.header.id}.osfz`);
  const buf = encodeFlight(log);
  await fs.writeFile(file, buf);
  (index ?? await scan()).set(log.header.id, file);
  return { bytes: buf.length };
}

export async function getLog(id: string): Promise<WireLog | null> {
  const f = await locate(id);
  if (!f) return null;
  try {
    const buf = await fs.readFile(f);
    return f.endsWith('.osfz') ? decodeFlight(buf) : JSON.parse(buf.toString('utf8'));
  } catch { return null; }
}

export async function deleteLog(id: string) {
  const f = await locate(id);
  if (!f) return;
  await fs.rm(f, { force: true });
  index?.delete(id);
}

/** Headers + summaries only (no sample data) for lists and dashboards. */
export async function listLogs(userId?: string): Promise<LogListItem[]> {
  const m = await scan();
  const out: LogListItem[] = [];
  for (const [, f] of m) {
    if (userId && !f.includes(path.join(ROOT, userId) + path.sep)) {
      if (f.endsWith('.osfz')) continue;           // other student's compressed flight
    }
    try {
      const buf = await fs.readFile(f);
      if (f.endsWith('.osfz')) { const meta = readFlightMeta(buf); out.push({ header: meta.header, summary: meta.summary, rows: meta.rows, bytes: buf.length }); }
      else { const l = JSON.parse(buf.toString('utf8')) as WireLog; out.push({ header: l.header, summary: l.summary, rows: l.rows, bytes: buf.length }); }
    } catch { /* skip corrupt file */ }
  }
  const mine = userId ? out.filter((l) => l.header.userId === userId) : out;
  return mine.sort((a, b) => String(b.header.startedAt).localeCompare(String(a.header.startedAt)));
}
