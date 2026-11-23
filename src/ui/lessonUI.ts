// Lessons: menu screen, live objective card during flight, animated result dialog.
import gsap from 'gsap';
import { mount, header, wireNav } from './screens';
import { settings, saveSettings } from '../settings';
import { LESSONS, type LessonRunner, type LessonResult, type LessonDef } from '../lessons/lessons';
import { droneById } from '../data/drones';
import { pulse, celebrate, popIn, popOut } from './motion';

type Nav = (screen: string, arg?: unknown) => void;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Pick a drone + ground that suit the lesson, then fly it. */
export function startLesson(def: LessonDef, nav: Nav) {
  settings.lesson = def.id;
  const d = droneById(settings.droneId);
  if (def.kind === 'agri' && d.tankCap === 0) settings.droneId = 'marut_ag365h';
  if (def.kind === 'camera' && d.fc !== 'dji') settings.droneId = 'dji_mavic3pro';
  if (def.kind === 'camera') settings.place = { id: 'wed-11', category: 'wedding', seed: 11 };
  else if (settings.place.category === 'wedding') settings.place = { id: 'agri-classic', category: 'agri', seed: 0 };
  saveSettings();
  nav('fly');
}

export function lessonsScreen(nav: Nav) {
  const best = settings.lessonBest ?? {};
  const root = mount(`${header('Lessons & checkride')}
    <p class="muted" style="max-width:720px">Structured training from first hover to emergencies. Each lesson checks your flying live and passes or fails it. <b>Checkride</b> switches all aids off (trail, ground marker, hold assist) and injects one random failure — the exam an instructor signs off.</p>
    <div class="row" style="margin:12px 0 18px"><label class="toggle"><input type="checkbox" id="cr" ${settings.checkride ? 'checked' : ''}> <span>Checkride mode</span></label>
      ${settings.lesson ? '<button class="small" id="free">Free flight (no lesson)</button>' : ''}</div>
    <div class="grid lessons">${LESSONS.map((l) => {
      const b = best[l.id];
      return `<div class="card click lesson ${b?.passed ? 'passed' : ''}" data-l="${l.id}">
        <div class="row spread"><span class="lnum">${l.n}</span><span class="tag">${l.level}</span></div>
        <h3 style="margin-top:8px;text-transform:none;font-size:17px;letter-spacing:0">${esc(l.title)}</h3>
        <p class="small">${esc(l.brief)}</p>
        <div class="row spread small"><span>${l.kind === 'agri' ? 'Agri drone' : l.kind === 'camera' ? 'Camera drone · wedding venue' : 'Any drone'}</span>
          <span>${b ? (b.passed ? `✓ passed ${fmt(b.time)}${b.checkride ? ' · checkride' : ''}` : 'not passed yet') : 'new'}</span></div></div>`;
    }).join('')}</div>`);
  wireNav(root, nav);
  root.querySelector<HTMLInputElement>('#cr')!.onchange = (e) => { settings.checkride = (e.target as HTMLInputElement).checked; saveSettings(); };
  const fr = root.querySelector<HTMLButtonElement>('#free'); if (fr) fr.onclick = () => { settings.lesson = null; saveSettings(); lessonsScreen(nav); };
  root.querySelectorAll<HTMLElement>('[data-l]').forEach((c) => (c.onclick = () => startLesson(LESSONS.find((l) => l.id === c.dataset.l)!, nav)));
}

/** Live objective card in the flight HUD. */
export class LessonCard {
  el = document.createElement('div');
  private shown = '';
  constructor(parent: HTMLElement) { this.el.className = 'lesson-card'; this.el.style.display = 'none'; parent.appendChild(this.el); }
  update(r: LessonRunner) {
    if (!r.def) { this.el.style.display = 'none'; this.shown = ''; return; }
    if (this.shown !== r.def.id) {
      this.shown = r.def.id; this.el.style.display = 'block';
      this.el.innerHTML = `<div class="lc-head"><b>Lesson ${r.def.n} · ${esc(r.def.title)}</b>${r.checkride ? '<span class="lc-cr">CHECKRIDE</span>' : ''}<span class="lc-t" id="lc-t"></span></div>
        ${r.objectives.map((_, i) => `<div class="lc-obj" data-i="${i}"><i class="lc-chk"></i><span class="lc-txt"></span><span class="lc-bar"><b></b></span></div>`).join('')}`;
      gsap.fromTo(this.el, { y: -14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'expo.out' });
    }
    (this.el.querySelector('#lc-t') as HTMLElement).textContent = `${fmt(r.elapsed)} / ${fmt(r.def.timeLimit)}`;
    r.objectives.forEach((o, i) => {
      const row = this.el.querySelector<HTMLElement>(`.lc-obj[data-i="${i}"]`); if (!row) return;
      row.classList.toggle('done', o.done);
      row.querySelector('.lc-txt')!.textContent = o.text;
      (row.querySelector('.lc-bar b') as HTMLElement).style.width = `${(o.progress * 100).toFixed(0)}%`;
    });
  }
  objectiveDone(i: number) { const row = this.el.querySelector<HTMLElement>(`.lc-obj[data-i="${i}"]`); if (row) pulse(row, true); }
}

/** Animated result dialog. */
export function showLessonResult(r: LessonResult, actions: { retry: () => void; debrief: () => void; next: (() => void) | null; menu: () => void }) {
  const d = document.createElement('div'); d.className = 'pause'; d.style.zIndex = '75';
  d.innerHTML = `<div class="card lesson-result ${r.passed ? 'ok' : 'bad'}">
    <div class="lr-badge">${r.passed ? '✓' : '✗'}</div>
    <h2>${r.passed ? 'Lesson passed' : 'Lesson failed'}</h2>
    <p><b>${esc(r.title)}</b> · ${fmt(r.time)}${r.checkride ? ' · checkride' : ''}${r.failure ? ` · injected failure: ${r.failure === 'gps' ? 'GPS loss' : r.failure === 'motor' ? 'motor failure' : 'RC link loss'}` : ''}</p>
    ${r.reason ? `<p class="bad">${esc(r.reason)}</p>` : ''}
    <div class="lr-objs">${r.objectives.map((o) => `<div class="${o.done ? 'ok' : ''}">${o.done ? '✓' : '○'} ${esc(o.text)}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="primary" data-a="${r.passed && actions.next ? 'next' : 'retry'}">${r.passed && actions.next ? 'Next lesson' : 'Try again'}</button>
      ${r.passed && actions.next ? '<button data-a="retry">Fly again</button>' : ''}<button data-a="debrief">Debrief &amp; score</button><button data-a="menu">Lessons</button></div></div>`;
  document.body.appendChild(d);
  popIn(d);
  const card = d.querySelector<HTMLElement>('.card')!;
  if (r.passed) celebrate(card);
  d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => (b.onclick = () => {
    popOut(d);
    const a = b.dataset.a as 'retry' | 'debrief' | 'next' | 'menu';
    if (a === 'next' && actions.next) actions.next(); else actions[a === 'next' ? 'retry' : a]();
  }));
}
