import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('accounts', () => {
  it('first admin, login, sessions, students, guards', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'osf-auth-'));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const U = await import('../src/server/users');
      const users = await U.listUsers();
      expect(users.map((u) => u.username)).toEqual(['admin']);
      const pw = /password: (\S+)/.exec(readFileSync(path.join(dir, 'data/ADMIN_FIRST_LOGIN.txt'), 'utf8'))![1];
      expect(await U.login('admin', 'wrong', 'ip1')).toBeNull();
      const admin = (await U.login('admin', pw, 'ip1'))!;
      expect(admin.role).toBe('admin');
      expect(JSON.stringify(admin)).not.toContain('hash');
      const tok = U.makeToken(admin.id);
      const req = (t: string) => new Request('http://x/', { headers: { cookie: `${U.COOKIE}=${t}` } });
      expect((await U.sessionUser(req(tok)))?.id).toBe(admin.id);
      expect(await U.sessionUser(req(tok.slice(0, -2) + 'xx'))).toBeNull(); // tampered
      const st = await U.createUser({ username: 'Ravi.K', name: 'Ravi', password: 'secret1' });
      expect(st.username).toBe('ravi.k'); expect(st.role).toBe('student');
      await expect(U.createUser({ username: 'ravi.k', name: 'x', password: 'secret1' })).rejects.toThrow();
      await expect(U.createUser({ username: 'ab', name: 'x', password: 'secret1' })).rejects.toThrow();
      expect((await U.login('ravi.k', 'secret1', 'ip2'))?.id).toBe(st.id);
      await expect(U.deleteUser(admin.id)).rejects.toThrow(); // last admin
      for (let i = 0; i < 5; i++) await U.login('ravi.k', 'bad', 'ip3');
      await expect(U.login('ravi.k', 'secret1', 'ip3')).rejects.toThrow(/Too many/);
      const raw = readFileSync(path.join(dir, 'data/users.json'), 'utf8');
      expect(raw).not.toContain('secret1');
    } finally { process.chdir(cwd); }
  });
});
