// Kaya Sparks · Materials file proxy (open + download).
//
// Why this exists: a kid's device hitting a Firebase Storage download URL
// DIRECTLY breaks two ways we saw in the field —
//   • Open: an <iframe src=storageURL> for a PDF gets hijacked by iOS into
//     the top-level webview; tapping "back" returns to the PWA with the
//     session lost → the kid lands on a broken/"error" profile.
//   • Download: browser-side fetch() of the cross-origin storage URL is
//     blocked by CORS (the bucket has no CORS config — same reason .docx
//     already routes through /api/docx-render), so the blob save silently
//     fails.
//
// Serving the bytes from OUR OWN origin fixes both: the iframe + the
// download anchor now point at same-origin /api/sparks/material-file, so
// iOS keeps the PWA in the foreground and there is no cross-origin fetch.
//
//   ?url=<storage url>&mode=inline    → Content-Disposition: inline  (Open)
//   ?url=<storage url>&mode=download  → Content-Disposition: attachment (Save)
//
// Hardening mirrors /api/docx-render: only this project's Storage buckets
// are proxied, so Kaya can't be used as a generic open proxy.

import { NextRequest, NextResponse } from 'next/server';

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

/** RFC 5987 filename for Content-Disposition — strips quotes/control chars
 *  and provides an ASCII fallback plus a UTF-8 encoded form. */
function dispositionFilename(name: string): string {
  const clean = (name || 'material').replace(/["\\\r\n]/g, '_').slice(0, 200);
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_');
  const utf8 = encodeURIComponent(clean);
  return `filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const url = params.get('url');
  const mode = params.get('mode') === 'download' ? 'download' : 'inline';
  const nameParam = params.get('name') || '';

  if (!url) return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  if (!isAllowed(url)) return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach storage: ${e instanceof Error ? e.message : 'fetch failed'}` },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Storage returned ${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const contentLength = upstream.headers.get('content-length') || undefined;
  const disposition = `${mode === 'download' ? 'attachment' : 'inline'}; ${dispositionFilename(nameParam)}`;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    // Materials are addressed by id + token and are immutable per id, so the
    // bytes are safe to cache downstream.
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (contentLength) headers['Content-Length'] = contentLength;

  // Stream the bytes straight through — no buffering of the whole file.
  return new NextResponse(upstream.body, { status: 200, headers });
}
