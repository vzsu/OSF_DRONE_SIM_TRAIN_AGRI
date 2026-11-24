// Per-student course progress: data/progress/<userId>.json
//   quiz:    { [moduleId]: { best: %, last: %, attempts, at } }
//   lessons: { [lessonId]: { passed, time, checkride, at } }   (sim exercises / lessons)
//   read:    { [conceptId]: true }                              (theory concepts read)
//   checks:  { [checklistId]: ISO date of last completed run }
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'data', 'progress');
const ID_RE = /^u[0-9a-f]{12}$/;
export interface Progress {
  quiz: Record<string, { best: number; last: number; attempts: number; at: string }>;
  lessons: Record<string, { passed: boolean; time: number; checkride: boolean; at: string }>;
  read: Record<string, boolean>;
  checks: Record<string, string>;
}
const empty = (): Progress => ({ quiz: {}, lessons: {}, read: {}, checks: {} });

export async function getProgress(userId: string): Promise<Progress> {
  if (!ID_RE.test(userId)) return empty();
  try { return { ...empty(), ...JSON.parse(await fs.readFile(path.join(DIR, `${userId}.json`), 'utf8')) }; } catch { return empty(); }
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/** Merge a client patch. Only known sections, safe keys, bounded values; quiz "best" can only go up. */
export async function patchProgress(userId: string, patch: Partial<Progress>): Promise<Progress> {
  if (!ID_RE.test(userId)) throw new Error('bad user');
  const p = await getProgress(userId);
  for (const [k, v] of Object.entries(patch.quiz ?? {})) {
    if (!KEY_RE.test(k) || typeof v?.last !== 'number') continue;
    const last = Math.max(0, Math.min(100, Math.round(v.last)));
    const old = p.quiz[k];
    p.quiz[k] = { best: Math.max(old?.best ?? 0, last), last, attempts: (old?.attempts ?? 0) + 1, at: new Date().toISOString() };
  }
  for (const [k, v] of Object.entries(patch.lessons ?? {})) {
    if (!KEY_RE.test(k) || typeof v?.passed !== 'boolean') continue;
    const old = p.lessons[k];
    if (old?.passed && !v.passed) continue; // a failed retry never erases a pass
    if (old?.passed && v.passed && old.time <= v.time) continue; // keep the best time
    p.lessons[k] = { passed: v.passed, time: Math.max(0, Math.min(36000, +v.time || 0)), checkride: !!v.checkride, at: new Date().toISOString() };
  }
  for (const k of Object.keys(patch.read ?? {})) if (KEY_RE.test(k)) p.read[k] = true;
  for (const k of Object.keys(patch.checks ?? {})) if (KEY_RE.test(k)) p.checks[k] = new Date().toISOString();
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${userId}.json`), JSON.stringify(p));
  return p;
}
