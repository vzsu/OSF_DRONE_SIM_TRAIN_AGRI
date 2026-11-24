// DGCA RPC course content (from OSF_DRONE_LEARNING_OS): theory modules with concepts + question
// banks, and the practical training plan + flight checklists.
import m07 from '../../content/course/theory/07-air-law-weight-registration.json';
import m08 from '../../content/course/theory/08-air-law-airspace-zones.json';
import m09 from '../../content/course/theory/09-met-meteorology-flight-theory.json';
import m10 from '../../content/course/theory/10-rpas-systems-human-factors.json';
import m11 from '../../content/course/theory/11-flight-planning-emergencies-navigation.json';
import training from '../../content/course/training.json';

export interface Concept { id: string; name: string; formula?: string; explanation: string; application?: string }
export interface Question { type: string; question: string; options: string[]; correctIndex: number; explanation?: string; conceptId?: string }
export interface ShortQ { question: string; answer: string; explanation?: string; conceptId?: string }
interface RawQ { type: string; question: string; options?: string[]; correctIndex?: number; correctAnswer?: boolean | string; explanation?: string; conceptId?: string }
export interface Module { id: string; n: number; subject: string; topic: string; short: string; concepts: Concept[]; questions: Question[]; shorts: ShortQ[] }
export interface ChecklistItem { id: string; text: string; critical: boolean }
export interface Checklist { id: string; title: string; subtitle?: string; items: ChecklistItem[] }
export interface Exercise { id: string; title: string; minutes: number; objective: string; steps: string[]; caution?: string; criteria?: { id: string; label: string; points: number }[] }
export interface Block { id: string; title: string; totalMinutes?: number; briefing?: string; exercises: Exercise[] }

const raw: [string, { subject: string; topic: string; concepts: Concept[]; questions: RawQ[] }][] = [
  ['07-air-law-weight-registration', m07], ['08-air-law-airspace-zones', m08], ['09-met-meteorology-flight-theory', m09],
  ['10-rpas-systems-human-factors', m10], ['11-flight-planning-emergencies-navigation', m11],
];

export const COURSE = {
  modules: raw.map(([id, m], i): Module => ({
    id, n: i + 1, subject: m.subject, topic: m.topic,
    short: m.topic.split(/[—–:]/)[0].trim().slice(0, 40), concepts: m.concepts,
    // auto-graded: multiple choice + true/false (as two options)
    questions: m.questions.flatMap((q): Question[] =>
      q.type === 'mcq' && q.options && typeof q.correctIndex === 'number' ? [{ type: 'mcq', question: q.question, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation, conceptId: q.conceptId }]
      : q.type === 'truefalse' ? [{ type: 'truefalse', question: q.question, options: ['True', 'False'], correctIndex: q.correctAnswer ? 0 : 1, explanation: q.explanation, conceptId: q.conceptId }] : []),
    // short answers: self-check cards
    shorts: m.questions.filter((q) => q.type === 'short').map((q) => ({ question: q.question, answer: String(q.correctAnswer ?? ''), explanation: q.explanation, conceptId: q.conceptId })),
  })),
  checklists: (training as { checklists: Checklist[] }).checklists,
  blocks: (training as { blocks: Block[] }).blocks,
};

/** Which simulator exercises practise each syllabus item (S1…S10 of the training plan). */
export const SIM_LINKS: Record<string, string[]> = {
  S1: ['b1'], S2: ['b1'], S3: ['b2', 'hover'], S4: ['b4', 'b5', 'box'], S5: ['b6', 'b7'], S6: ['b8'], S7: ['b9'], S8: ['b9'],
  S9: ['b10', 'precision'], S10: ['motor', 'atti'],
};
