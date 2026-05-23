// Live build id — used by the client UpdatePrompt to detect when a new
// version has been deployed while an (especially installed PWA) session
// stays open. Read at REQUEST time so it reflects the currently-deployed
// function, not a baked value. No caching, so a stale client always sees
// the live deployment's id.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'dev';
  return NextResponse.json(
    { build },
    { headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' } },
  );
}
