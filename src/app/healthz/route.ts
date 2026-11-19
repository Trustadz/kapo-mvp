import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/connection';

export const dynamic = 'force-dynamic';

/**
 * Container/uptime health endpoint. Unauthenticated by design but returns no
 * installation details; Docker Compose uses it for the service healthcheck.
 */
export async function GET() {
  try {
    getDb().prepare('SELECT 1 AS ok').get();
    return NextResponse.json(
      { status: 'ok' },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'error' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
