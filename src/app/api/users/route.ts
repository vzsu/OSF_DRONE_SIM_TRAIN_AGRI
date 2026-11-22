import { NextResponse } from 'next/server';
import { sessionUser, listUsers, createUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const me = await sessionUser(req);
  if (me?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });
  return NextResponse.json(await listUsers());
}

export async function POST(req: Request) {
  const me = await sessionUser(req);
  if (me?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });
  try {
    return NextResponse.json(await createUser(await req.json()));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
