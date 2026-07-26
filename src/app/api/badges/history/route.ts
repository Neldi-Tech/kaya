// 📜 Badge history (BDG PR4 · B16/B17) — every badge anyone in the family
// ever earned, with the date it landed. Mirrors 📜 Redemption history: kids
// see ONLY their own row set, parents/helpers see the whole family and can
// filter by kid.
//
// Read through this Admin gateway rather than a Firestore rule: `badgeLog`
// has no client read rule, and an Admin route needs zero rules deploys (the
// same call the Diary made). The route is the privacy boundary — a kid's
// token can never widen the query beyond their own childId.
//
// Queries stay index-free on purpose: family-wide is a single orderBy, and
// per-kid is a single equality filter sorted in memory. No composite index,
// so no destructive index deploy.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Row {
  id: string;
  childId: string;
  badgeId: string;
  name: string;
  icon: string;
  tier: string;
  area: string;
  how: string;
  earnedAt: number | null;
}

export async function GET(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  const prof = (await db.collection('users').doc(uid).get()).data() as
    { role?: string; familyId?: string; childId?: string } | undefined;
  if (!prof?.familyId) return NextResponse.json({ ok: false, error: 'no-family' }, { status: 403 });
  const familyId = prof.familyId;
  const isKid = prof.role === 'kid';

  // A kid is pinned to their own history no matter what they ask for.
  const asked = (req.nextUrl.searchParams.get('childId') || '').trim();
  const childId = isKid ? (prof.childId || '') : asked;
  if (isKid && !childId) return NextResponse.json({ ok: true, rows: [] });

  const cap = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 300));

  try {
    const col = db.collection('families').doc(familyId).collection('badgeLog');
    const snap = childId
      ? await col.where('childId', '==', childId).limit(cap).get()
      : await col.orderBy('earnedAt', 'desc').limit(cap).get();

    const rows: Row[] = snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      const at = v.earnedAt as { toMillis?: () => number } | undefined;
      return {
        id: d.id,
        childId: String(v.childId ?? ''),
        badgeId: String(v.badgeId ?? ''),
        name: String(v.name ?? ''),
        icon: String(v.icon ?? '🏅'),
        tier: String(v.tier ?? 'easy'),
        area: String(v.area ?? 'points'),
        how: String(v.how ?? ''),
        earnedAt: typeof at?.toMillis === 'function' ? at.toMillis() : null,
      };
    });
    // Newest first. Rows still awaiting their serverTimestamp sort last.
    rows.sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0));

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'history-failed' }, { status: 500 });
  }
}
