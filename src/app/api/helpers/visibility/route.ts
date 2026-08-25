// 🤝 Helper visibility mirror — Admin gateway (closed with Elia 2026-08-25).
//
//   POST { helperUid }  → recompute + mirror that one helper
//   POST { all: true }  → recompute + mirror every helper in the family
//                         (the backfill path; also fired fire-and-forget
//                          when a parent opens Settings → Helpers)
//
// Reads families/{f}/helpers/* (parent-only under rules) with the Admin
// SDK and writes the verdict to users/{helperUid}.helperListed, which is
// family-readable. Client code can neither read the source nor write the
// target, which is exactly why this route exists — and why the change
// needs ZERO firestore rules/index deploys.
//
// Parents only: the verdict is a parent-controlled fact.
// Route files export only handlers/config (Next constraint).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { helperIsListed } from '@/lib/helperVisibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface UserDoc { familyId?: string; role?: string }

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as UserDoc | undefined;
  if (!user?.familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });
  const familyId = user.familyId;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const one = typeof body.helperUid === 'string' ? body.helperUid : null;
  if (!one && body.all !== true) {
    return NextResponse.json({ error: 'helperUid-or-all-required' }, { status: 400 });
  }

  const helpersCol = db.collection('families').doc(familyId).collection('helpers');
  const docs = one
    ? [await helpersCol.doc(one).get()]
    : (await helpersCol.get()).docs;

  // Only touch user docs that actually belong to this family and are
  // helpers — a stale HelperLink must never rewrite someone else's doc.
  let written = 0;
  const results: Array<{ uid: string; listed: boolean }> = [];
  for (const d of docs) {
    if (!d.exists) continue;
    const link = d.data() as { status?: string; kidIds?: unknown };
    const listed = helperIsListed(link);
    const userRef = db.collection('users').doc(d.id);
    const snap = await userRef.get();
    const u = snap.data() as (UserDoc & { helperListed?: boolean }) | undefined;
    if (!snap.exists || u?.familyId !== familyId || u?.role !== 'helper') continue;
    results.push({ uid: d.id, listed });
    if (u.helperListed === listed) continue;               // idempotent — no-op write skipped
    await userRef.update({ helperListed: listed });
    written += 1;
  }

  return NextResponse.json({ ok: true, checked: results.length, written, results });
}
