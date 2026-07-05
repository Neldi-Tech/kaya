// 🔔 Low-balance engine — SERVER side (HHR PR1, approved design 2026-07-05).
//
// The original engine (lib/autoTopup.ts) is complete but client-side: it only
// runs when a parent happens to open the Utility page — which is exactly why
// no emails/auto-requests ever reached the family (Logic Test F1–F4). This is
// the Admin-SDK port, fired from where the events actually happen:
//   • every logged reading (lib/pulseLogApply.server — covers direct logs AND
//     helper-assist approvals), and
//   • the hourly pulse-scan cron, as the backstop when nobody logs (Scene 4).
//
// Trigger (D2): balance BELOW the threshold, OR forecast ≤ N days left
// (default 3; from the meter's recent average daily use).
// Episode (D4): one alert per breach — `lowAlertAt` stamps the episode and
// clears when the balance recovers above the threshold (top-up done), which
// also clears the auto-request guard `autoTopUpPendingRequestId`.
// Actions (D3, this PR): 🤖 create the pending-approval top-up request (when
// the meter's autoTopUp master switch is on) + in-app notifications to all
// parents and the helper-of-record. Email + family-chat land in PR2 on the
// same seam. Money-safe: requests are ALWAYS pending approval.
//
// The request document mirrors lib/purchase.ts createDraftRequest exactly
// (same counter doc, same `UTL-0042 · DDMMYY · context` naming) so the
// Utilities UI treats auto-requests like any other.

import { FieldValue } from 'firebase-admin/firestore';

type AdminDb = FirebaseFirestore.Firestore;
type FamRef = FirebaseFirestore.DocumentReference;

interface MeterData {
  label?: string;
  unit?: string;
  type?: string;
  active?: boolean;
  direction?: 'up' | 'down';
  minUnitsThreshold?: number;
  lowForecastDays?: number;
  lowAlertAt?: number;
  autoTopUp?: boolean;
  autoTopUpSource?: 'last' | 'fixed';
  autoTopUpAmountCents?: number;
  autoTopUpAlert?: boolean;
  autoTopUpPendingRequestId?: string;
  helperOfRecord?: string;
  estimatedCents?: number;
  providerRef?: string;
}

export interface LowBalanceResult {
  fired: boolean;
  recovered: boolean;
  requestId?: string;
}

const meterDirection = (m: MeterData): 'up' | 'down' =>
  m.direction ?? (m.type === 'water' ? 'up' : 'down');

function fmtAmount(cents: number, currency: string): string {
  const major = Math.round(cents / 100).toLocaleString('en-US');
  return `${currency} ${major}`;
}

/** Mirror of purchase.ts nextRequestSeq — same counter doc, Admin transaction. */
async function nextUtilitySeq(db: AdminDb, famRef: FamRef): Promise<number> {
  const counterRef = famRef.collection('counters').doc('purchaseRequests-utility');
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists ? Number((snap.data() as { nextSeq?: number }).nextSeq ?? 0) : 0;
      const next = current + 1;
      if (snap.exists) tx.update(counterRef, { nextSeq: next, updatedAt: FieldValue.serverTimestamp() });
      else tx.set(counterRef, { nextSeq: next, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return next;
    });
  } catch { return 0; }
}

/** Mirror of purchase.ts auto-naming: `UTL-0042 · DDMMYY · {label} top-up`. */
function autoName(seq: number, context: string): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const serial = `UTL-${String(seq).padStart(4, '0')}`;
  return [serial, `${dd}${mm}${yy}`, context].filter(Boolean).join(' · ');
}

/** Most recent top-up amount for this meter (module-only query — no
 *  composite index — then in-memory sort, same as the client engine). */
async function lastAmountForMeter(famRef: FamRef, meterId: string): Promise<number | null> {
  try {
    const snap = await famRef.collection('purchaseRequests').where('module', '==', 'utility').get();
    const rows = snap.docs
      .map((d) => d.data() as { meterId?: string; actualTotalCents?: number; estimatedTotalCents?: number; createdAt?: FirebaseFirestore.Timestamp })
      .filter((r) => r.meterId === meterId)
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    for (const r of rows) {
      const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      if (cents > 0) return cents;
    }
  } catch { /* fall through */ }
  return null;
}

function resolveAmountCents(m: MeterData, lastCents: number | null): number {
  if (m.autoTopUpSource === 'fixed') return m.autoTopUpAmountCents || m.estimatedCents || 0;
  return lastCents ?? m.autoTopUpAmountCents ?? m.estimatedCents ?? 0;
}

async function parentUids(db: AdminDb, familyId: string): Promise<string[]> {
  const snap = await db.collection('users')
    .where('familyId', '==', familyId).where('role', '==', 'parent').get();
  return snap.docs.map((d) => d.id);
}

async function notifyInApp(famRef: FamRef, forUserId: string, title: string, message: string, link: string) {
  await famRef.collection('notifications').add({
    type: 'utility-low', title, message, read: false, forUserId, link, createdAt: new Date(),
  }).catch(() => {});
}

/** The core check for ONE meter. `balance` = latest reading value (units left
 *  on a 'down' meter). `avgDaily` = recent average consumption per reading
 *  (readings are daily tasks, so ≈ per day) — powers the days-left forecast. */
export async function checkMeterLowBalance(
  db: AdminDb,
  familyId: string,
  meterId: string,
  input: { balance: number; avgDaily?: number; currency?: string; appUrl?: string },
): Promise<LowBalanceResult> {
  const famRef = db.collection('families').doc(familyId);
  const mSnap = await famRef.collection('utilityMeters').doc(meterId).get();
  if (!mSnap.exists) return { fired: false, recovered: false };
  const m = mSnap.data() as MeterData;

  const threshold = m.minUnitsThreshold ?? 0;
  if (m.active === false || meterDirection(m) !== 'down' || threshold <= 0) {
    return { fired: false, recovered: false }; // unprotected meter — PR4 nudges to set it
  }

  const bal = input.balance;
  const avgDaily = input.avgDaily ?? 0;
  const daysLeft = avgDaily > 0 ? bal / avgDaily : null;
  const forecastDays = m.lowForecastDays ?? 3;
  const low = bal < threshold || (daysLeft !== null && daysLeft <= forecastDays);

  // ── Recovery: back above the line → close the episode, re-arm. ──────
  if (!low) {
    if (m.lowAlertAt || m.autoTopUpPendingRequestId) {
      await mSnap.ref.update({
        lowAlertAt: FieldValue.delete(),
        lowAlertBalance: FieldValue.delete(),
        autoTopUpPendingRequestId: FieldValue.delete(),
      }).catch(() => {});
      return { fired: false, recovered: true };
    }
    return { fired: false, recovered: false };
  }

  // ── Already alerted this episode → stay quiet (Scene 3, no spam). ───
  if (m.lowAlertAt) return { fired: false, recovered: false };

  const label = m.label || 'Utility meter';
  const unit = m.unit ? ` ${m.unit}` : '';
  const daysBit = daysLeft !== null && Number.isFinite(daysLeft)
    ? ` (~${Math.max(0, daysLeft).toFixed(1)} day${daysLeft === 1 ? '' : 's'} left)`
    : '';

  // ── 🤖 Auto-request (master switch on + none outstanding). ──────────
  let requestId: string | undefined;
  let amountCents = 0;
  if (m.autoTopUp && !m.autoTopUpPendingRequestId) {
    amountCents = resolveAmountCents(m, await lastAmountForMeter(famRef, meterId));
    if (amountCents > 0) {
      try {
        const parents = await parentUids(db, familyId);
        const seq = await nextUtilitySeq(db, famRef);
        const name = autoName(seq, `${label} top-up`);
        const item = {
          id: `${Date.now().toString(36)}-topup`, name: `${label} top-up`,
          category: 'other', qty: 1, unit: 'x', estimatedCents: amountCents,
        };
        const reqRef = await famRef.collection('purchaseRequests').add({
          name,
          ...(seq > 0 ? { seq } : {}),
          status: 'pending_approval',
          module: 'utility',
          items: [item],
          estimatedTotalCents: amountCents,
          createdAt: FieldValue.serverTimestamp(),
          sentAt: FieldValue.serverTimestamp(),
          createdBy: parents[0] || 'kaya-auto',
          createdByRole: 'parent',
          generatedBy: 'system',
          meterId,
        });
        requestId = reqRef.id;
        await mSnap.ref.update({ autoTopUpPendingRequestId: requestId }).catch(() => {});
      } catch { /* request is best-effort — the alert below still fires */ }
    }
  }

  // ── 🔔 In-app notifications — parents + helper-of-record. ───────────
  if (m.autoTopUpAlert !== false) {
    const currency = input.currency || 'TZS';
    const title = `🔔 ${label} is running low`;
    const message = requestId
      ? `${Math.round(bal)}${unit} left${daysBit}. Kaya has requested a ${fmtAmount(amountCents, currency)} top-up — approve it in Utilities.`
      : `${Math.round(bal)}${unit} left${daysBit}. Time to plan a top-up.`;
    const link = requestId ? `/pantry/purchase/${requestId}` : '/pantry/utility';
    try {
      const parents = await parentUids(db, familyId);
      for (const uid of parents) await notifyInApp(famRef, uid, title, message, link);
      if (m.helperOfRecord && !parents.includes(m.helperOfRecord)) {
        await notifyInApp(famRef, m.helperOfRecord, title, message, link);
      }
    } catch { /* best-effort */ }
  }

  // ── Stamp the episode. ───────────────────────────────────────────────
  await mSnap.ref.update({ lowAlertAt: Date.now(), lowAlertBalance: bal }).catch(() => {});
  return { fired: true, recovered: false, requestId };
}

export interface SweepResult { checked: number; fired: number; recovered: number; requests: number }

/** Hourly backstop — every protected 'down' meter, from its LATEST reading,
 *  even when nobody logged today (forecast still counts down). */
export async function runAutoTopupSweep(db: AdminDb, famRef: FamRef): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, fired: 0, recovered: 0, requests: 0 };
  const meters = await famRef.collection('utilityMeters').get();
  for (const mDoc of meters.docs) {
    const m = mDoc.data() as MeterData;
    if (m.active === false || meterDirection(m) !== 'down' || (m.minUnitsThreshold ?? 0) <= 0) continue;
    try {
      const rs = await famRef.collection('readings').where('trackableId', '==', mDoc.id).get();
      const recent = rs.docs
        .map((d) => d.data() as { value?: number; consumedUnits?: number; event?: string; capturedAt?: FirebaseFirestore.Timestamp })
        .sort((a, b) => (b.capturedAt?.toMillis?.() ?? 0) - (a.capturedAt?.toMillis?.() ?? 0));
      const latest = recent[0];
      if (!latest || !Number.isFinite(Number(latest.value))) continue;
      const normals = recent.filter((r) => (r.event ?? 'normal') === 'normal').slice(0, 7)
        .map((r) => Number(r.consumedUnits ?? 0)).filter((n) => n > 0);
      const avgDaily = normals.length ? normals.reduce((s, n) => s + n, 0) / normals.length : 0;
      out.checked += 1;
      const res = await checkMeterLowBalance(db, famRef.id, mDoc.id, { balance: Number(latest.value), avgDaily });
      if (res.fired) out.fired += 1;
      if (res.recovered) out.recovered += 1;
      if (res.requestId) out.requests += 1;
    } catch { /* best-effort per meter */ }
  }
  return out;
}
