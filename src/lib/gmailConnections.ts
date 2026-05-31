// Gmail connections + subscription suggestions — server-only (Admin SDK).
//
// Two Firestore shapes power the scheduled scan:
//
//   families/{familyId}/gmailConnections/{uid}
//     { refreshTokenEnc, email, scope, status:'active', connectedAt,
//       lastScanAt, lastScanCount }
//     — one per parent who connected their Gmail. The cron iterates these.
//
//   families/{familyId}/subscriptionSuggestions/{autoId}
//     { name, amount, currency, cadence, platform, nextBilling, vendor,
//       source:'gmail', byUid, status:'pending'|'added'|'dismissed',
//       dedupKey, createdAt }
//     — what a scan found, awaiting the parent's confirm. Dismissed docs are
//       kept as tombstones so the same receipt isn't re-suggested forever.
//
// All access is via the Admin SDK, so NO Firestore-rules deploy is needed
// (same pattern as /api/policy/accept). The client reaches these only through
// token-verified API routes.

import { getAdminFirestore } from '@/lib/firebaseAdmin';
import type { ParsedSubDraft } from '@/lib/subscriptionReceiptParse';

export interface GmailConnection {
  familyId: string;
  uid: string;
  refreshTokenEnc: string;
  email: string | null;
  status: string;
  lastScanAtMs: number | null;
}

export interface StoredSuggestion extends ParsedSubDraft {
  id: string;
}

const dedupKeyOf = (name: string, platform: string) => `${name.toLowerCase().trim()}|${platform}`;

/** Store (or refresh) a parent's Gmail connection. */
export async function saveConnection(
  familyId: string, uid: string,
  fields: { refreshTokenEnc: string; email: string | null; scope: string },
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  await db
    .collection('families').doc(familyId)
    .collection('gmailConnections').doc(uid)
    .set({
      refreshTokenEnc: fields.refreshTokenEnc,
      email: fields.email,
      scope: fields.scope,
      status: 'active',
      connectedAt: new Date(),
      // The connect flow does a 12-month scan right after this; baseline the
      // cron at "now" so it only looks at mail that arrives from here on.
      lastScanAt: new Date(),
      lastScanCount: 0,
    }, { merge: true });
}

/** Read one parent's connection (or null). */
export async function getConnection(familyId: string, uid: string): Promise<GmailConnection | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  const snap = await db
    .collection('families').doc(familyId)
    .collection('gmailConnections').doc(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  if (d.status !== 'active') return null;
  return {
    familyId, uid,
    refreshTokenEnc: (d.refreshTokenEnc as string) || '',
    email: (d.email as string) ?? null,
    status: (d.status as string) || 'active',
    lastScanAtMs: d.lastScanAt?.toMillis?.() ?? null,
  };
}

/** Every active connection across all families (cron fan-out). */
export async function listActiveConnections(): Promise<GmailConnection[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  const snap = await db.collectionGroup('gmailConnections').get();
  const out: GmailConnection[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.status !== 'active') continue;
    const familyId = doc.ref.parent.parent?.id;
    if (!familyId) continue;
    out.push({
      familyId, uid: doc.id,
      refreshTokenEnc: (d.refreshTokenEnc as string) || '',
      email: (d.email as string) ?? null,
      status: 'active',
      lastScanAtMs: d.lastScanAt?.toMillis?.() ?? null,
    });
  }
  return out;
}

/** Stamp a scan's outcome onto the connection. */
export async function updateLastScan(familyId: string, uid: string, count: number): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  await db
    .collection('families').doc(familyId)
    .collection('gmailConnections').doc(uid)
    .set({ lastScanAt: new Date(), lastScanCount: count }, { merge: true });
}

/** Remove a parent's connection (after revoking the token at Google). */
export async function deleteConnection(familyId: string, uid: string): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  await db
    .collection('families').doc(familyId)
    .collection('gmailConnections').doc(uid).delete().catch(() => {});
}

/** Write new suggestions for `drafts`, skipping any that duplicate an
 *  existing subscription (by name) or an already-seen suggestion (by
 *  dedupKey, including dismissed tombstones). Returns the count written. */
export async function writeSuggestions(
  familyId: string, byUid: string, drafts: ParsedSubDraft[],
): Promise<number> {
  const db = getAdminFirestore();
  if (!db || drafts.length === 0) return 0;
  const famRef = db.collection('families').doc(familyId);

  // Existing subscription names (lowercased) — don't suggest what's tracked.
  const subNames = new Set<string>();
  try {
    const subs = await famRef.collection('subscriptions').get();
    for (const s of subs.docs) {
      const n = String(s.data()?.name || '').toLowerCase().trim();
      if (n) subNames.add(n);
    }
  } catch { /* if subs unreadable, just rely on suggestion dedup */ }

  // Existing suggestion dedupKeys (any status) — tombstones included.
  const seenKeys = new Set<string>();
  try {
    const existing = await famRef.collection('subscriptionSuggestions').get();
    for (const s of existing.docs) {
      const k = String(s.data()?.dedupKey || '');
      if (k) seenKeys.add(k);
    }
  } catch { /* none yet */ }

  const matchesExistingSub = (name: string) => {
    const n = name.toLowerCase().trim();
    if (subNames.has(n)) return true;
    for (const existing of subNames) {
      if (existing.includes(n) || n.includes(existing)) return true; // light fuzzy
    }
    return false;
  };

  const batch = db.batch();
  let written = 0;
  for (const d of drafts) {
    const key = dedupKeyOf(d.name, d.platform);
    if (seenKeys.has(key) || matchesExistingSub(d.name)) continue;
    seenKeys.add(key); // guard against dup within this same batch
    const ref = famRef.collection('subscriptionSuggestions').doc();
    batch.set(ref, {
      name: d.name, amount: d.amount, currency: d.currency,
      cadence: d.cadence, platform: d.platform,
      nextBilling: d.nextBilling, vendor: d.vendor,
      source: 'gmail', byUid, status: 'pending', dedupKey: key,
      createdAt: new Date(),
    });
    written += 1;
  }
  if (written > 0) await batch.commit();
  return written;
}

/** All pending suggestions for a family (newest first). */
export async function listPendingSuggestions(familyId: string): Promise<StoredSuggestion[]> {
  const db = getAdminFirestore();
  if (!db) return [];
  const snap = await db
    .collection('families').doc(familyId)
    .collection('subscriptionSuggestions')
    .where('status', '==', 'pending')
    .get();
  // Newest first, sorted in memory so no composite index is needed.
  return snap.docs
    .map((doc) => ({ doc, ms: doc.data()?.createdAt?.toMillis?.() ?? 0 }))
    .sort((a, b) => b.ms - a.ms)
    .map(({ doc }) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        name: String(d.name || ''),
        amount: Number(d.amount) || 0,
        currency: String(d.currency || ''),
        cadence: (d.cadence as ParsedSubDraft['cadence']) || 'monthly',
        platform: (d.platform as ParsedSubDraft['platform']) || 'web',
        nextBilling: String(d.nextBilling || ''),
        vendor: String(d.vendor || ''),
      };
    });
}

/** Mark suggestions added (the parent created the sub) or dismissed. */
export async function resolveSuggestions(
  familyId: string, addedIds: string[], dismissedIds: string[],
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;
  const col = db.collection('families').doc(familyId).collection('subscriptionSuggestions');
  const batch = db.batch();
  for (const id of addedIds.slice(0, 50)) batch.set(col.doc(id), { status: 'added', resolvedAt: new Date() }, { merge: true });
  for (const id of dismissedIds.slice(0, 50)) batch.set(col.doc(id), { status: 'dismissed', resolvedAt: new Date() }, { merge: true });
  await batch.commit().catch(() => {});
}
