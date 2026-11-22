// Users + sessions for the LAN training server (students and instructors/admins).
// Store: ./data/users.json (scrypt password hashes, never plain text). Sessions: HMAC-signed cookie
// with a server secret in ./data/secret.key, so logins survive a server restart.
// First run creates an `admin` account with a random password written to ./data/ADMIN_FIRST_LOGIN.txt.
import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type Role = 'admin' | 'student';
export interface User { id: string; username: string; name: string; role: Role; salt: string; hash: string; createdAt: string }
export type PublicUser = Omit<User, 'salt' | 'hash'>;

const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'users.json');
const SECRET_FILE = path.join(DIR, 'secret.key');
export const COOKIE = 'osf_session';
const SESSION_DAYS = 14;

const pub = ({ salt: _s, hash: _h, ...u }: User): PublicUser => u;

function secret(): Buffer {
  mkdirSync(DIR, { recursive: true });
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
}

function hashPw(pw: string, salt: string): string {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}

async function load(): Promise<User[]> {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')).users as User[]; } catch { return []; }
}
async function save(users: User[]) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ users }, null, 2));
}

let ensured = false;
/** Create the first admin account if there are no users yet. */
export async function ensureAdmin(): Promise<User[]> {
  const users = await load();
  if (users.length || ensured) return users;
  ensured = true;
  const pw = crypto.randomBytes(6).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const admin: User = { id: 'u' + crypto.randomBytes(6).toString('hex'), username: 'admin', name: 'Instructor', role: 'admin', salt, hash: hashPw(pw, salt), createdAt: new Date().toISOString() };
  users.push(admin);
  await save(users);
  await fs.writeFile(path.join(DIR, 'ADMIN_FIRST_LOGIN.txt'), `OSF Agri Flight Trainer — first admin login\nusername: admin\npassword: ${pw}\n\nChange it in the Admin panel after logging in, then delete this file.\n`);
  console.log(`\n  First admin account created → username: admin  password: ${pw}\n  (also saved in data/ADMIN_FIRST_LOGIN.txt — change it after login)\n`);
  return users;
}

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export async function listUsers(): Promise<PublicUser[]> { return (await ensureAdmin()).map(pub); }

export async function createUser(input: { username: string; name: string; password: string; role?: Role }): Promise<PublicUser> {
  const users = await ensureAdmin();
  const username = String(input.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error('Username: 3–32 characters, a–z 0–9 . _ -');
  if (users.some((u) => u.username === username)) throw new Error('Username already exists');
  if (String(input.password ?? '').length < 6) throw new Error('Password: at least 6 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const u: User = { id: 'u' + crypto.randomBytes(6).toString('hex'), username, name: String(input.name || username).slice(0, 60), role: input.role === 'admin' ? 'admin' : 'student', salt, hash: hashPw(input.password, salt), createdAt: new Date().toISOString() };
  users.push(u); await save(users);
  return pub(u);
}

export async function updateUser(id: string, patch: { name?: string; password?: string; role?: Role }): Promise<PublicUser> {
  const users = await ensureAdmin();
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error('User not found');
  if (patch.name !== undefined) u.name = String(patch.name).slice(0, 60) || u.name;
  if (patch.password !== undefined) {
    if (String(patch.password).length < 6) throw new Error('Password: at least 6 characters');
    u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(patch.password, u.salt);
  }
  if (patch.role) {
    if (u.role === 'admin' && patch.role !== 'admin' && users.filter((x) => x.role === 'admin').length <= 1) throw new Error('Keep at least one admin');
    u.role = patch.role;
  }
  await save(users);
  return pub(u);
}

export async function deleteUser(id: string) {
  const users = await ensureAdmin();
  const u = users.find((x) => x.id === id);
  if (!u) return;
  if (u.role === 'admin' && users.filter((x) => x.role === 'admin').length <= 1) throw new Error('Cannot delete the last admin');
  await save(users.filter((x) => x.id !== id));
}

// ---------- login + sessions ----------
const fails = new Map<string, { n: number; t: number }>();

export async function login(username: string, password: string, ip: string): Promise<PublicUser | null> {
  const f = fails.get(ip);
  if (f && f.n >= 5 && Date.now() - f.t < 60_000) throw new Error('Too many attempts — wait a minute');
  const users = await ensureAdmin();
  const u = users.find((x) => x.username === String(username ?? '').trim().toLowerCase());
  const ok = !!u && crypto.timingSafeEqual(Buffer.from(hashPw(String(password ?? ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) { fails.set(ip, { n: (f && Date.now() - f.t < 60_000 ? f.n : 0) + 1, t: Date.now() }); return null; }
  fails.delete(ip);
  return pub(u!);
}

export function makeToken(userId: string): string {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const body = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export const cookieHeader = (token: string) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookieHeader = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** The logged-in user for a request, or null. */
export async function sessionUser(req: Request): Promise<PublicUser | null> {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!m) return null;
  const [id, exp, sig] = m.slice(COOKIE.length + 1).split('.');
  if (!id || !exp || !sig) return null;
  const want = crypto.createHmac('sha256', secret()).update(`${id}.${exp}`).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  if (Date.now() > +exp) return null;
  const u = (await load()).find((x) => x.id === id);
  return u ? pub(u) : null;
}

export const clientIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
