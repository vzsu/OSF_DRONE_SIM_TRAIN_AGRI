import { NextResponse } from 'next/server';
import { listLogs, putLog, type WireLog } from '../../../server/logStore';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin sees every flight (or one student's with ?user=<id>); a student sees only their own. */
export async function GET(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const user = new URL(req.url).searchParams.get('user');
  if (me.role !== 'admin') return NextResponse.json(await listLogs(me.id));
  return NextResponse.json(await listLogs(user && /^u[0-9a-f]{12}$/.test(user) ? user : undefined));
}

export async function POST(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  try {
    const body = (await req.json()) as WireLog;
    // the server decides who flew, not the browser
    body.header.userId = me.id; body.header.trainee = me.name;
    const { bytes } = await putLog(body);
    return NextResponse.json({ ok: true, id: body.header.id, bytes });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
}
