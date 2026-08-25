// Kaya Business 2.0 · 🛎️ Family Orders Board (approved innovation, D5).
//
// Family members place real orders on a kid's business ("2 glasses for
// Saturday, please 🧃"); the kid accepts → makes → delivers, and the sale
// books through the normal client logSale path (money sweeps the Honey Pot
// exactly like any sale — this gateway never moves money).
//
// WHY AN ADMIN GATEWAY: the deployed Firestore rules can't express this —
// a SIBLING can't create docs under another kid's business, and the owner
// kid can't resolve approvalRequests. So orders live in
// families/{f}/businesses/{id}/orders via the Admin SDK (no client rules
// path exists → reads come through here too). Zero rules deploys — the
// same pattern as Quests/Diary/Leader gateways. Previews 503 without
// admin creds (skipped:true) — QA runs on prod with the QA-family harness.
//
// Actions (POST, Bearer ID token):
//   place   — any family member EXCEPT the owner kid; price snapshots from
//             the item (or the business headline) at place time.
//   accept | decline — the owner kid or a parent.
//   cancel  — the customer, while still open.
//   fulfill — the owner kid or a parent, on an accepted order; marks it
//             done. The CLIENT then logs the sale via logSale (owner-writable
//             by rules) so the money path stays the proven one.
// GET ?businessId=… lists that business's orders (family-only);
// GET ?mine=1 lists the caller's placed orders across the family.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

type OrderStatus = 'open' | 'accepted' | 'declined' | 'done' | 'cancelled';

interface OrderDoc {
  businessId: string;
  ownerId: string;              // Child.id of the business owner
  customerUid: string;
  customerName: string;
  customerRole: string;         // parent | kid | helper
  itemId?: string;
  productName: string;
  qty: number;
  unitPriceCents: number;       // snapshot at place time
  amountCents: number;
  note?: string;
  status: OrderStatus;
  placedAt: Date;
  decidedAt?: Date;
  doneAt?: Date;
  decidedBy?: string;
  /** Set true by fulfill so the client knows to log the sale exactly once. */
  saleToLog?: boolean;
}

interface Caller {
  uid: string;
  familyId: string;
  role: string;
  childId: string;
  name: string;
}

async function resolveCaller(req: NextRequest): Promise<{ caller?: Caller; error?: NextResponse }> {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return { error: NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' }, { status: 503 }) };
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return { error: NextResponse.json({ error: 'invalid-token' }, { status: 401 }) }; }
  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; displayName?: string; name?: string } | undefined;
  if (!user?.familyId) return { error: NextResponse.json({ error: 'no-family' }, { status: 403 }) };
  return {
    caller: {
      uid,
      familyId: user.familyId,
      role: user.role || '',
      childId: (user.childId || '').trim(),
      name: (user.displayName || user.name || 'Family member').trim(),
    },
  };
}

function serialize(id: string, o: OrderDoc) {
  const ms = (v: unknown): number | null => {
    const t = v as { toMillis?: () => number } | undefined;
    return typeof t?.toMillis === 'function' ? t.toMillis() : (v instanceof Date ? v.getTime() : null);
  };
  return {
    id,
    businessId: o.businessId,
    ownerId: o.ownerId,
    customerUid: o.customerUid,
    customerName: o.customerName,
    customerRole: o.customerRole,
    itemId: o.itemId || null,
    productName: o.productName,
    qty: o.qty,
    unitPriceCents: o.unitPriceCents,
    amountCents: o.amountCents,
    note: o.note || null,
    status: o.status,
    placedAt: ms(o.placedAt),
    decidedAt: ms(o.decidedAt),
    doneAt: ms(o.doneAt),
    saleToLog: !!o.saleToLog,
  };
}

/** Best-effort in-app notification + push (same shape the reminder cron uses). */
async function notify(familyId: string, uids: string[], title: string, message: string, link: string, tag: string) {
  const db = getAdminFirestore();
  if (!db) return;
  const famRef = db.collection('families').doc(familyId);
  for (const uid of uids) {
    try {
      await famRef.collection('notifications').add({
        type: 'business-order', title, message, read: false,
        forUserId: uid, link, createdAt: new Date(),
      });
    } catch { /* best-effort */ }
    void fetch(`${APP_URL}/api/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid, title, body: message, url: link, tag }),
    }).catch(() => {});
  }
}

/** Uids of the owner kid's logins + the family's parents. */
async function ownerAndParentUids(familyId: string, ownerId: string): Promise<{ owners: string[]; parents: string[] }> {
  const db = getAdminFirestore();
  if (!db) return { owners: [], parents: [] };
  const owners: string[] = [];
  const parents: string[] = [];
  try {
    const ks = await db.collection('users').where('familyId', '==', familyId).where('childId', '==', ownerId).get();
    ks.docs.forEach((d) => owners.push(d.id));
  } catch { /* leave empty */ }
  try {
    const ps = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get();
    ps.docs.forEach((d) => parents.push(d.id));
  } catch { /* leave empty */ }
  return { owners, parents };
}

export async function GET(req: NextRequest) {
  const { caller, error } = await resolveCaller(req);
  if (error || !caller) return error!;
  const db = getAdminFirestore()!;
  const famRef = db.collection('families').doc(caller.familyId);

  const businessId = (req.nextUrl.searchParams.get('businessId') || '').trim();
  const mine = req.nextUrl.searchParams.get('mine') === '1';

  if (businessId) {
    const bizSnap = await famRef.collection('businesses').doc(businessId).get();
    if (!bizSnap.exists) return NextResponse.json({ error: 'no-business' }, { status: 404 });
    const snap = await famRef.collection('businesses').doc(businessId)
      .collection('orders').orderBy('placedAt', 'desc').limit(50).get();
    return NextResponse.json({ orders: snap.docs.map((d) => serialize(d.id, d.data() as OrderDoc)) });
  }

  if (mine) {
    // Small family scale: walk the businesses and filter (no collection-group index needed).
    const bizSnap = await famRef.collection('businesses').get();
    const out: ReturnType<typeof serialize>[] = [];
    for (const b of bizSnap.docs) {
      const os = await b.ref.collection('orders').where('customerUid', '==', caller.uid).get();
      os.docs.forEach((d) => out.push(serialize(d.id, d.data() as OrderDoc)));
    }
    out.sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));
    return NextResponse.json({ orders: out.slice(0, 50) });
  }

  return NextResponse.json({ error: 'missing-params' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const { caller, error } = await resolveCaller(req);
  if (error || !caller) return error!;
  const db = getAdminFirestore()!;
  const famRef = db.collection('families').doc(caller.familyId);

  let body: {
    action?: string; businessId?: string; orderId?: string;
    itemId?: string; productName?: string; qty?: number; note?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const action = (body.action || '').trim();
  const businessId = (body.businessId || '').trim();
  if (!action || !businessId) return NextResponse.json({ error: 'missing-params' }, { status: 400 });

  const bizRef = famRef.collection('businesses').doc(businessId);
  const bizSnap = await bizRef.get();
  if (!bizSnap.exists) return NextResponse.json({ error: 'no-business' }, { status: 404 });
  const biz = bizSnap.data() as { ownerId?: string; name?: string; emoji?: string; status?: string; unitPriceCents?: number };
  const ownerId = biz.ownerId || '';
  const isParent = caller.role === 'parent';
  const isOwnerKid = caller.role === 'kid' && caller.childId === ownerId;

  // ── place ──
  if (action === 'place') {
    if (isOwnerKid) return NextResponse.json({ error: 'own-business' }, { status: 400 });
    if (biz.status === 'closed' || biz.status === 'paused') return NextResponse.json({ error: 'not-open' }, { status: 400 });
    const qty = Math.max(1, Math.min(99, Math.round(Number(body.qty) || 1)));
    const itemId = (body.itemId || '').trim();
    let productName = (body.productName || '').trim().slice(0, 60);
    let unitPriceCents = 0;
    if (itemId) {
      const itemSnap = await bizRef.collection('items').doc(itemId).get();
      if (itemSnap.exists) {
        const it = itemSnap.data() as { name?: string; unitMarketCents?: number; archived?: boolean };
        if (it.archived) return NextResponse.json({ error: 'item-archived' }, { status: 400 });
        productName = productName || (it.name || '').slice(0, 60);
        unitPriceCents = Math.max(0, Math.round(it.unitMarketCents || 0));
      }
    }
    if (!unitPriceCents) unitPriceCents = Math.max(0, Math.round(biz.unitPriceCents || 0));
    if (!productName) return NextResponse.json({ error: 'missing-product' }, { status: 400 });
    if (unitPriceCents <= 0) return NextResponse.json({ error: 'no-price', message: 'This item has no price yet — ask them to set one in the Pricing Studio.' }, { status: 400 });

    const order: OrderDoc = {
      businessId,
      ownerId,
      customerUid: caller.uid,
      customerName: caller.name,
      customerRole: caller.role,
      ...(itemId ? { itemId } : {}),
      productName,
      qty,
      unitPriceCents,
      amountCents: qty * unitPriceCents,
      ...(body.note?.trim() ? { note: body.note.trim().slice(0, 140) } : {}),
      status: 'open',
      placedAt: new Date(),
    };
    const ref = await bizRef.collection('orders').add(order as unknown as Record<string, unknown>);
    const { owners, parents } = await ownerAndParentUids(caller.familyId, ownerId);
    await notify(
      caller.familyId,
      [...new Set([...owners, ...parents.filter((p) => p !== caller.uid)])],
      '🛎️ New order!',
      `${caller.name} ordered ${qty}× ${productName} from ${biz.name || 'the business'}.`,
      `/business/${businessId}`,
      `order-${ref.id}`,
    );
    return NextResponse.json({ ok: true, orderId: ref.id, order: serialize(ref.id, order) });
  }

  // ── accept / decline / cancel / fulfill ──
  const orderId = (body.orderId || '').trim();
  if (!orderId) return NextResponse.json({ error: 'missing-params' }, { status: 400 });
  const orderRef = bizRef.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return NextResponse.json({ error: 'no-order' }, { status: 404 });
  const order = orderSnap.data() as OrderDoc;

  if (action === 'cancel') {
    if (order.customerUid !== caller.uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (order.status !== 'open') return NextResponse.json({ error: 'not-open' }, { status: 400 });
    await orderRef.update({ status: 'cancelled', decidedAt: new Date(), decidedBy: caller.uid });
    return NextResponse.json({ ok: true });
  }

  if (!isParent && !isOwnerKid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'accept' || action === 'decline') {
    if (order.status !== 'open') return NextResponse.json({ error: 'already-decided' }, { status: 400 });
    await orderRef.update({ status: action === 'accept' ? 'accepted' : 'declined', decidedAt: new Date(), decidedBy: caller.uid });
    await notify(
      caller.familyId,
      [order.customerUid],
      action === 'accept' ? '✅ Order accepted!' : 'Order declined',
      action === 'accept'
        ? `${biz.name || 'The business'} is on it — ${order.qty}× ${order.productName} coming up.`
        : `${biz.name || 'The business'} can't make ${order.productName} right now.`,
      `/business/${businessId}`,
      `order-${orderId}`,
    );
    return NextResponse.json({ ok: true });
  }

  if (action === 'fulfill') {
    if (order.status !== 'accepted') return NextResponse.json({ error: 'not-accepted' }, { status: 400 });
    // Mark done + hand the sale to the client exactly once (saleToLog flips
    // false in the same update the client makes after logSale succeeds — but
    // to keep this gateway money-free, "exactly once" is enforced by status:
    // fulfill only works on 'accepted', so a second tap can't re-run.
    await orderRef.update({ status: 'done', doneAt: new Date(), decidedBy: caller.uid, saleToLog: true });
    await notify(
      caller.familyId,
      [order.customerUid],
      '🧾 Order delivered!',
      `${order.qty}× ${order.productName} from ${biz.name || 'the business'} — enjoy!`,
      `/business/${businessId}`,
      `order-${orderId}`,
    );
    return NextResponse.json({ ok: true, logSale: { itemId: order.itemId || null, productName: order.productName, qty: order.qty, unitPriceCents: order.unitPriceCents, customerLabel: order.customerName, customerRef: order.customerUid } });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
