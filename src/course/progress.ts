// Client-side course progress. Logged-in students: loaded from / saved to the server.
// Guests: kept in memory for this visit only (nothing is saved).
import { currentUser, isGuest } from '../auth/client';
import type { Progress } from '../server/progressStore';

export let progress: Progress = { quiz: {}, lessons: {}, read: {}, checks: {} };

export async function loadProgress() {
  progress = { quiz: {}, lessons: {}, read: {}, checks: {} };
  if (!currentUser) return;
  try { const r = await fetch('/api/progress', { cache: 'no-store' }); if (r.ok) progress = await r.json(); } catch { /* offline */ }
}

/** Apply locally at once; persist for real accounts only. */
export async function saveProgress(patch: Partial<Progress>) {
  for (const [k, v] of Object.entries(patch.quiz ?? {})) { const o = progress.quiz[k]; progress.quiz[k] = { best: Math.max(o?.best ?? 0, v.last), last: v.last, attempts: (o?.attempts ?? 0) + 1, at: new Date().toISOString() }; }
  for (const [k, v] of Object.entries(patch.lessons ?? {})) { const o = progress.lessons[k]; if (!(o?.passed && (!v.passed || o.time <= v.time))) progress.lessons[k] = v; }
  Object.assign(progress.read, patch.read ?? {}); Object.assign(progress.checks, patch.checks ?? {});
  if (!currentUser || isGuest()) return;
  try {
    const r = await fetch('/api/progress', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.ok) progress = await r.json();
  } catch { /* offline: kept locally for this visit */ }
}
