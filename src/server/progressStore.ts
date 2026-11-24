// Per-student training record — the student's "profile DB", gzip-compressed:
//   data/students/<userId>/record.json.gz
// (older data/progress/<userId>.json files are read once and moved into the record)
//
//   quiz:     { [moduleId]: { best %, last %, attempts, at } }             theory drill quizzes
//   lessons:  { [lessonId]: { passed, time, checkride, at, score?, attempts? } }  simulator exercises
//   read:     { [conceptId]: true }                                        theory concepts read
//   checks:   { [checklistId]: ISO date of last completed run }
//   exam:     final theory exam { score, at, perModule, correct, total, attempts }
//   examOpen: the instructor has unlocked the final exam for this student
//   field:    { [F1…F9]: { score 0–100, at, by, note } }                  on-field grades (instructor)
//   safety:   { [P1…A6]: { ok, at, by } }                                  critical safety items (instructor)
//   history:  every attempt, newest last (quiz / lesson / exam / field), capped
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const ROOT = path.join(process.cwd(), 'data', 'students');
const LEGACY = path.join(process.cwd(), 'data', 'progress');
const ID_RE = /^u[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const HISTORY_MAX = 2000;

export interface HistoryItem { at: string; kind: 'quiz' | 'lesson' | 'exam' | 'field' | 'safety'; id: string; score?: number; passed?: boolean; by?: string }
export interface Progress {
  quiz: Record<string, { best: number; last: number; attempts: number; at: string }>;
  lessons: Record<string, { passed: boolean; time: number; checkride: boolean; at: string; score?: number; attempts?: number }>;
  read: Record<string, boolean>;
  checks: Record<string, string>;
  exam?: { score: number; at: string; perModule: Record<string, number>; correct: number; total: number; attempts: number };
  examOpen?: boolean;
  field?: Record<string, { score: number; at: string; by: string; note?: string }>;
  safety?: Record<string, { ok: boolean; at: string; by: string }>;
  history?: HistoryItem[];
}
export const emptyProgress = (): Progress => ({ quiz: {}, lessons: {}, read: {}, checks: {}, field: {}, safety: {}, history: [] });

const file = (id: string) => path.join(ROOT, id, 'record.json.gz');

export async function getProgress(userId: string): Promise<Progress> {
  if (!ID_RE.test(userId)) return emptyProgress();
  try { return { ...emptyProgress(), ...JSON.parse((await gunzip(await fs.readFile(file(userId)))).toString('utf8')) }; } catch { /* no record yet */ }
  try { return { ...emptyProgress(), ...JSON.parse(await fs.readFile(path.join(LEGACY, `${userId}.json`), 'utf8')) }; } catch { return emptyProgress(); }
}

async function save(userId: string, p: Progress) {
  if (p.history && p.history.length > HISTORY_MAX) p.history = p.history.slice(-HISTORY_MAX);
  await fs.mkdir(path.join(ROOT, userId), { recursive: true });
  const tmp = file(userId) + '.tmp';
  await fs.writeFile(tmp, await gzip(Buffer.from(JSON.stringify(p)), { level: 9 }));
  await fs.rename(tmp, file(userId));
  await fs.rm(path.join(LEGACY, `${userId}.json`), { force: true }); // migrated
}

const pct = (v: unknown) => Math.max(0, Math.min(100, Math.round(+(v as number) || 0)));

/** Student patch (own record). Only known sections, safe keys, bounded values; bests only go up. */
export async function patchProgress(userId: string, patch: Partial<Progress>): Promise<Progress> {
  if (!ID_RE.test(userId)) throw new Error('bad user');
  const p = await getProgress(userId);
  const now = new Date().toISOString();
  const hist = (h: Omit<HistoryItem, 'at'>) => (p.history ??= []).push({ at: now, ...h });
  for (const [k, v] of Object.entries(patch.quiz ?? {})) {
    if (!KEY_RE.test(k) || typeof v?.last !== 'number') continue;
    const last = pct(v.last), old = p.quiz[k];
    p.quiz[k] = { best: Math.max(old?.best ?? 0, last), last, attempts: (old?.attempts ?? 0) + 1, at: now };
    hist({ kind: 'quiz', id: k, score: last, passed: last >= 70 });
  }
  for (const [k, v] of Object.entries(patch.lessons ?? {})) {
    if (!KEY_RE.test(k) || typeof v?.passed !== 'boolean') continue;
    const old = p.lessons[k];
    const score = v.passed ? pct(v.score ?? 70) : 0;
    const attempts = (old?.attempts ?? 0) + 1;
    hist({ kind: 'lesson', id: k, score, passed: v.passed });
    const better = !old || (!old.passed && v.passed) || (v.passed && score > (old.score ?? 0));
    if (better) p.lessons[k] = { passed: v.passed, time: Math.max(0, Math.min(36000, +v.time || 0)), checkride: !!v.checkride, at: now, score, attempts };
    else p.lessons[k] = { ...old, attempts };
  }
  for (const k of Object.keys(patch.read ?? {})) if (KEY_RE.test(k)) p.read[k] = true;
  for (const k of Object.keys(patch.checks ?? {})) if (KEY_RE.test(k)) p.checks[k] = now;
  // final theory exam: only when the instructor has unlocked it; one sitting per unlock
  if (patch.exam && p.examOpen) {
    const e = patch.exam;
    const perModule: Record<string, number> = {};
    for (const [k, v] of Object.entries(e.perModule ?? {})) if (KEY_RE.test(k)) perModule[k] = pct(v);
    const total = Math.max(1, Math.min(200, Math.round(+e.total || 0))), correct = Math.max(0, Math.min(total, Math.round(+e.correct || 0)));
    const score = Math.round(correct / total * 100);
    p.exam = { score, at: now, perModule, correct, total, attempts: (p.exam?.attempts ?? 0) + 1 };
    p.examOpen = false;
    hist({ kind: 'exam', id: 'final', score, passed: score >= 70 });
  }
  await save(userId, p);
  return p;
}

/** Instructor patch on a student: field grades, safety items, exam unlock. */
export async function instructorPatch(userId: string, by: string, patch: { field?: Record<string, { score: number; note?: string } | null>; safety?: Record<string, boolean | null>; examOpen?: boolean }): Promise<Progress> {
  if (!ID_RE.test(userId)) throw new Error('bad user');
  const p = await getProgress(userId);
  const now = new Date().toISOString();
  p.field ??= {}; p.safety ??= {}; p.history ??= [];
  for (const [k, v] of Object.entries(patch.field ?? {})) {
    if (!/^F[0-9]{1,2}$/.test(k)) continue;
    if (v === null) { delete p.field[k]; continue; }
    const score = pct(v.score);
    p.field[k] = { score, at: now, by: by.slice(0, 60), note: typeof v.note === 'string' ? v.note.slice(0, 300) : undefined };
    p.history.push({ at: now, kind: 'field', id: k, score, passed: score >= 70, by });
  }
  for (const [k, v] of Object.entries(patch.safety ?? {})) {
    if (!/^[PIA][0-9]{1,2}$/.test(k)) continue;
    if (v === null) { delete p.safety[k]; continue; }
    p.safety[k] = { ok: !!v, at: now, by: by.slice(0, 60) };
    p.history.push({ at: now, kind: 'safety', id: k, passed: !!v, by });
  }
  if (typeof patch.examOpen === 'boolean') p.examOpen = patch.examOpen;
  await save(userId, p);
  return p;
}
