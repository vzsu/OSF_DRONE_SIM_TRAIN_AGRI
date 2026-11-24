// Browser side of login / users. The session is an HttpOnly cookie set by the server.
export type Role = 'admin' | 'student';
export interface User { id: string; username: string; name: string; role: Role; createdAt: string }

export let currentUser: User | null = null;
/** true when the training server could not be reached at all (local / offline use without login) */
export let offline = false;
/** guest mode: everything works, nothing is saved (no account, no logs, no progress) */
// kept for this browser tab only (sessionStorage), so a reload or deep link stays in guest mode
let guest = typeof sessionStorage !== 'undefined' && (() => { try { return sessionStorage.getItem('osf-guest') === '1'; } catch { return false; } })();
const setGuest = (on: boolean) => { guest = on; try { if (on) sessionStorage.setItem('osf-guest', '1'); else sessionStorage.removeItem('osf-guest'); } catch { /* blocked */ } };
export const isGuest = () => guest;
export function enterGuest() { setGuest(true); currentUser = null; }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || `HTTP ${r.status}`);
  return body as T;
}

export async function me(): Promise<User | null> {
  try {
    const r = await fetch('/api/auth/me', { cache: 'no-store' });
    offline = false;
    currentUser = r.ok ? ((await r.json()) as User) : null;
    if (currentUser) setGuest(false);
  } catch { offline = true; currentUser = null; }
  return currentUser;
}

export async function login(username: string, password: string): Promise<User> {
  currentUser = await j<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  setGuest(false);
  return currentUser;
}
export async function logout() { await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}); currentUser = null; setGuest(false); }

export const listUsers = () => j<User[]>('/api/users');
export const createUser = (u: { username: string; name: string; password: string; role: Role }) => j<User>('/api/users', { method: 'POST', body: JSON.stringify(u) });
export const updateUser = (id: string, p: { name?: string; password?: string; role?: Role }) => j<User>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(p) });
export const deleteUser = (id: string) => j<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
