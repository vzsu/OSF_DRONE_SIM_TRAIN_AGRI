// Course: DGCA RPC theory (concepts + quizzes), flight checklists and the practical training plan,
// linked to the simulator exercises. Scores are saved per student (guests: not saved).
import katex from 'katex';
import gsap from 'gsap';
import { mount, header, wireNav } from './screens';
import { COURSE, SIM_LINKS, type Module, type Question } from '../course/content';
import { progress, saveProgress } from '../course/progress';
import { isGuest } from '../auth/client';
import { countUp, celebrate, pulse } from './motion';
import { lessonById } from '../lessons/lessons';

type Nav = (screen: string, arg?: unknown) => void;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const tex = (f: string) => { try { return katex.renderToString(f, { throwOnError: false, displayMode: true, output: 'html' }); } catch { return `<code>${esc(f)}</code>`; } };
const PASS = 70;
const guestNote = () => (isGuest() ? '<p class="guest-note">Guest mode — your answers and scores are <b>not saved</b>. Sign in to keep your progress.</p>' : '');

export function courseScreen(nav: Nav) {
  const mods = COURSE.modules;
  const root = mount(`${header('Course — DGCA Remote Pilot')}
    <p class="muted" style="max-width:760px">Theory first, then the simulator. Read each module, test yourself with the quiz (pass mark ${PASS}%), go through the flight checklists, then fly the matching simulator exercises.</p>
    ${guestNote()}
    <h2>Theory modules</h2>
    <div class="grid">${mods.map((m) => {
      const q = progress.quiz[m.id], read = m.concepts.filter((c) => progress.read[c.id]).length;
      return `<a class="card click course-mod ${q && q.best >= PASS ? 'passed' : ''}" href="/course/${m.id}" data-route>
        <div class="row spread"><span class="lnum">${m.n}</span><span class="tag">${esc(m.subject)}</span></div>
        <h3 style="text-transform:none;font-size:17px;letter-spacing:0;margin-top:8px">${esc(m.topic)}</h3>
        <div class="small">${m.concepts.length} concepts · ${m.questions.length} quiz questions</div>
        <div class="cbar"><i style="width:${Math.round(read / m.concepts.length * 100)}%"></i></div>
        <div class="row spread small"><span>${read}/${m.concepts.length} read</span><span>${q ? `quiz best <b>${q.best}%</b>` : 'quiz not taken'}</span></div></a>`;
    }).join('')}</div>
    <h2 style="margin-top:22px">Practical</h2>
    <div class="grid">
      <a class="card click" href="/course/checklists" data-route><h3 style="text-transform:none;font-size:17px">Flight checklists</h3><p class="small">${COURSE.checklists.map((c) => `${esc(c.title)} (${c.items.length})`).join(' · ')}</p></a>
      <a class="card click" href="/course/practical" data-route><h3 style="text-transform:none;font-size:17px">Training plan</h3><p class="small">${COURSE.blocks.map((b) => `${esc(b.title)}: ${b.exercises.length} exercises`).join(' · ')} — with the matching simulator exercises.</p></a>
      <a class="card click" href="/lessons" data-route><h3 style="text-transform:none;font-size:17px">Simulator exercises</h3><p class="small">Beginner course 1–10 with demos, then advanced lessons and checkrides.</p></a>
    </div>`);
  wireNav(root, nav);
}

export function moduleScreen(nav: Nav, id: string) {
  const m = COURSE.modules.find((x) => x.id === id)!;
  const q = progress.quiz[m.id];
  const root = mount(`${header(`${m.n}. ${m.topic}`)}
    ${guestNote()}
    <div class="row" style="margin-bottom:14px"><a class="btn primary" href="/course/${m.id}/quiz" data-route>Take the quiz (${Math.min(10, m.questions.length)} questions)</a>
      <span class="small">${q ? `Best ${q.best}% · last ${q.last}% · ${q.attempts} attempt${q.attempts === 1 ? '' : 's'}` : 'Quiz not taken yet'}</span></div>
    <div class="concepts">${m.concepts.map((c, i) => `<details class="card concept" ${i === 0 ? 'open' : ''} data-c="${esc(c.id)}">
      <summary><span class="ck ${progress.read[c.id] ? 'on' : ''}"></span><b>${esc(c.name)}</b></summary>
      ${c.formula ? `<div class="formula">${tex(c.formula)}</div>` : ''}
      <p>${esc(c.explanation)}</p>
      ${c.application ? `<p class="small"><b>In practice:</b> ${esc(c.application)}</p>` : ''}
      <button class="small" data-read="${esc(c.id)}">${progress.read[c.id] ? '✓ Read' : 'Mark as read'}</button></details>`).join('')}</div>
    ${m.shorts.length ? `<h2 style="margin-top:20px">Self-check</h2><div class="grid">${m.shorts.map((s) => `<div class="card selfcheck"><p><b>${esc(s.question)}</b></p><details><summary class="small">Show answer</summary><p>${esc(s.answer)}</p>${s.explanation ? `<p class="small muted">${esc(s.explanation)}</p>` : ''}</details></div>`).join('')}</div>` : ''}`);
  wireNav(root, nav);
  root.querySelectorAll<HTMLButtonElement>('[data-read]').forEach((b) => (b.onclick = () => {
    void saveProgress({ read: { [b.dataset.read!]: true } });
    b.textContent = '✓ Read'; b.closest('details')?.querySelector('.ck')?.classList.add('on'); pulse(b);
  }));
}

export function quizScreen(nav: Nav, id: string) {
  const m = COURSE.modules.find((x) => x.id === id)!;
  const pool = [...m.questions].sort(() => Math.random() - 0.5).slice(0, 10);
  let i = 0, score = 0;
  const answers: { q: Question; pick: number }[] = [];
  const root = mount(`${header(`Quiz — ${m.short}`)}${guestNote()}<div id="qz"></div>`);
  wireNav(root, nav);
  const box = root.querySelector<HTMLElement>('#qz')!;
  const show = () => {
    const q = pool[i];
    box.innerHTML = `<div class="card quiz">
      <div class="row spread small"><span>Question ${i + 1} of ${pool.length}</span><span>Score ${score}</span></div>
      <div class="cbar"><i style="width:${(i / pool.length) * 100}%"></i></div>
      <h3 class="qtext">${esc(q.question)}</h3>
      <div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}"><span class="key">${String.fromCharCode(65 + k)}</span>${esc(o)}</button>`).join('')}</div>
      <div class="qfb"></div></div>`;
    gsap.fromTo(box.firstElementChild, { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.4, ease: 'expo.out' });
    box.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => (b.onclick = () => {
      const k = +b.dataset.k!, ok = k === q.correctIndex;
      if (ok) score++;
      answers.push({ q, pick: k });
      box.querySelectorAll<HTMLButtonElement>('.opt').forEach((x) => { x.disabled = true; const kk = +x.dataset.k!; if (kk === q.correctIndex) x.classList.add('right'); else if (kk === k) x.classList.add('wrong'); });
      pulse(b, !ok);
      box.querySelector('.qfb')!.innerHTML = `<p class="${ok ? 'ok' : 'bad'}"><b>${ok ? 'Correct' : 'Not quite'}.</b> ${esc(q.explanation ?? '')}</p>
        <button class="primary" id="qn">${i + 1 < pool.length ? 'Next question' : 'See result'}</button>`;
      box.querySelector<HTMLButtonElement>('#qn')!.onclick = () => { i++; if (i < pool.length) show(); else result(); };
    }));
  };
  const result = () => {
    const pct = Math.round(score / pool.length * 100), pass = pct >= PASS;
    void saveProgress({ quiz: { [m.id]: { best: pct, last: pct, attempts: 1, at: '' } } });
    box.innerHTML = `<div class="card quiz-result ${pass ? 'ok' : 'bad'}">
      <div class="score-big"><span id="qpct">0</span>%</div>
      <h2>${pass ? 'Passed' : `Not yet — pass mark is ${PASS}%`}</h2>
      <p>${score} of ${pool.length} correct${isGuest() ? ' · guest mode, not saved' : ' · saved to your progress'}</p>
      <div class="row" style="justify-content:center"><button class="primary" id="qr">Try again</button><a class="btn" href="/course/${m.id}" data-route>Back to the module</a><a class="btn" href="/course" data-route>Course</a></div>
      <details style="margin-top:14px;text-align:left"><summary>Review answers</summary>${answers.map(({ q, pick }) => `<p class="${pick === q.correctIndex ? 'ok' : 'bad'}">${pick === q.correctIndex ? '✓' : '✗'} ${esc(q.question)}<br><span class="small">Answer: ${esc(q.options[q.correctIndex])}</span></p>`).join('')}</details></div>`;
    countUp(box.querySelector<HTMLElement>('#qpct')!, pct);
    if (pass) celebrate(box.firstElementChild as HTMLElement);
    box.querySelector<HTMLButtonElement>('#qr')!.onclick = () => quizScreen(nav, id);
  };
  show();
}

export function checklistsScreen(nav: Nav) {
  const root = mount(`${header('Flight checklists')}
    <p class="muted">Tick every item, in order, before you fly — exactly like on the field. <b class="bad">Red</b> items are critical: do not fly if any is not satisfied.</p>${guestNote()}
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${COURSE.checklists.map((c) => `<div class="card checklist" data-cl="${esc(c.id)}">
      <div class="row spread"><h3 style="text-transform:none;font-size:17px">${esc(c.title)}</h3><span class="tag">${c.items.length} items</span></div>
      ${c.subtitle ? `<p class="small muted">${esc(c.subtitle)}</p>` : ''}
      ${c.items.map((it) => `<label class="clitem ${it.critical ? 'crit' : ''}"><input type="checkbox"> <span><b>${esc(it.id)}</b> ${esc(it.text)}</span></label>`).join('')}
      <div class="row spread small" style="margin-top:8px"><span class="clcount">0 / ${c.items.length}</span><span>${progress.checks[c.id] ? `last completed ${new Date(progress.checks[c.id]).toLocaleDateString()}` : ''}</span></div></div>`).join('')}</div>`);
  wireNav(root, nav);
  root.querySelectorAll<HTMLElement>('[data-cl]').forEach((card) => {
    const boxes = Array.from(card.querySelectorAll<HTMLInputElement>('input'));
    boxes.forEach((b) => (b.onchange = () => {
      const n = boxes.filter((x) => x.checked).length;
      card.querySelector('.clcount')!.textContent = `${n} / ${boxes.length}`;
      if (n === boxes.length) { void saveProgress({ checks: { [card.dataset.cl!]: '' } }); celebrate(card); }
    }));
  });
}

export function practicalScreen(nav: Nav) {
  const root = mount(`${header('Practical training plan')}
    <p class="muted">The syllabus exercises with their steps and marking criteria. Simulator exercises can be flown here; on-field exercises are marked by the instructor.</p>
    ${COURSE.blocks.map((b) => `<h2 style="margin-top:18px">${esc(b.title)}${b.totalMinutes ? ` <span class="small muted">· ${Math.round(b.totalMinutes / 60)} h</span>` : ''}</h2>
      ${b.briefing ? `<p class="small">${esc(b.briefing)}</p>` : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${b.exercises.map((x) => {
        const sims = (SIM_LINKS[x.id] ?? []).map((id) => lessonById(id)).filter(Boolean);
        return `<div class="card"><div class="row spread"><b>${esc(x.id)} · ${esc(x.title)}</b><span class="tag">${x.minutes} min</span></div>
          <p class="small">${esc(x.objective)}</p>
          <ol class="small">${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          ${x.caution ? `<p class="small bad">⚠ ${esc(x.caution)}</p>` : ''}
          ${sims.length ? `<div class="row">${sims.map((l) => `<a class="btn small primary" href="/lessons/${l!.id}" data-route>Fly: ${esc(l!.title)}</a>`).join('')}</div>` : ''}</div>`;
      }).join('')}</div>`).join('')}`);
  wireNav(root, nav);
}

export function moduleById(id: string): Module | undefined { return COURSE.modules.find((m) => m.id === id); }
