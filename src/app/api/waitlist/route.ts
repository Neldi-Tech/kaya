// Closed-beta · interest waitlist (server, Admin SDK).
//
// POST { name, email, country? } → upserts waitlist/{emailKey}. Routed
// server-side so unauthenticated visitors on the login screen never get
// direct Firestore write access. When the autoAdmit switch is on, the
// same call also writes allowlist/{emailKey} so the registrant gets
// early access the moment they sign in. Keyed by email → one entry per
// person, re-submits just refresh it (no spam dupes).

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: { name?: string; email?: string; country?: string; ref?: string; source?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const country = body.country ? String(body.country).trim().slice(0, 60) : null;
  const referredBy = body.ref ? String(body.ref).trim().slice(0, 40) : null;
  const source = /^[a-z][a-z-]{1,20}$/.test(String(body.source || '')) ? String(body.source) : 'login';

  if (!name) return NextResponse.json({ error: 'name-required' }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'invalid-email' }, { status: 400 });

  await db.collection('waitlist').doc(email).set(
    {
      name,
      email,
      country,
      source,
      referredBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Auto-admit: if the switch is on, grant early access immediately by
  // adding the allowlist entry. The person passes the family-create gate
  // as soon as they sign in (with this email).
  let autoAdmitted = false;
  try {
    const cfg = (await db.collection('config').doc('beta').get()).data() as { autoAdmit?: boolean } | undefined;
    if (cfg?.autoAdmit === true) {
      await db.collection('allowlist').doc(email).set(
        { email, addedAt: FieldValue.serverTimestamp(), addedBy: 'auto-admit', auto: true },
        { merge: true },
      );
      autoAdmitted = true;
    }
  } catch {
    /* best-effort: the waitlist entry still lands even if auto-admit fails */
  }

  return NextResponse.json({ ok: true, autoAdmitted });
}
