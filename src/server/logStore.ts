// Server-side flight-log store: one JSON file per flight in ./data/logs.
// Shared by every PC on the LAN, so an instructor can review all trainees' flights.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data', 'logs');
const ID_RE = /^f\d{10,16}[a-z0-9]{0,8}$/;

export interface WireLog {
  header: { id: string; startedAt: string; trainee: string; [k: string]: unknown };
  summary: Record<string, unknown>;
  cols: string[]; rows: number; events: unknown[];
  dataB64: string;
}

export function validId(id: string) { return ID_RE.test(id); }
const file = (id: string) => path.join(DIR, `${id}.json`);

export async function putLog(log: WireLog) {
  if (!log?.header || !validId(log.header.id) || typeof log.dataB64 !== 'string' || !Array.isArray(log.cols)) throw new Error('invalid log');
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file(log.header.id), JSON.stringify(log));
}

export async function getLog(id: string): Promise<WireLog | null> {
  if (!validId(id)) return null;
  try { return JSON.parse(await fs.readFile(file(id), 'utf8')); } catch { return null; }
}

export async function deleteLog(id: string) {
  if (!validId(id)) return;
  await fs.rm(file(id), { force: true });
}

/** Headers + summaries only (no sample data) for the list view. */
export async function listLogs() {
  let names: string[] = [];
  try { names = await fs.readdir(DIR); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const l = JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8')) as WireLog;
      out.push({ header: l.header, summary: l.summary, rows: l.rows });
    } catch { /* skip corrupt file */ }
  }
  return out.sort((a, b) => String(b.header.startedAt).localeCompare(String(a.header.startedAt)));
}
