// GET /api/admin/upgrade-requests — operator-only. Lists every request
// with pending ones first.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import type { UpgradeRequestRow } from '@/lib/tierCodes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db } = r;

  const snap = await db.collection('upgradeRequests').orderBy('createdAt', 'desc').limit(200).get();
  const rows: UpgradeRequestRow[] = [];

  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const familyId = String(d.familyId ?? '');
    let familyName = String(d.familyName ?? '(unnamed)');
    let familyHandle: string | null = null;
    let requesterName = String(d.requesterName ?? '');
    if (familyId) {
      const famSnap = await db.collection('families').doc(familyId).get();
      if (famSnap.exists) {
        const fam = famSnap.data() as { name?: string; handle?: string };
        familyName = fam.name ?? familyName;
        familyHandle = fam.handle ?? null;
      }
    }
    if (!requesterName && d.requesterUid) {
      const userSnap = await db.collection('users').doc(String(d.requesterUid)).get();
      if (userSnap.exists) {
        requesterName = String((userSnap.data() as { displayName?: string }).displayName ?? '');
      }
    }
    rows.push({
      id: doc.id,
      familyId,
      familyName,
      familyHandle,
      requesterUid: String(d.requesterUid ?? ''),
      requesterName,
      requesterEmail: String(d.requesterEmail ?? ''),
      requestedTier: d.requestedTier as 'nest' | 'home' | 'castle',
      requestedAddons: Array.isArray(d.requestedAddons) ? d.requestedAddons as string[] : [],
      note: String(d.note ?? ''),
      status: (d.status as 'pending' | 'fulfilled' | 'dismissed') ?? 'pending',
      fulfilledCodeId: (d.fulfilledCodeId as string | null) ?? null,
      createdAtMs: (d.createdAt && typeof (d.createdAt as { toMillis?: () => number }).toMillis === 'function')
        ? (d.createdAt as { toMillis: () => number }).toMillis()
        : 0,
    });
  }

  return NextResponse.json({ requests: rows });
}
