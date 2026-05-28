// POST /api/admin/families/[familyId]/recount-storage — operator-only.
//
// Scans Firebase Storage for files under the family's prefixes, sums the
// sizes, and writes the total to families/{familyId}.storage.bytes (+
// stamps recountedAt). Heavy on the bucket — fine for closed beta but
// rate-limit or background-job if we ever scale.
//
// Prefixes covered (every upload site Kaya writes to). New upload paths
// should add their prefix here OR migrate to the future
// `enforceUploadQuota` wrapper which keeps the counter live-correct.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/buzzServer';
import { getAdminStorage } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Storage scans across a whole bucket can take longer than the default
// 10 s — bump to the Vercel max (60 s on hobby, 300 s on pro). For
// closed-beta-size buckets this is plenty.
export const maxDuration = 60;

const PREFIXES = (familyId: string): string[] => [
  // Each entry is a known upload root for the family. Order doesn't matter;
  // we sum across all of them.
  `moments/${familyId}/`,
  `business/${familyId}/`,
  `pantry/${familyId}/`,
  `receipts/${familyId}/`,
  `sparks/${familyId}/`,
  `messaging/${familyId}/`,
  `workplan-proof/${familyId}/`,
  `albums/${familyId}/`,
  `dine-out/${familyId}/`,
  `families/${familyId}/`, // family-cover + member-avatars
];

export async function POST(req: NextRequest, ctx: { params: { familyId: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const familyId = ctx.params.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family-id' }, { status: 400 });

  const storage = getAdminStorage();
  if (!storage) return NextResponse.json({ error: 'storage-not-configured' }, { status: 503 });

  const bucket = storage.bucket(); // default bucket
  let totalBytes = 0;
  const breakdown: Record<string, number> = {};

  for (const prefix of PREFIXES(familyId)) {
    let subtotal = 0;
    try {
      const [files] = await bucket.getFiles({ prefix });
      for (const f of files) {
        // metadata.size is a string of bytes per the Cloud Storage API.
        const size = Number((f.metadata as { size?: string | number })?.size ?? 0);
        if (Number.isFinite(size)) subtotal += size;
      }
    } catch (e) {
      // A missing prefix is fine — the bucket just returns []. Anything
      // else we log and continue so a single broken prefix doesn't kill
      // the whole recount.
      console.warn(`[recount-storage] prefix ${prefix} failed`, e);
    }
    breakdown[prefix] = subtotal;
    totalBytes += subtotal;
  }

  await r.db.collection('families').doc(familyId).update({
    'storage.bytes': totalBytes,
    'storage.extraGB': FieldValue.increment(0), // ensure the field exists
    'storage.recountedAt': FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, bytes: totalBytes, breakdown });
}
