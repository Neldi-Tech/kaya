// Public "scan-back" endpoint for a shared purchase form (2026-07-04).
//
// Powers the on-paper QR → a buyer/supplier opens /p/{token} on their phone
// and types the ACTUAL prices back into Kaya, which pre-fill the parent's
// reconcile. Admin-SDK backed, so NO Firestore rules/index deploy:
//   • A top-level `shareTokens/{token}` lookup doc maps an opaque token →
//     { familyId, requestId, currency, createdAt }. Every read is a direct
//     doc-get by id — no collectionGroup query, hence no index.
//
// Actions:
//   POST { action:'ensureToken', requestId, currency }  (AUTHED)
//        → mint (or reuse) a 48h token for a request the caller's family owns.
//   GET  ?token=…                                        (PUBLIC)
//        → read-only view data for the public page. Budget cap never leaves.
//   POST { action:'logActuals', token, items:[…] }       (PUBLIC, token-gated)
//        → stage buyer-entered actual prices onto the request + ping parents.
//          Cannot change status/approve/close — bounded blast radius.

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { formatRequestSeq, type PurchaseRequest, type PurchaseRequestItem } from '@/lib/purchase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MS = 48 * 60 * 60 * 1000;
const SHAREABLE = ['approved', 'reconciling', 'pending_close', 'closed'];
const WRITABLE = ['approved', 'reconciling', 'pending_close'];
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (0/o/1/l)

function mintToken(): string {
  const b = randomBytes(9);
  let s = '';
  for (const x of b) s += ALPHABET[x % 32];
  return s;
}

function posInt(v: unknown, max = 1e12): number | undefined {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

type TokenDoc = { familyId: string; requestId: string; currency?: string; createdAt?: number };

async function readToken(db: FirebaseFirestore.Firestore, token: string) {
  if (!token || token.length > 40) return null;
  const snap = await db.collection('shareTokens').doc(token).get();
  if (!snap.exists) return null;
  const t = snap.data() as TokenDoc;
  if (!t?.familyId || !t?.requestId) return null;
  if (t.createdAt && Date.now() - t.createdAt > TTL_MS) return { expired: true, t };
  return { expired: false, t };
}

// ── GET: public read-only view ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const token = req.nextUrl.searchParams.get('token') || '';
  const found = await readToken(db, token);
  if (!found) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (found.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const { familyId, requestId, currency } = found.t;

  const reqSnap = await db.collection('families').doc(familyId).collection('purchaseRequests').doc(requestId).get();
  if (!reqSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const p = { id: reqSnap.id, ...reqSnap.data() } as PurchaseRequest;
  if (!SHAREABLE.includes(p.status)) return NextResponse.json({ error: 'not-shareable' }, { status: 400 });

  const famSnap = await db.collection('families').doc(familyId).get();
  const familyName = (famSnap.data() as { name?: string } | undefined)?.name || 'Kaya Family';

  // Read-only projection — the parent-only cap is NEVER included.
  return NextResponse.json({
    ref: typeof p.seq === 'number' ? formatRequestSeq(p.module, p.seq) : p.name,
    module: p.module,
    familyName,
    currency: currency || 'USD',
    status: p.status,
    canLog: WRITABLE.includes(p.status),
    note: p.note || '',
    items: (p.items || []).map((it) => ({
      id: it.id, name: it.name, name2: it.name2 || '', category: it.category || '',
      qty: it.qty, unit: it.unit, estimatedCents: it.estimatedCents ?? 0,
      actualCents: it.actualCents ?? null, actualQty: it.actualQty ?? null,
    })),
  });
}

// ── POST: ensureToken (authed) | logActuals (public) ────────────────
export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { action?: string; requestId?: string; currency?: string; token?: string; items?: unknown; buyerName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = body.action || '';

  // ── ensureToken (AUTHED) ──────────────────────────────────────────
  if (action === 'ensureToken') {
    const authToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!authToken) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    let uid: string;
    try { uid = (await auth.verifyIdToken(authToken)).uid; }
    catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const currency = (typeof body.currency === 'string' && body.currency.length <= 5) ? body.currency : 'USD';
    if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

    const familyId = (await db.collection('users').doc(uid).get()).data()?.familyId as string | undefined;
    if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

    const reqRef = db.collection('families').doc(familyId).collection('purchaseRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const p = reqSnap.data() as PurchaseRequest;
    if (!SHAREABLE.includes(p.status)) return NextResponse.json({ error: 'not-shareable' }, { status: 400 });

    let token = (p as { shareToken?: string }).shareToken;
    // Reuse an existing, non-expired token; otherwise mint fresh.
    let reuse = false;
    if (token) {
      const existing = await db.collection('shareTokens').doc(token).get();
      const t = existing.data() as TokenDoc | undefined;
      if (existing.exists && t?.createdAt && Date.now() - t.createdAt <= TTL_MS) reuse = true;
    }
    if (!reuse) {
      token = mintToken();
      await db.collection('shareTokens').doc(token).set({ familyId, requestId, currency, createdAt: Date.now() });
      await reqRef.update({ shareToken: token });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
    return NextResponse.json({ token, url: `${appUrl}/p/${token}` });
  }

  // ── logActuals (PUBLIC, token-gated) ──────────────────────────────
  if (action === 'logActuals') {
    const token = typeof body.token === 'string' ? body.token : '';
    const found = await readToken(db, token);
    if (!found) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (found.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
    const { familyId, requestId } = found.t;

    const reqRef = db.collection('families').doc(familyId).collection('purchaseRequests').doc(requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const p = { id: reqSnap.id, ...reqSnap.data() } as PurchaseRequest;
    if (!WRITABLE.includes(p.status)) return NextResponse.json({ error: 'closed' }, { status: 400 });

    const updates = new Map<string, { actualCents?: number; actualQty?: number }>();
    if (Array.isArray(body.items)) {
      for (const raw of (body.items as unknown[]).slice(0, 200)) {
        const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const id = typeof r.id === 'string' ? r.id : '';
        if (!id) continue;
        const ac = posInt(r.actualCents);
        const aq = posInt(r.actualQty, 1e6);
        const patch: { actualCents?: number; actualQty?: number } = {};
        if (ac !== undefined) patch.actualCents = ac;
        if (aq !== undefined) patch.actualQty = aq;
        if (Object.keys(patch).length) updates.set(id, patch);
      }
    }
    if (updates.size === 0) return NextResponse.json({ error: 'no-actuals' }, { status: 400 });

    const items: PurchaseRequestItem[] = (p.items || []).map((it) => {
      const u = updates.get(it.id);
      if (!u) return it;
      const next = { ...it };
      if (u.actualCents !== undefined) next.actualCents = u.actualCents;
      if (u.actualQty !== undefined) next.actualQty = u.actualQty;
      return next;
    });
    const actualTotalCents = items.reduce((s, it) => s + (it.actualCents != null && it.actualQty != null ? it.actualCents * it.actualQty : 0), 0);

    await reqRef.update({
      items,
      actualTotalCents,
      scanbackAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Ping the parents so they know prices came in.
    try {
      const ref = typeof p.seq === 'number' ? formatRequestSeq(p.module, p.seq) : p.name;
      const parents = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get();
      for (const d of parents.docs) {
        await db.collection('families').doc(familyId).collection('notifications').add({
          type: 'purchase-shared',
          title: '🧾 Prices came in',
          message: `${updates.size} actual price${updates.size === 1 ? '' : 's'} were logged for ${ref} — review & reconcile.`,
          read: false,
          forUserId: d.id,
          link: `/pantry/purchase/${requestId}`,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } catch { /* notify is best-effort */ }

    return NextResponse.json({ ok: true, updated: updates.size });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
