import { NextResponse } from 'next/server';
import { getProgress, patchProgress } from '../../../server/progressStore';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Own progress; an admin may read any student's with ?user=<id>. */
export async function GET(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const other = new URL(req.url).searchParams.get('user');
  if (other && other !== me.id && me.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(await getProgress(other || me.id));
}

/** Students can only write their own progress (the server decides whose). */
export async function PUT(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  try {
    const body = await req.json();
    if (JSON.stringify(body).length > 50_000) throw new Error('too large');
    return NextResponse.json(await patchProgress(me.id, body));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
