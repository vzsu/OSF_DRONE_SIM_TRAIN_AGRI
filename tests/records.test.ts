import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// run the stores inside a temp working directory so real data/ is never touched
const tmp = path.join(os.tmpdir(), `osf-rec-${Date.now()}`);
const cwd = process.cwd();
let store: typeof import('../src/server/logStore');
let prog: typeof import('../src/server/progressStore');
let codec: typeof import('../src/server/flightCodec');
let report: typeof import('../src/course/report');

beforeAll(async () => {
  await fs.mkdir(tmp, { recursive: true }); process.chdir(tmp);
  store = await import('../src/server/logStore'); prog = await import('../src/server/progressStore');
  codec = await import('../src/server/flightCodec'); report = await import('../src/course/report');
});
afterAll(async () => { process.chdir(cwd); await fs.rm(tmp, { recursive: true, force: true }); });

function fakeLog(userId: string, seconds = 120) {
  const cols = ['t', 'rc_roll', 'x', 'y', 'z', 'roll', 'pitch', 'yaw', 'batt_v', 'mode', 'armed'];
  const n = seconds * 50, d = new Float32Array(n * cols.length);
  for (let i = 0; i < n; i++) {
    const t = i / 50;
    d.set([t, Math.sin(t), 20 * Math.cos(t / 9), 20 * Math.sin(t / 9), 5 + Math.sin(t / 3), 0.1 * Math.sin(t), 0.05 * Math.cos(t), ((t / 9 + Math.PI) % (2 * Math.PI)) - Math.PI, 50 - t * 0.01, 2, 1], i * cols.length);
  }
  return { header: { id: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`, startedAt: new Date().toISOString(), trainee: 'Test', userId }, summary: { score: 80 }, cols, rows: n, events: [{ t: 1, code: 1, text: 'ARMED' }], dataB64: Buffer.from(d.buffer).toString('base64') };
}

describe('per-student flight database', () => {
  it('compresses a flight ≥ 8× and replays it within display precision', () => {
    const log = fakeLog('u0123456789ab');
    const buf = codec.encodeFlight(log);
    const raw = JSON.stringify(log).length;
    expect(raw / buf.length).toBeGreaterThan(8);
    const back = codec.decodeFlight(buf);
    const a = new Float32Array(Buffer.from(log.dataB64, 'base64').buffer.slice(0)), b = new Float32Array(Buffer.from(back.dataB64, 'base64').buffer.slice(0));
    expect(b.length).toBe(a.length);
    let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThan(0.006);                       // ≤ 5 mm / 0.1 mrad / 1 ms
    expect(back.header.id).toBe(log.header.id);
    expect(back.events).toEqual(log.events);
  });
  it('stores flights in the student folder; students list only their own', async () => {
    const a = fakeLog('u0123456789ab', 10), b = fakeLog('ubbbbbbbbbbbb', 10);
    await store.putLog(a); await store.putLog(b);
    await fs.access(path.join(tmp, 'data', 'students', 'u0123456789ab', 'flights', `${a.header.id}.osfz`));
    expect((await store.listLogs('u0123456789ab')).map((l) => l.header.id)).toEqual([a.header.id]);
    expect((await store.listLogs()).length).toBe(2);
    expect((await store.getLog(b.header.id))?.rows).toBe(500);
  });
});

describe('student record + report', () => {
  const U = 'u00000000000c';
  it('keeps history, bests, instructor grades and a one-sitting final exam (gzip on disk)', async () => {
    await prog.patchProgress(U, { quiz: { '07-air-law-weight-registration': { best: 0, last: 60, attempts: 1, at: '' } } });
    await prog.patchProgress(U, { quiz: { '07-air-law-weight-registration': { best: 0, last: 90, attempts: 1, at: '' } } });
    await prog.patchProgress(U, { lessons: { b1: { passed: true, time: 60, checkride: false, at: '', score: 88 } } });
    await prog.patchProgress(U, { lessons: { b1: { passed: false, time: 30, checkride: false, at: '' } } });
    // exam is refused until the instructor unlocks it
    let p = await prog.patchProgress(U, { exam: { score: 0, at: '', perModule: {}, correct: 40, total: 40, attempts: 0 } });
    expect(p.exam).toBeUndefined();
    await prog.instructorPatch(U, 'Instructor', { examOpen: true, field: { F1: { score: 80 } }, safety: { P5: true, P8: false } });
    p = await prog.patchProgress(U, { exam: { score: 0, at: '', perModule: { '07-air-law-weight-registration': 75 }, correct: 30, total: 40, attempts: 0 } });
    expect(p.exam?.score).toBe(75); expect(p.examOpen).toBe(false);
    expect(p.quiz['07-air-law-weight-registration']).toMatchObject({ best: 90, last: 90, attempts: 2 });
    expect(p.lessons.b1).toMatchObject({ passed: true, score: 88, attempts: 2 });
    expect(p.history!.map((h) => h.kind)).toEqual(['quiz', 'quiz', 'lesson', 'lesson', 'field', 'safety', 'safety', 'exam']);
    const gz = await fs.readFile(path.join(tmp, 'data', 'students', U, 'record.json.gz'));
    expect(gz[0]).toBe(0x1f); expect(gz[1]).toBe(0x8b);
    const r = report.buildReport(p);
    expect(r.theory.score).toBe(75); expect(r.safety.failed).toEqual(['P8']);
    expect(r.recommended).toBe(false);
    expect(r.reasons.some((x) => /P8/.test(x))).toBe(true);
  });
  it('recommends only when every bar is met', () => {
    const p = prog.emptyProgress();
    p.exam = { score: 90, at: '', perModule: {}, correct: 36, total: 40, attempts: 1 };
    for (const id of report.SIM_EXERCISES) p.lessons[id] = { passed: true, time: 60, checkride: false, at: '', score: 85 };
    for (const x of report.FIELD_EXERCISES) p.field![x.id] = { score: 80, at: '', by: 'I' };
    for (const c of report.CRITICAL_ITEMS) p.safety![c.id] = { ok: true, at: '', by: 'I' };
    const r = report.buildReport(p);
    expect(r.overall).toBe(Math.round(0.5 * 90 + 0.25 * 85 + 0.25 * 80));
    expect(r.grade).toBe('A'); expect(r.recommended).toBe(true); expect(r.stage).toBe('complete');
  });
});
