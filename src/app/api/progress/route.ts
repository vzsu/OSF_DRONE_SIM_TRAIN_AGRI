import { NextResponse } from 'next/server';
import { getProgress, patchProgress, instructorPatch } from '../../../server/progressStore';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Own record; an admin may read any student's with ?user=<id>. */
export async function GET(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const other = new URL(req.url).searchParams.get('user');
  if (other && other !== me.id && me.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(await getProgress(other || me.id));
}

/** Students write only their own record (the server decides whose).
 *  Instructors grade a student with ?user=<id> (field exercises, safety items, exam unlock). */
export async function PUT(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  try {
    const body = await req.json();
    if (JSON.stringify(body).length > 50_000) throw new Error('too large');
    const other = new URL(req.url).searchParams.get('user');
    if (other) {
      if (me.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      return NextResponse.json(await instructorPatch(other, me.name, body));
    }
    // a student can never grade themselves or unlock their own exam
    const { field: _f, safety: _s, examOpen: _e, history: _h, ...own } = body ?? {};
    void _f; void _s; void _e; void _h;
    return NextResponse.json(await patchProgress(me.id, own));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
