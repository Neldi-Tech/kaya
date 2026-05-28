// GET  /api/admin/tier-codes — operator-only. List every code, newest first.
// POST /api/admin/tier-codes — operator-only. Generates a per-family code
//   AND auto-emails it via Resend. The admin never sees the raw code —
//   the response only confirms whether the email landed (so the UI can
//   show "✓ Sent" / "Failed to send"). On Resend failure the code is
//   still stored so a Resend attempt can be made later.
//
// Body: {
//   familyId, requestId?, tierId, addons?, expiry (ExpiryPreset), recipientEmail?
// }
//
// One-active-code-per-family invariant: if the family has any 'fresh'
// codes, they're auto-revoked before the new one is generated.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_ADDONS, type SubscriptionTierId } from '@/lib/tiers';
import {
  EXPIRY_OPTIONS, expiryMsFromPreset, generateTierCode,
  type ExpiryPreset, type TierCodeRow,
} from '@/lib/tierCodes';
import { resolveRecipientEmail, sendCodeEmail } from '@/lib/tierCodesServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_IDS = new Set<SubscriptionTierId>(['nest', 'home', 'castle']);
const VALID_ADDON_IDS = new Set(DEFAULT_ADDONS.map((a) => a.id));
const VALID_EXPIRY = new Set<ExpiryPreset>(EXPIRY_OPTIONS.map((o) => o.id));

// ── GET: list all codes ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db } = r;

  const snap = await db.collection('tierCodes').orderBy('createdAt', 'desc').limit(200).get();
  const rows: TierCodeRow[] = snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    const createdAtMs = x.createdAt && typeof (x.createdAt as { toMillis?: () => number }).toMillis === 'function'
      ? (x.createdAt as { toMillis: () => number }).toMillis() : 0;
    const redeemedAtMs = x.redeemedAt && typeof (x.redeemedAt as { toMillis?: () => number }).toMillis === 'function'
      ? (x.redeemedAt as { toMillis: () => number }).toMillis() : null;
    return {
      id: d.id,
      code: String(x.code ?? ''),
      tierId: x.tierId as SubscriptionTierId,
      addons: Array.isArray(x.addons) ? (x.addons as string[]) : [],
      familyId: String(x.familyId ?? ''),
      familyName: String(x.familyName ?? ''),
      familyHandle: (x.familyHandle as string | null) ?? null,
      recipientEmail: String(x.recipientEmail ?? ''),
      expiresAtMs: typeof x.expiresAtMs === 'number' ? x.expiresAtMs : null,
      status: (x.status as 'fresh' | 'redeemed' | 'expired' | 'revoked') ?? 'fresh',
      redeemedAtMs,
      createdByEmail: String(x.createdByEmail ?? ''),
      createdAtMs,
      emailSent: x.emailSent === true,
      emailError: (x.emailError as string | null) ?? null,
    };
  });

  return NextResponse.json({ codes: rows });
}

// ── POST: generate + send a code ─────────────────────────────────────

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db, ctx } = r;

  let body: {
    familyId?: string;
    requestId?: string;
    tierId?: SubscriptionTierId;
    addons?: string[];
    expiry?: ExpiryPreset;
    recipientEmail?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const familyId = String(body.familyId ?? '');
  if (!familyId) return NextResponse.json({ error: 'no-family-id' }, { status: 400 });
  if (!body.tierId || !TIER_IDS.has(body.tierId)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });
  if (!body.expiry || !VALID_EXPIRY.has(body.expiry)) return NextResponse.json({ error: 'bad-expiry' }, { status: 400 });

  const addons = Array.isArray(body.addons)
    ? body.addons.filter((a) => typeof a === 'string' && VALID_ADDON_IDS.has(a))
    : [];

  // Look up family + decide recipient.
  const famSnap = await db.collection('families').doc(familyId).get();
  if (!famSnap.exists) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
  const fam = famSnap.data() as { name?: string; handle?: string };

  // Recipient email: prefer the body override, else the request's email,
  // else the requester user doc, else the family creator's email.
  let recipientEmail = (body.recipientEmail ?? '').trim();
  let recipientName = fam.name ?? 'there';
  if (!recipientEmail && body.requestId) {
    const reqSnap = await db.collection('upgradeRequests').doc(body.requestId).get();
    if (reqSnap.exists) {
      const reqData = reqSnap.data() as { requesterEmail?: string; requesterUid?: string };
      recipientEmail = (reqData.requesterEmail ?? '').trim();
      if (!recipientEmail) {
        const resolved = await resolveRecipientEmail(db, familyId, reqData.requesterUid ?? null);
        recipientEmail = resolved.email ?? '';
        recipientName = resolved.name;
      }
    }
  }
  if (!recipientEmail) {
    const resolved = await resolveRecipientEmail(db, familyId, null);
    recipientEmail = resolved.email ?? '';
    recipientName = resolved.name;
  }
  if (!recipientEmail) return NextResponse.json({ error: 'no-recipient-email' }, { status: 400 });

  // Auto-revoke any existing fresh codes for this family — one active at a time.
  const existing = await db.collection('tierCodes')
    .where('familyId', '==', familyId)
    .where('status', '==', 'fresh')
    .get();
  const batch = db.batch();
  for (const doc of existing.docs) {
    batch.update(doc.ref, {
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: ctx.uid,
      revokedReason: 'superseded',
    });
  }

  // Compute expiry.
  const expiryMs = expiryMsFromPreset(body.expiry);
  const expiresAtMs = expiryMs === null ? null : Date.now() + expiryMs;

  // Generate. Collisions astronomically unlikely (30^6 = 729M codes per
  // tier prefix), but loop a few times just in case.
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code = generateTierCode(body.tierId);
    const dup = await db.collection('tierCodes').where('code', '==', code).limit(1).get();
    if (dup.empty) break;
  }

  // Create the doc.
  const codeRef = db.collection('tierCodes').doc();
  batch.set(codeRef, {
    code,
    tierId: body.tierId,
    addons,
    familyId,
    familyName: fam.name ?? '',
    familyHandle: fam.handle ?? null,
    recipientEmail,
    expiresAtMs,
    status: 'fresh',
    redeemedAt: null,
    createdBy: ctx.uid,
    createdByEmail: ctx.email ?? '',
    createdAt: FieldValue.serverTimestamp(),
    emailSent: false,
    emailError: null,
    requestId: body.requestId ?? null,
  });

  // Mark the request as fulfilled (if there is one).
  if (body.requestId) {
    batch.update(db.collection('upgradeRequests').doc(body.requestId), {
      status: 'fulfilled',
      fulfilledCodeId: codeRef.id,
      fulfilledAt: FieldValue.serverTimestamp(),
      fulfilledBy: ctx.uid,
    });
  }

  await batch.commit();

  // Send the email. Done AFTER the batch commit so the doc is durable
  // even if Resend rate-limits or errors. Result is written back to the
  // doc so the admin UI can show "✓ Sent" or "Failed to send".
  const sendResult = await sendCodeEmail({
    to: recipientEmail,
    recipientName,
    code,
    tierId: body.tierId,
    addons,
    expiresAtMs,
  });

  await codeRef.update({
    emailSent: sendResult.sent,
    emailError: sendResult.sent ? null : (sendResult.error ?? 'unknown'),
    emailSentAt: sendResult.sent ? FieldValue.serverTimestamp() : null,
  });

  return NextResponse.json({
    id: codeRef.id,
    emailSent: sendResult.sent,
    emailError: sendResult.error ?? null,
    recipientEmail,
  });
}
