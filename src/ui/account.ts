// Login screen (students + instructors) and the admin panel (manage students, see progress).
import { mount, header, wireNav } from './screens';
import { login, listUsers, createUser, updateUser, deleteUser, currentUser, enterGuest, type User } from '../auth/client';
import type { Progress } from '../server/progressStore';
import { COURSE } from '../course/content';
import { loadProgress } from '../course/progress';
import { listLogs } from '../logs/db';

type Nav = (screen: string, arg?: unknown) => void;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function loginScreen(nav: Nav) {
  const root = mount(`
    <div class="home-hero"><h1>OSF Agri Flight Trainer</h1><p class="muted">Sign in to fly. Your flights, scores and debriefs are saved to your account on the training server.</p></div>
    <div class="card" style="max-width:380px">
      <form id="lf">
        <div class="field"><label>Username</label><input id="lu" autocomplete="username" autofocus></div>
        <div class="field"><label>Password</label><input id="lp" type="password" autocomplete="current-password"></div>
        <p class="bad small" id="le"></p>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <div class="or"><span>or</span></div>
      <button id="guest" class="guest-btn">Continue in guest mode</button>
      <p class="small muted" style="margin-top:6px">Guest mode: every screen, the course and the simulator work — but <b>nothing is saved</b> (no flight logs, scores or progress).</p>
      <p class="small muted" style="margin-top:12px">Students: ask your instructor for an account. Instructors sign in as <b>admin</b>.</p>
    </div>`);
  // guest: sign out any old session first and start with empty progress — nothing from an account leaks in
  root.querySelector<HTMLButtonElement>('#guest')!.onclick = async () => { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); enterGuest(); await loadProgress(); nav('home'); };
  const f = root.querySelector<HTMLFormElement>('#lf')!;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = root.querySelector('#le')!;
    err.textContent = '';
    try {
      await login(root.querySelector<HTMLInputElement>('#lu')!.value, root.querySelector<HTMLInputElement>('#lp')!.value);
      await loadProgress();
      nav('home');
    } catch (x) { err.textContent = x instanceof Error ? x.message : String(x); }
  });
}

export async function adminScreen(nav: Nav) {
  const root = mount(`${header('Admin panel — students & instructors')}
    <div class="grid" style="grid-template-columns:minmax(280px,360px) 1fr;align-items:start">
      <div class="card"><h3>Add user</h3>
        <form id="af">
          <div class="field"><label>Full name</label><input id="an" required></div>
          <div class="field"><label>Username (login)</label><input id="au" required placeholder="e.g. ravi.k"></div>
          <div class="field"><label>Password (min 6)</label><input id="ap" required></div>
          <div class="field"><label>Role</label><select id="ar"><option value="student">Student / trainee</option><option value="admin">Instructor / admin</option></select></div>
          <p class="small" id="am"></p>
          <button class="primary" type="submit">Create</button>
        </form>
        <h3 style="margin-top:16px">My password</h3>
        <div class="row"><input id="mp" type="password" placeholder="new password" style="flex:1"><button id="mps">Change</button></div><p class="small" id="mpm"></p>
      </div>
      <div class="card"><h3>Users and progress</h3><div id="ul">Loading…</div></div>
    </div>`);
  wireNav(root, nav);
  const msg = (id: string, t: string, bad = false) => { const el = root.querySelector<HTMLElement>('#' + id)!; el.textContent = t; el.className = 'small ' + (bad ? 'bad' : 'ok'); };
  root.querySelector<HTMLFormElement>('#af')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => root.querySelector<HTMLInputElement>('#' + id)!.value;
    try {
      const u = await createUser({ name: v('an'), username: v('au'), password: v('ap'), role: v('ar') as User['role'] });
      msg('am', `Created ${u.username}. Give them the username and password.`);
      (e.target as HTMLFormElement).reset();
      void renderList();
    } catch (x) { msg('am', x instanceof Error ? x.message : String(x), true); }
  });
  root.querySelector('#mps')!.addEventListener('click', async () => {
    try { await updateUser(currentUser!.id, { password: root.querySelector<HTMLInputElement>('#mp')!.value }); msg('mpm', 'Password changed'); }
    catch (x) { msg('mpm', x instanceof Error ? x.message : String(x), true); }
  });

  async function renderList() {
    const el = root.querySelector<HTMLElement>('#ul')!;
    let users: User[] = [];
    try { users = await listUsers(); } catch (x) { el.textContent = String(x); return; }
    const logs = await listLogs();
    const prog = new Map<string, Progress>();
    await Promise.all(users.map(async (u) => { try { const r = await fetch(`/api/progress?user=${encodeURIComponent(u.id)}`, { cache: 'no-store' }); if (r.ok) prog.set(u.id, await r.json()); } catch { /* skip */ } }));
    const theory = (u: User) => { const p = prog.get(u.id); if (!p) return '—'; const qs = COURSE.modules.map((m) => p.quiz[m.id]?.best).filter((v): v is number => v !== undefined); return qs.length ? `${qs.filter((v) => v >= 70).length}/${COURSE.modules.length} passed · avg ${Math.round(qs.reduce((a, b) => a + b, 0) / qs.length)}%` : 'not started'; };
    const exercises = (u: User) => { const p = prog.get(u.id); if (!p) return '—'; return `${Object.values(p.lessons).filter((l) => l.passed).length} passed`; };
    const stat = (u: User) => {
      const mine = logs.filter((l) => (l.header as { userId?: string }).userId === u.id);
      const scores = mine.map((l) => l.summary.score).filter((s): s is number => typeof s === 'number');
      const crashes = mine.filter((l) => l.summary.result === 'Crash').length;
      const mins = mine.reduce((s, l) => s + l.summary.flightTime, 0) / 60;
      const last = mine[0]?.header.startedAt;
      return { n: mine.length, avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, best: scores.length ? Math.max(...scores) : null, crashes, mins, last };
    };
    el.innerHTML = `<table><tr><th>Name</th><th>Username</th><th>Role</th><th>Flights</th><th>Flight time</th><th>Avg / best score</th><th>Theory quizzes</th><th>Sim exercises</th><th>Crashes</th><th>Last flight</th><th></th></tr>
      ${users.map((u) => { const s = stat(u); return `<tr data-u="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td><span class="tag">${u.role}</span></td>
        <td>${s.n}</td><td>${s.mins.toFixed(0)} min</td><td>${s.avg ?? '—'} / ${s.best ?? '—'}</td><td class="small">${theory(u)}</td><td class="small">${exercises(u)}</td><td class="${s.crashes ? 'bad' : ''}">${s.crashes}</td>
        <td class="small">${s.last ? new Date(s.last).toLocaleString() : '—'}</td>
        <td><button class="small" data-pw>Reset password</button> ${u.id === currentUser?.id ? '' : '<button class="small danger" data-del>Delete</button>'}</td></tr>`; }).join('')}</table>
      <p class="small muted">Open <b>Flight logs</b> to review any trainee's flight, debrief and score. Flights recorded before logins existed belong to no user (visible to admins only).</p>`;
    el.querySelectorAll<HTMLElement>('tr[data-u]').forEach((row) => {
      const id = row.dataset.u!;
      row.querySelector<HTMLButtonElement>('[data-pw]')!.onclick = async (ev) => {
        const b = ev.target as HTMLButtonElement;
        const pw = Math.random().toString(36).slice(2, 10);
        try { await updateUser(id, { password: pw }); b.textContent = `New: ${pw}`; b.disabled = true; } catch (x) { b.textContent = String(x); }
      };
      const del = row.querySelector<HTMLButtonElement>('[data-del]');
      if (del) del.onclick = async () => {
        // two-step delete, no browser dialog
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000); return; }
        try { await deleteUser(id); void renderList(); } catch (x) { del.textContent = String(x); }
      };
    });
  }
  void renderList();
}
