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
import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = resendKey ? new Resend(resendKey) : null;

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
  alertChannels?: { email?: boolean; inapp?: boolean; chat?: boolean; whatsapp?: boolean };
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

async function parentRecipients(db: AdminDb, familyId: string): Promise<{ uids: string[]; emails: string[] }> {
  const snap = await db.collection('users')
    .where('familyId', '==', familyId).where('role', '==', 'parent').get();
  const uids: string[] = [];
  const emails: string[] = [];
  snap.docs.forEach((d) => {
    uids.push(d.id);
    const e = (d.data() as { email?: string }).email;
    if (e) emails.push(e);
  });
  return { uids, emails: Array.from(new Set(emails)) };
}

function esc(s2: string): string {
  return s2.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HHR PR2 — the low-balance email (parents). Same Resend pipe as the rest
 *  of Kaya; one email per episode (the caller already dedupes). */
async function sendLowBalanceEmail(args: {
  emails: string[]; label: string; balanceLine: string;
  requestLine?: string; ctaUrl: string; ctaLabel: string;
}) {
  if (!resend || args.emails.length === 0) return;
  const html = `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:24px 18px;color:#fff;background:linear-gradient(135deg,#1E2A44,#2C3E60)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#E8B54A">🔔 Kaya · Utilities</div>
      <div style="font-size:19px;font-weight:900;margin-top:6px">${esc(args.label)} is running low</div>
      <div style="font-size:13px;opacity:.92;margin-top:4px">${esc(args.balanceLine)}</div>
    </div>
    ${args.requestLine ? `<p style="font-size:14px;color:#26303B;margin-top:16px">${esc(args.requestLine)}</p>` : ''}
    <div style="text-align:center;margin-top:18px">
      <a href="${args.ctaUrl}" style="display:inline-block;background:#E0A93C;color:#3a2a08;font-weight:800;font-size:14px;border-radius:999px;padding:11px 24px;text-decoration:none">${esc(args.ctaLabel)}</a>
      <div style="font-size:11.5px;color:#5C6975;margin-top:12px">One alert per low episode — Kaya re-arms after the top-up.</div>
    </div>
  </div>`;
  await resend.emails.send({
    from: RESEND_FROM, to: args.emails,
    subject: `🔔 ${args.label} is running low`,
    html,
  }).catch(() => {});
}

/** HHR PR2 — the family-chat message, spoken by Kaya (same pattern as the
 *  birthday kickoff + meeting-milestone posts). */
async function postChatMessage(famRef: FamRef, text: string) {
  const threadRef = famRef.collection('threads').doc('group');
  if (!(await threadRef.get()).exists) return;
  await threadRef.collection('messages').add({
    senderUid: 'kaya', senderName: 'Kaya 🔔', text, createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
  await threadRef.update({
    lastText: text, lastSenderUid: 'kaya',
    lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
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
        const { uids: parents } = await parentRecipients(db, familyId);
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

  // ── 🔔 The voice (HHR PR2) — email + in-app + family chat, per the
  // meter's channel toggles (absent = ALL on). WhatsApp is a staged slot
  // that lights up with the Neldi integration. One episode = one voice.
  if (m.autoTopUpAlert !== false) {
    const currency = input.currency || 'TZS';
    const ch = m.alertChannels || {};
    const title = `🔔 ${label} is running low`;
    const balanceLine = `${Math.round(bal)}${unit} left${daysBit}`;
    const message = requestId
      ? `${balanceLine}. Kaya has requested a ${fmtAmount(amountCents, currency)} top-up — approve it in Utilities.`
      : `${balanceLine}. Time to plan a top-up.`;
    const link = requestId ? `/pantry/purchase/${requestId}` : '/pantry/utility';
    try {
      const { uids: parents, emails } = await parentRecipients(db, familyId);
      if (ch.inapp !== false) {
        for (const uid of parents) await notifyInApp(famRef, uid, title, message, link);
        if (m.helperOfRecord && !parents.includes(m.helperOfRecord)) {
          await notifyInApp(famRef, m.helperOfRecord, title, message, link);
        }
      }
      if (ch.email !== false) {
        await sendLowBalanceEmail({
          emails,
          label,
          balanceLine,
          requestLine: requestId
            ? `Kaya has already created a ${fmtAmount(amountCents, currency)} top-up request — it's waiting for a parent's approval.`
            : undefined,
          ctaUrl: `${APP_URL}${link}`,
          ctaLabel: requestId ? 'Approve the top-up →' : 'Open Utilities →',
        });
      }
      if (ch.chat !== false) {
        await postChatMessage(famRef,
          requestId
            ? `🔔 ${label} is at ${Math.round(bal)}${unit}${daysBit}. I've asked for a ${fmtAmount(amountCents, currency)} top-up — a parent can approve it in Utilities 🙏`
            : `🔔 ${label} is at ${Math.round(bal)}${unit}${daysBit}. Time to plan a top-up 🙏`,
        );
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
