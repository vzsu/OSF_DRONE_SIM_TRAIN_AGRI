import { NextResponse } from 'next/server';
import { sessionUser, ensureAdmin } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await ensureAdmin(); // first run: creates the admin account
  const u = await sessionUser(req);
  return u ? NextResponse.json(u) : NextResponse.json({ error: 'not logged in' }, { status: 401 });
}
