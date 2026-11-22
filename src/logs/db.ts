// Flight-log storage. Primary: the Node server (/api/logs, shared across the LAN).
// Fallback: this browser's IndexedDB when the server is unreachable. Logs saved offline are
// uploaded automatically the next time the list is opened.
import type { FlightLog } from './recorder';

const DB = 'osf-sim-logs', STORE = 'logs';

// ---------- wire format ----------
function toB64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): ArrayBuffer {
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b.buffer;
}
function toWire(l: FlightLog) {
  return { header: l.header, summary: l.summary, cols: l.cols, rows: l.rows, events: l.events, training: l.training, dataB64: toB64(l.data) };
}

// ---------- IndexedDB fallback ----------
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'header.id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function upload(log: FlightLog): Promise<boolean> {
  try {
    const r = await fetch('/api/logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toWire(log)) });
    return r.ok;
  } catch { return false; }
}

/** Save a finished flight. Returns where it was stored. */
export async function saveLog(log: FlightLog): Promise<'server' | 'browser'> {
  if (await upload(log)) return 'server';
  try { await idb('readwrite', (s) => s.put(log)); } catch { /* storage blocked */ }
  return 'browser';
}

export interface LogEntry { header: FlightLog['header']; summary: FlightLog['summary']; where: 'server' | 'browser' }

export async function listLogs(): Promise<LogEntry[]> {
  // push any offline-saved logs to the server first
  let local: FlightLog[] = [];
  try { local = await idb<FlightLog[]>('readonly', (s) => s.getAll()); } catch { /* none */ }
  let server: LogEntry[] = [];
  let online = false;
  try {
    const r = await fetch('/api/logs', { cache: 'no-store' });
    if (r.ok) { online = true; server = ((await r.json()) as LogEntry[]).map((l) => ({ ...l, where: 'server' as const })); }
  } catch { /* offline */ }
  if (online) {
    for (const l of local) {
      if (!server.some((s) => s.header.id === l.header.id) && (await upload(l))) {
        server.push({ header: l.header, summary: l.summary, where: 'server' });
        try { await idb('readwrite', (s) => s.delete(l.header.id)); } catch { /* ignore */ }
      }
    }
    local = local.filter((l) => !server.some((s) => s.header.id === l.header.id));
  }
  const all = [...server, ...local.map((l) => ({ header: l.header, summary: l.summary, where: 'browser' as const }))];
  return all.sort((a, b) => b.header.startedAt.localeCompare(a.header.startedAt));
}

export async function loadLog(e: LogEntry): Promise<FlightLog | null> {
  if (e.where === 'browser') {
    try { return (await idb<FlightLog>('readonly', (s) => s.get(e.header.id))) ?? null; } catch { return null; }
  }
  try {
    const r = await fetch(`/api/logs/${encodeURIComponent(e.header.id)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const w = await r.json();
    return { header: w.header, summary: w.summary, cols: w.cols, rows: w.rows, events: w.events, training: w.training, data: fromB64(w.dataB64) };
  } catch { return null; }
}

export async function deleteLog(e: LogEntry) {
  if (e.where === 'browser') { try { await idb('readwrite', (s) => s.delete(e.header.id)); } catch { /* ignore */ } return; }
  await fetch(`/api/logs/${encodeURIComponent(e.header.id)}`, { method: 'DELETE' }).catch(() => {});
}
