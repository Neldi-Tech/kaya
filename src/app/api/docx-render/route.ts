// Kaya · server-side .docx → HTML renderer.
//
// Why this exists: browser-side `fetch()` of Firebase Storage URLs hits
// CORS (the SDK works because it uses internal-credentials; the public
// `?alt=media&token=...` URL is fine for <iframe>/<img>/download but
// rejected for cross-origin `fetch()`). Mammoth needs to read the file
// bytes, so we proxy + convert on our side.
//
// Hardening:
//  • Only Firebase Storage URLs for THIS project are accepted (prefix
//    check). Prevents using Kaya as a generic CORS proxy.
//  • Response cached for an hour — materials are immutable per id.
//
// Out of scope today: .xlsx, .pptx, legacy .doc — mammoth only reads
// docx. Other Office formats keep the "Preview not supported" path.

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';

export const runtime = 'nodejs';
export const maxDuration = 30;

const STORAGE_PREFIX = 'https://firebasestorage.googleapis.com/v0/b/';
const ALLOWED_BUCKETS = [
  'kaya-app-b9463.firebasestorage.app',
  'kaya-app-b9463.appspot.com',           // legacy bucket id, kept for safety
];

function isAllowed(url: string): boolean {
  if (!url.startsWith(STORAGE_PREFIX)) return false;
  return ALLOWED_BUCKETS.some((b) => url.startsWith(`${STORAGE_PREFIX}${b}/`));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }
  if (!isAllowed(url)) {
    return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach storage: ${e instanceof Error ? e.message : 'fetch failed'}` },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: `Storage returned ${upstream.status}` }, { status: 502 });
  }

  try {
    const arrayBuf = await upstream.arrayBuffer();
    const out = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuf) });
    return NextResponse.json(
      { html: out.value || '' },
      {
        headers: {
          // Materials are addressed by id + token — safe to cache the
          // rendered HTML downstream.
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Convert failed' },
      { status: 500 },
    );
  }
}
