import { NextResponse } from 'next/server';
import { clearCookieHeader } from '../../../../server/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json({ ok: true }, { headers: { 'set-cookie': clearCookieHeader() } });
}
