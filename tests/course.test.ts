import { describe, it, expect } from 'vitest';
import { COURSE } from '../src/course/content';
import { parse, pathFor, crumbsFor, breadcrumbHtml } from '../src/ui/router';

describe('course content', () => {
  it('loads all 5 theory modules with gradable questions and the training plan', () => {
    expect(COURSE.modules.length).toBe(5);
    const qs = COURSE.modules.reduce((n, m) => n + m.questions.length, 0);
    expect(qs).toBe(106); // 87 MCQ + 19 true/false
    for (const m of COURSE.modules) for (const q of m.questions) expect(q.correctIndex).toBeLessThan(q.options.length);
    expect(COURSE.checklists.map((c) => c.id)).toEqual(['pre', 'in', 'post']);
    expect(COURSE.blocks[0].exercises.length).toBe(10);
  });
});

describe('router (whitelisted, validated URLs)', () => {
  it('maps paths both ways and rejects unknown or crafted ones', () => {
    const m = COURSE.modules[0].id;
    expect(parse(`/course/${m}/quiz`)).toMatchObject({ screen: 'quiz', arg: m });
    expect(pathFor('quiz', m)).toBe(`/course/${m}/quiz`);
    expect(parse('/logs/f1795356462054mzdel')).toMatchObject({ screen: 'debrief' });
    expect(parse('/admin')).toMatchObject({ screen: 'admin' });
    for (const bad of ['/course/../../etc/passwd', '/course/<script>', '/logs/../users', '/javascript:alert(1)', '/course/99-nope', '/%2e%2e/']) expect(parse(bad).screen).toBe('home');
  });
  it('builds shadcn-style breadcrumbs with the current page marked', () => {
    const m = COURSE.modules[1];
    const html = breadcrumbHtml(crumbsFor(parse(`/course/${m.id}/quiz`)));
    expect(html).toContain('aria-label="breadcrumb"');
    expect(html).toContain('href="/course"');
    expect(html).toContain('aria-current="page"');
    expect((html.match(/class="bc-sep"/g) ?? []).length).toBe(3);
  });
});
