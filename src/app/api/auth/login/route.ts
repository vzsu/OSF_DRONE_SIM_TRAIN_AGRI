import { NextResponse } from 'next/server';
import { login, makeToken, cookieHeader, clientIp } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { username, password } = (await req.json()) as { username: string; password: string };
    const u = await login(username, password, clientIp(req));
    if (!u) return NextResponse.json({ error: 'Wrong username or password' }, { status: 401 });
    return NextResponse.json(u, { headers: { 'set-cookie': cookieHeader(makeToken(u.id)) } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 429 });
  }
}
