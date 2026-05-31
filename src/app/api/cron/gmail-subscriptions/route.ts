// Kaya · Gmail subscription auto-scan (weekly cron).
//
// For every parent who connected their Gmail, mint a fresh access token from
// the stored (encrypted) refresh token, scan for NEW subscription receipts
// since the last scan, parse them, and write the finds as pending suggestions
// (deduped vs existing subs + suggestions). This is what makes auto-detect
// "set & forget" — the parent never has to remember to scan.
//
// Read-only. Raw email bodies are never stored — only structured suggestions,
// which the parent confirms before any subscription is created. No-ops cleanly
// when admin creds / OAuth client / encryption key are absent.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  isGmailConfigured, refreshAccessToken, fetchSubscriptionEmailBodies,
} from '@/lib/gmailSubscriptionScan';
import { isTokenCryptoConfigured, decryptToken } from '@/lib/gmailTokenCrypto';
import { listActiveConnections, updateLastScan, writeSuggestions } from '@/lib/gmailConnections';
import { parseSubscriptionsFromText, dedupeDrafts, type ParsedSubDraft } from '@/lib/subscriptionReceiptParse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(req: NextRequest) {
  // Vercel cron sends `authorization: Bearer <CRON_SECRET>` when the secret
  // is set; reject anything else. (Same pattern as the other crons.)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!getAdminFirestore()) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });
  if (!isGmailConfigured()) return NextResponse.json({ skipped: true, reason: 'gmail-not-configured' });
  if (!isTokenCryptoConfigured()) return NextResponse.json({ skipped: true, reason: 'enc-key-not-configured' });

  const connections = await listActiveConnections();
  let scanned = 0, suggested = 0;

  for (const conn of connections) {
    try {
      const refresh = decryptToken(conn.refreshTokenEnc);
      if (!refresh) continue; // bad/rotated key — skip, leave the doc as-is
      const accessToken = await refreshAccessToken(refresh);
      if (!accessToken) continue; // user revoked at Google, or transient — skip

      // Incremental: only mail newer than the last scan baseline.
      const afterEpochSec = conn.lastScanAtMs ? Math.floor(conn.lastScanAtMs / 1000) : undefined;
      const bodies = await fetchSubscriptionEmailBodies(accessToken, {
        months: 12, max: 25, afterEpochSec,
      });
      scanned += 1;

      let drafts: ParsedSubDraft[] = [];
      for (const body of bodies) {
        try { drafts.push(...await parseSubscriptionsFromText(body)); }
        catch { /* skip a body that fails */ }
      }
      drafts = dedupeDrafts(drafts);

      const written = drafts.length ? await writeSuggestions(conn.familyId, conn.uid, drafts) : 0;
      suggested += written;
      await updateLastScan(conn.familyId, conn.uid, written);
    } catch { /* one bad mailbox shouldn't stop the rest */ }
  }

  return NextResponse.json({ ok: true, connections: connections.length, scanned, suggested });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
