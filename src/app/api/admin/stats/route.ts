// Closed-beta · operator console stats (server, Admin SDK).
//
// GET with `Authorization: Bearer <idToken>` → cross-family headcounts
// the operator console shows. Done server-side because the per-family
// security rules block an operator from reading other families' docs,
// and because the "Kaya World" total is exactly the kind of aggregate
// that should move to maintained counters at scale (this is the seam).
//
// Verifies the caller's ID token resolves to an operator before reading.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  // ── Verify caller is an operator ──
  const authz = req.headers.get('authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let email = '';
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    email = (decoded.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'bad-token' }, { status: 401 });
  }
  if (!email) return NextResponse.json({ error: 'no-email' }, { status: 403 });
  const opSnap = await db.collection('operators').doc(email).get();
  if (!opSnap.exists) return NextResponse.json({ error: 'not-operator' }, { status: 403 });

  // ── Funnel (early-access pipeline) ──
  // active = allowlisted emails that belong to a user who has a family.
  const [allowlistSnap, usersSnap, waitlistCount, operatorsCount] = await Promise.all([
    db.collection('allowlist').get(),
    db.collection('users').get(),
    db.collection('waitlist').count().get(),
    db.collection('operators').count().get(),
  ]);

  const emailsWithFamily = new Set<string>();
  let parents = 0, helpers = 0, guests = 0;
  usersSnap.forEach((d) => {
    const u = d.data() as { email?: string; role?: string; familyId?: string };
    const e = (u.email ?? '').trim().toLowerCase();
    if (e && u.familyId) emailsWithFamily.add(e);
    if (u.role === 'parent') parents += 1;
    else if (u.role === 'helper') helpers += 1;
    else if (u.role === 'guest') guests += 1;
  });

  const allowlistEmails = allowlistSnap.docs.map((d) => (d.id ?? '').toLowerCase());
  const active = allowlistEmails.filter((e) => emailsWithFamily.has(e)).length;
  const allowlist = allowlistEmails.length;
  const invited = Math.max(0, allowlist - active);

  // ── Kaya World (every person across every family) ──
  // kids = child profiles (people, whether or not they have a login);
  // families = family docs. Aggregate counts keep this cheap.
  const [kidsCount, familiesCount] = await Promise.all([
    db.collectionGroup('children').count().get(),
    db.collection('families').count().get(),
  ]);
  const kids = kidsCount.data().count;
  const families = familiesCount.data().count;
  const total = parents + helpers + guests + kids;

  return NextResponse.json({
    funnel: {
      active,
      invited,
      waitlist: waitlistCount.data().count,
      operators: operatorsCount.data().count,
      allowlist,
    },
    world: { total, parents, kids, helpers, guests, families },
  });
}
