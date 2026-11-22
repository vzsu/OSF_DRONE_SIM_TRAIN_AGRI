import { NextResponse } from 'next/server';
import { listLogs, putLog, type WireLog } from '../../../server/logStore';
import { sessionUser } from '../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin sees every flight; a student sees only their own. */
export async function GET(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const all = await listLogs();
  return NextResponse.json(me.role === 'admin' ? all : all.filter((l) => l.header.userId === me.id));
}

export async function POST(req: Request) {
  const me = await sessionUser(req);
  if (!me) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  try {
    const body = (await req.json()) as WireLog;
    // the server decides who flew, not the browser
    body.header.userId = me.id; body.header.trainee = me.name;
    await putLog(body);
    return NextResponse.json({ ok: true, id: body.header.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
  }
}
