// URL routing for the single-page app: every screen has a real, shareable URL (History API) and a
// breadcrumb trail. Paths are matched against a fixed whitelist — anything else goes home, so a
// crafted URL can never reach an unknown screen. Parameters are validated by strict patterns, and
// access rules (login / admin) are checked by the caller before a screen renders (the server
// enforces the same rules on every API call).
import { COURSE } from '../course/content';

export interface Route { screen: string; arg?: string; path: string }
export interface Crumb { label: string; path?: string }

const MOD_RE = /^[0-9]{2}-[a-z0-9-]{3,60}$/;
const LOG_RE = /^f\d{10,16}[a-z0-9]{0,8}$/;
const LESSON_RE = /^[a-z0-9]{1,12}$/;

const STATIC: Record<string, string> = {
  '/': 'home', '/login': 'login', '/fly': 'fly', '/drones': 'drone', '/environment': 'env', '/settings': 'settings',
  '/mission': 'mission', '/maps': 'realmap', '/logs': 'logs', '/lessons': 'lessons', '/admin': 'admin',
  '/course': 'course', '/course/checklists': 'checklists', '/course/practical': 'practical', '/dtos': 'dtos',
};
const BY_SCREEN: Record<string, string> = Object.fromEntries(Object.entries(STATIC).map(([p, s]) => [s, p]));
BY_SCREEN.freefly = '/fly';

export function parse(pathname: string): Route {
  const p = (pathname.replace(/\/+$/, '') || '/').slice(0, 200);
  if (STATIC[p]) return { screen: STATIC[p], path: p };
  let m = /^\/course\/([^/]+)(\/quiz)?$/.exec(p);
  if (m && MOD_RE.test(m[1]) && COURSE.modules.some((x) => x.id === m![1])) return { screen: m[2] ? 'quiz' : 'module', arg: m[1], path: p };
  m = /^\/logs\/([^/]+)$/.exec(p);
  if (m && LOG_RE.test(m[1])) return { screen: 'debrief', arg: m[1], path: p };
  m = /^\/lessons\/([^/]+)$/.exec(p);
  if (m && LESSON_RE.test(m[1])) return { screen: 'lesson', arg: m[1], path: p };
  return { screen: 'home', path: '/' };
}

export function pathFor(screen: string, arg?: string): string | null {
  if (screen === 'module' && arg) return `/course/${arg}`;
  if (screen === 'quiz' && arg) return `/course/${arg}/quiz`;
  if (screen === 'debrief' && arg) return `/logs/${arg}`;
  if (screen === 'lesson' && arg) return `/lessons/${arg}`;
  return BY_SCREEN[screen] ?? null;
}

const TITLE: Record<string, string> = {
  login: 'Sign in', fly: 'Flight', drone: 'Drones', env: 'Environment', settings: 'Settings', mission: 'Mission planner',
  realmap: 'Real map', logs: 'Flight logs', lessons: 'Lessons', admin: 'Admin', course: 'Course', checklists: 'Checklists', practical: 'Practical training', dtos: 'Drone Training OS',
};

export function crumbsFor(r: Route): Crumb[] {
  const home: Crumb = { label: 'Home', path: '/' };
  const mod = (id?: string) => COURSE.modules.find((x) => x.id === id);
  switch (r.screen) {
    case 'home': return [{ label: 'Home' }];
    case 'module': return [home, { label: 'Course', path: '/course' }, { label: mod(r.arg)?.short ?? 'Module' }];
    case 'quiz': return [home, { label: 'Course', path: '/course' }, { label: mod(r.arg)?.short ?? 'Module', path: `/course/${r.arg}` }, { label: 'Quiz' }];
    case 'checklists': case 'practical': return [home, { label: 'Course', path: '/course' }, { label: TITLE[r.screen] }];
    case 'debrief': return [home, { label: 'Flight logs', path: '/logs' }, { label: 'Debrief' }];
    case 'lesson': return [home, { label: 'Lessons', path: '/lessons' }, { label: 'Lesson' }];
    default: return [home, { label: TITLE[r.screen] ?? r.screen }];
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** shadcn/ui Breadcrumb structure: nav > ol > li (link | separator | page). */
export function breadcrumbHtml(crumbs: Crumb[]): string {
  if (crumbs.length <= 1) return '';
  const sep = '<li role="presentation" aria-hidden="true" class="bc-sep"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></li>';
  return `<nav aria-label="breadcrumb" class="bc"><ol class="bc-list">${crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    const item = last || !c.path
      ? `<li class="bc-item"><span role="link" aria-disabled="true" aria-current="page" class="bc-page">${esc(c.label)}</span></li>`
      : `<li class="bc-item"><a class="bc-link" href="${c.path}" data-route>${esc(c.label)}</a></li>`;
    return item + (last ? '' : sep);
  }).join('')}</ol></nav>`;
}
