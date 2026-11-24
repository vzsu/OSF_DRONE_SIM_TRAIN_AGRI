import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('student progress store', () => {
  it('keeps best scores, never loses a pass, ignores unsafe keys', async () => {
    const cwd = process.cwd(); process.chdir(mkdtempSync(path.join(tmpdir(), 'osf-prog-')));
    try {
      const P = await import('../src/server/progressStore');
      const u = 'u0123456789ab';
      await P.patchProgress(u, { quiz: { 'm07': { best: 0, last: 80, attempts: 0, at: '' } } });
      let p = await P.patchProgress(u, { quiz: { 'm07': { best: 0, last: 40, attempts: 0, at: '' } } });
      expect(p.quiz.m07).toMatchObject({ best: 80, last: 40, attempts: 2 });
      await P.patchProgress(u, { lessons: { b5: { passed: true, time: 90, checkride: false, at: '' } } });
      p = await P.patchProgress(u, { lessons: { b5: { passed: false, time: 30, checkride: false, at: '' } } });
      expect(p.lessons.b5.passed).toBe(true);
      p = await P.patchProgress(u, { read: { '../../evil': true, 'c-ok': true } as Record<string, boolean>, quiz: { '__proto__': { best: 1, last: 1, attempts: 1, at: '' } } });
      expect(Object.keys(p.read)).toEqual(['c-ok']);
      expect(Object.keys(p.quiz)).toEqual(['m07']);
      await expect(P.patchProgress('../admin', {})).rejects.toThrow();
    } finally { process.chdir(cwd); }
  });
});
