// Training report for one student — the same rules as the Drone Training OS spec (§5):
//   Theory    = final exam % (until it is taken: average of the module drill bests, marked provisional)
//   Simulator = average of the best scores of the 10 beginner exercises (missing = 0)
//   Field     = average of the instructor's F1–F9 grades (missing = 0)
//   Overall   = 0.50 × Theory + 0.25 × Simulator + 0.25 × Field
//   Grade     A+ ≥ 90 · A ≥ 80 · B ≥ 70 · C ≥ 60 · F below
//   RPTO recommendation: overall ≥ 75, theory ≥ 70, sim ≥ 70, field ≥ 70 and no failed critical safety item.
// Pure functions: used by the student dashboard, the instructor dashboard and the printable report.
import type { Progress } from '../server/progressStore';
import { COURSE } from './content';

export const WEIGHTS = { theory: 0.5, sim: 0.25, field: 0.25 };
export const PASS = { overall: 75, theory: 70, sim: 70, field: 70 };
export const SIM_EXERCISES = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10'];
export const FIELD_EXERCISES = COURSE.blocks.find((b) => b.id === 'field')?.exercises ?? [];
export const CRITICAL_ITEMS = COURSE.checklists.flatMap((c) => c.items.filter((i) => i.critical));

/** Score for one passed simulator exercise: full marks for using little of the time limit, never below 60. */
export function lessonScore(passed: boolean, time: number, timeLimit: number, checkride: boolean): number {
  if (!passed) return 0;
  const s = 100 - 35 * Math.min(1, time / Math.max(timeLimit, 1));
  return Math.round(Math.max(60, Math.min(100, s + (checkride ? 5 : 0))));
}

export function gradeOf(v: number) { return v >= 90 ? 'A+' : v >= 80 ? 'A' : v >= 70 ? 'B' : v >= 60 ? 'C' : 'F'; }

export type Stage = 'enrolled' | 'theory' | 'simulator' | 'field' | 'exam' | 'complete';

export interface Report {
  theory: { score: number; provisional: boolean; perModule: { id: string; title: string; drill: number | null; exam: number | null }[]; readPct: number };
  sim: { score: number; done: number; total: number; items: { id: string; score: number; passed: boolean; attempts: number }[] };
  field: { score: number; graded: number; total: number; items: { id: string; title: string; score: number | null }[] };
  safety: { checked: number; total: number; failed: string[] };
  overall: number; grade: string; recommended: boolean; reasons: string[]; stage: Stage;
  attempts: { quizzes: number; lessons: number; exam: number };
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

export function buildReport(p: Progress): Report {
  const mods = COURSE.modules;
  const drill = mods.map((m) => p.quiz[m.id]?.best ?? null);
  const exam = p.exam;
  const theoryScore = exam ? exam.score : Math.round(avg(drill.filter((v): v is number => v !== null)));
  const concepts = mods.flatMap((m) => m.concepts);
  const readPct = concepts.length ? Math.round(concepts.filter((c) => p.read[c.id]).length / concepts.length * 100) : 0;

  const simItems = SIM_EXERCISES.map((id) => { const l = p.lessons[id]; return { id, score: l?.passed ? l.score ?? 70 : 0, passed: !!l?.passed, attempts: l?.attempts ?? (l ? 1 : 0) }; });
  const simScore = Math.round(avg(simItems.map((i) => i.score)));

  const fieldItems = FIELD_EXERCISES.map((x) => ({ id: x.id, title: x.title, score: p.field?.[x.id]?.score ?? null }));
  const fieldScore = Math.round(avg(fieldItems.map((i) => i.score ?? 0)));

  const failed = CRITICAL_ITEMS.filter((i) => p.safety?.[i.id]?.ok === false).map((i) => i.id);
  const checked = CRITICAL_ITEMS.filter((i) => p.safety?.[i.id]).length;

  const overall = Math.round(WEIGHTS.theory * theoryScore + WEIGHTS.sim * simScore + WEIGHTS.field * fieldScore);
  const reasons: string[] = [];
  if (!exam) reasons.push('Final theory exam not taken');
  if (overall < PASS.overall) reasons.push(`Overall below ${PASS.overall}`);
  if (theoryScore < PASS.theory) reasons.push(`Theory below ${PASS.theory}`);
  if (simScore < PASS.sim) reasons.push(`Simulator below ${PASS.sim}`);
  if (fieldScore < PASS.field) reasons.push(`Field below ${PASS.field}`);
  if (failed.length) reasons.push(`Failed critical safety item: ${failed.join(', ')}`);
  if (checked < CRITICAL_ITEMS.length) reasons.push(`Safety items not all assessed (${checked}/${CRITICAL_ITEMS.length})`);

  const simDone = simItems.filter((i) => i.passed).length, graded = fieldItems.filter((i) => i.score !== null).length;
  const quizzesTaken = mods.some((m) => p.quiz[m.id]);
  const stage: Stage = exam && graded === fieldItems.length ? 'complete'
    : graded > 0 ? (exam ? 'exam' : 'field')
    : simDone > 0 ? 'simulator'
    : quizzesTaken || readPct > 0 ? 'theory' : 'enrolled';

  return {
    theory: { score: theoryScore, provisional: !exam, readPct, perModule: mods.map((m, i) => ({ id: m.id, title: m.short, drill: drill[i], exam: exam?.perModule[m.id] ?? null })) },
    sim: { score: simScore, done: simDone, total: simItems.length, items: simItems },
    field: { score: fieldScore, graded, total: fieldItems.length, items: fieldItems },
    safety: { checked, total: CRITICAL_ITEMS.length, failed },
    overall, grade: gradeOf(overall), recommended: reasons.length === 0, reasons, stage,
    attempts: {
      quizzes: Object.values(p.quiz).reduce((s, q) => s + q.attempts, 0),
      lessons: Object.values(p.lessons).reduce((s, l) => s + (l.attempts ?? 1), 0),
      exam: exam?.attempts ?? 0,
    },
  };
}
