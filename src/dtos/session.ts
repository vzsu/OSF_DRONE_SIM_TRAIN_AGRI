// Launch from the Drone Training OS: /dtos?t=<one-time token>.
// The token (kept for this tab only) says who flies which syllabus exercise with which simulator
// lesson — or which recorded attempt an instructor wants to replay. Results go back through this
// simulator's server (/api/dtos/result), which forwards them to the Training OS with its shared key.
import type { FlightLog } from '../logs/recorder';

export interface DtosLaunch {
  user: { id: number; name: string; username: string; role: 'admin' | 'student' };
  mode: 'fly' | 'replay';
  orgName: string; collegeName: string; lang?: 'en' | 'hi';
  /** set when this flight is part of a live simulator checkride (test) started by the instructor */
  checkride: { examId: number; title: string; endsAt: string } | null;
  exercise: { id: string; title: string; objective: string } | null;
  lessonId: string | null;
  attempt: { id: number; lessonId: string; lessonTitle: string; exerciseId: string; passed: boolean; score: number; at: string; student: { name: string; username: string } | null } | null;
}

const KEY = 'osf-dtos-token';
export let dtos: { token: string; launch: DtosLaunch } | null = null;

/** Take the token from the URL (once) and keep it for this tab; strip it from the address bar. */
export function captureToken(): string | null {
  const u = new URL(location.href);
  const t = u.searchParams.get('t');
  // a link copied by hand may carry stray characters (spaces, a trailing dot or letter): keep the token part
  const m = t ? /[A-Za-z0-9_-]{32}/.exec(t) : null;
  if (u.pathname === '/dtos' && m) {
    try { sessionStorage.setItem(KEY, m[0]); } catch { /* private mode */ }
    return m[0];
  }
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}

export async function resolveLaunch(): Promise<DtosLaunch | null> {
  const t = captureToken();
  if (!t) return null;
  const r = await fetch(`/api/dtos/launch?t=${encodeURIComponent(t)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({ error: 'bad response' }));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Launch failed'), { status: r.status });
  dtos = { token: t, launch: j as DtosLaunch };
  if (dtos.launch.lang === 'hi') (await import('./hi')).startHindi();
  // only now hide the token from the address bar (a failed first load can simply be retried)
  if (location.search) window.history.replaceState(null, '', '/dtos');
  return dtos.launch;
}

function b64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface SentResult { ok: boolean; attemptId?: number; exerciseScore?: number | null; flightBytes?: number; error?: string }

/** Send one finished exercise (result + recorded flight) to the Training OS. */
export async function sendResult(r: { lessonId: string; passed: boolean; score: number; time: number; checkride: boolean; reason: string; objectives: { text: string; done: boolean }[]; drone: string }, log: FlightLog | null): Promise<SentResult> {
  if (!dtos || dtos.launch.mode !== 'fly') return { ok: false, error: 'not launched from the Training OS' };
  const wire = log ? { header: log.header, summary: log.summary, cols: log.cols, rows: log.rows, events: log.events, dataB64: b64(log.data) } : undefined;
  try {
    const res = await fetch('/api/dtos/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: dtos.token, ...r, log: wire }) });
    const j = await res.json();
    return res.ok ? { ok: true, ...j } : { ok: false, error: j.error };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function loadReplayFlight(): Promise<FlightLog> {
  if (!dtos) throw new Error('no replay link');
  const r = await fetch(`/api/dtos/flight?t=${encodeURIComponent(dtos.token)}`, { cache: 'no-store' });
  const w = await r.json();
  if (!r.ok) throw new Error(w.error || 'Flight not available');
  const bin = atob(w.dataB64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { header: w.header, summary: w.summary, cols: w.cols, rows: w.rows, events: w.events, data: u8.buffer };
}
