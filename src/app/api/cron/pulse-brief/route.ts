// Kaya Pulse · Daily morning brief — firing cron. PR 5 / v2.
//
// Runs every 30 minutes; for every user whose pulseBrief.enabled === true
// AND whose local-time-now is in [briefTime, briefTime + 30min), renders the
// brief (low meter balances · all balances · today's allowance · vs-LM ·
// Ask-Kaya nudge · pending approvals — per their includes) and dispatches:
//   • 📧 email via Resend (if 'email' in channels + RESEND_API_KEY set)
//   • 🔔 in-app notification (if 'push' in channels)
// Idempotent — stamps `pulseBrief.lastFiredOn` = today's dayKey so a re-run
// within the same day is a no-op.
//
// Also runs Auto-buddy (Surprise #5): for every family, scans depleting
// meters; when a meter is below threshold AND has helperOfRecord set,
// writes a one-time/day in-app notification to that helper (+ a CC to the
// family's parents). Idempotent via a meter-level `lastAutoBuddyOn` dayKey.
//
// Admin SDK throughout (bypasses rules). Secured by CRON_SECRET when set.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { dayKeyInTZ } from '@/lib/dates';
import {
  type PulseBriefSettings, timeStrToMinutes, withinFiringWindow, formatTime12h,
} from '@/lib/pulseBrief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = 'Africa/Dar_es_Salaam';
const FIRING_WINDOW_MIN = 30;
const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = apiKey ? new Resend(apiKey) : null;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const today = dayKeyInTZ(new Date(), TZ);
  // Local-now minute-of-day in TZ (Africa/Dar). Compute by formatting in TZ.
  const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const nowMin = nowInTz.getHours() * 60 + nowInTz.getMinutes();

  let scanned = 0, due = 0, emailed = 0, pushed = 0, autoBuddies = 0, families = 0;

  // 1) Scan users for due briefs.
  const userSnap = await db.collection('users').get();
  for (const u of userSnap.docs) {
    scanned++;
    const data = u.data() as { uid?: string; familyId?: string; email?: string; displayName?: string; role?: string; pulseBrief?: PulseBriefSettings };
    const brief = data.pulseBrief;
    if (!brief?.enabled) continue;
    if (data.role && data.role !== 'parent') continue;
    if (!data.familyId) continue;
    if (brief.lastFiredOn === today) continue; // already fired today
    const target = timeStrToMinutes(brief.time);
    if (!withinFiringWindow(target, nowMin, FIRING_WINDOW_MIN)) continue;
    due++;

    try {
      const lines = await renderBriefLines(db, data.familyId, brief);
      if (lines.length === 0) continue;

      const subject = `☀️ Good morning${data.displayName ? `, ${data.displayName.split(' ')[0]}` : ''} — your Kaya brief`;

      if (brief.channels.includes('email') && resend && data.email) {
        try {
          await resend.emails.send({
            from: FROM,
            to: [data.email],
            subject,
            html: renderBriefHtml(data.displayName, lines, brief.time),
            text: lines.join('\n'),
          });
          emailed++;
        } catch { /* swallow per-recipient */ }
      }

      if (brief.channels.includes('push')) {
        try {
          const fam = db.collection('families').doc(data.familyId);
          await fam.collection('notifications').add({
            kind: 'pulse_brief',
            to: u.id,
            title: subject,
            body: lines.slice(0, 2).join(' · '),
            href: '/pulse',
            createdAt: FieldValue.serverTimestamp(),
            read: false,
          });
          pushed++;
        } catch { /* swallow */ }
      }

      await u.ref.update({ 'pulseBrief.lastFiredOn': today });
    } catch { /* swallow per-user */ }
  }

  // 2) Auto-buddy pass — once per family per day.
  const famSnap = await db.collection('families').get();
  for (const f of famSnap.docs) {
    families++;
    try {
      autoBuddies += await runAutoBuddyForFamily(db, f.id, today);
    } catch { /* swallow */ }
  }

  return NextResponse.json({ ok: true, today, nowMin, scanned, due, emailed, pushed, families, autoBuddies });
}

export const GET = handle;
export const POST = handle;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

// Admin SDK is loosely-typed here on purpose — the strict types would force
// importing firebase-admin/firestore types and threading them everywhere.
// All access is runtime-safe (try/swallow + null checks) per the reminders cron.
type AdminFs = ReturnType<typeof getAdminFirestore> extends infer T
  ? T extends null ? never : T : never;

async function renderBriefLines(db: AdminFs, familyId: string, brief: PulseBriefSettings): Promise<string[]> {
  const lines: string[] = [];
  const famRef = db.collection('families').doc(familyId);

  if (brief.includes.includes('lowBalances') || brief.includes.includes('allBalances')) {
    const meters = await listDownMetersWithLeft(db, familyId);
    const low = meters.filter((m) => m.daysLeft !== null && m.daysLeft < 2);
    const warn = meters.filter((m) => m.daysLeft !== null && m.daysLeft >= 2 && m.daysLeft < 5);
    if (brief.includes.includes('lowBalances') && low.length > 0) {
      const names = low.slice(0, 3).map((m) => `${m.name} at ${m.daysLeft!.toFixed(1)}d`).join(', ');
      lines.push(`🪫 Low meters: ${names}${low.length > 3 ? ` · +${low.length - 3} more` : ''}.`);
    }
    if (brief.includes.includes('lowBalances') && warn.length > 0 && low.length === 0) {
      lines.push(`⚠ ${warn.length} meter${warn.length === 1 ? '' : 's'} trending low: plan a top-up.`);
    }
    if (brief.includes.includes('allBalances') && meters.length > 0) {
      const summary = meters.slice(0, 4).map((m) => `${m.name} ${Math.max(0, Math.round(m.unitsLeft))}${m.unit ? ' ' + m.unit : ''}`).join(' · ');
      lines.push(`⚡ Balances: ${summary}.`);
    }
  }

  // todayAllowance + vsLastMonth + pendingApprovals + askKaya — light read of
  // family doc + recent purchase requests. Kept short; the cron's job is to
  // get the parent into the app, not replicate the dashboard.
  if (brief.includes.includes('pendingApprovals')) {
    try {
      const reqSnap = await famRef.collection('purchaseRequests').get();
      const pending = reqSnap.docs.filter((d) => {
        const s = (d.data() as { status?: string }).status;
        return s === 'pending_close' || s === 'submitted';
      }).length;
      if (pending > 0) lines.push(`📋 ${pending} purchase request${pending === 1 ? '' : 's'} awaiting your review.`);
    } catch { /* swallow */ }
  }
  if (brief.includes.includes('askKaya')) {
    lines.push('🤖 Tap "Ask Kaya" on the dashboard for today\'s one-thing-to-do.');
  }

  return lines;
}

interface MeterSnap { id: string; name: string; unit: string; unitsLeft: number; daysLeft: number | null; helperOfRecord?: string }

async function listDownMetersWithLeft(db: AdminFs, familyId: string): Promise<MeterSnap[]> {
  const out: MeterSnap[] = [];
  const famRef = db.collection('families').doc(familyId);
  // utility meters
  try {
    const metersSnap = await famRef.collection('utilityMeters').get();
    for (const d of metersSnap.docs) {
      const m = d.data() as { label?: string; unit?: string; direction?: string; balanceUnits?: number; active?: boolean; helperOfRecord?: string };
      if (m.active === false) continue;
      if ((m.direction ?? 'down') !== 'down') continue;
      const unitsLeft = m.balanceUnits ?? 0;
      const daysLeft = unitsLeft > 0 ? estimateDaysLeft(db, familyId, d.id, unitsLeft) : 0;
      out.push({ id: d.id, name: m.label || 'Meter', unit: m.unit ?? '', unitsLeft, daysLeft: await daysLeft, helperOfRecord: m.helperOfRecord });
    }
  } catch { /* swallow */ }
  try {
    const tkSnap = await famRef.collection('trackables').get();
    for (const d of tkSnap.docs) {
      const t = d.data() as { name?: string; unit?: string; direction?: string; balanceUnits?: number; active?: boolean; helperOfRecord?: string };
      if (t.active === false) continue;
      if (t.direction !== 'down') continue;
      const unitsLeft = t.balanceUnits ?? 0;
      const daysLeft = unitsLeft > 0 ? estimateDaysLeft(db, familyId, d.id, unitsLeft) : 0;
      out.push({ id: d.id, name: t.name || 'Trackable', unit: t.unit ?? '', unitsLeft, daysLeft: await daysLeft, helperOfRecord: t.helperOfRecord });
    }
  } catch { /* swallow */ }
  // Sort: low → high days-left
  return out.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
}

async function estimateDaysLeft(db: AdminFs, familyId: string, trackableId: string, unitsLeft: number): Promise<number | null> {
  try {
    const famRef = db.collection('families').doc(familyId);
    const rsnap = await famRef.collection('readings').get();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let burn = 0, days = 0;
    const seen = new Set<string>();
    for (const r of rsnap.docs) {
      const d = r.data() as { trackableId?: string; consumedUnits?: number; dayKey?: string; capturedAt?: { toMillis?: () => number } };
      if (d.trackableId !== trackableId) continue;
      const at = d.capturedAt?.toMillis?.() ?? 0;
      if (at < startOfMonth) continue;
      burn += d.consumedUnits ?? 0;
      if (d.dayKey && !seen.has(d.dayKey)) { seen.add(d.dayKey); days++; }
    }
    if (burn <= 0 || days <= 0) return null;
    const perDay = burn / days;
    return perDay > 0 ? unitsLeft / perDay : null;
  } catch { return null; }
}

async function runAutoBuddyForFamily(db: AdminFs, familyId: string, today: string): Promise<number> {
  let pinged = 0;
  const famRef = db.collection('families').doc(familyId);
  // Walk utilityMeters first.
  try {
    const metersSnap = await famRef.collection('utilityMeters').get();
    for (const d of metersSnap.docs) {
      const m = d.data() as { label?: string; direction?: string; balanceUnits?: number; minUnitsThreshold?: number; helperOfRecord?: string; active?: boolean; lastAutoBuddyOn?: string };
      if (m.active === false) continue;
      if ((m.direction ?? 'down') !== 'down') continue;
      if (m.balanceUnits == null || m.minUnitsThreshold == null) continue;
      if (m.balanceUnits >= m.minUnitsThreshold) continue;
      if (!m.helperOfRecord) continue;
      if (m.lastAutoBuddyOn === today) continue;
      // ping helper + audit
      try {
        await famRef.collection('notifications').add({
          kind: 'pulse_auto_buddy',
          to: m.helperOfRecord,
          title: `🔋 ${m.label || 'Meter'} is running low`,
          body: `Only ${Math.round(m.balanceUnits)} units left — add some when you get a chance?`,
          href: '/pulse',
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
        await d.ref.update({ lastAutoBuddyOn: today });
        pinged++;
      } catch { /* swallow */ }
    }
  } catch { /* swallow */ }
  // Same for trackables.
  try {
    const tkSnap = await famRef.collection('trackables').get();
    for (const d of tkSnap.docs) {
      const t = d.data() as { name?: string; direction?: string; balanceUnits?: number; minUnitsThreshold?: number; helperOfRecord?: string; active?: boolean; lastAutoBuddyOn?: string };
      if (t.active === false) continue;
      if (t.direction !== 'down') continue;
      if (t.balanceUnits == null || t.minUnitsThreshold == null) continue;
      if (t.balanceUnits >= t.minUnitsThreshold) continue;
      if (!t.helperOfRecord) continue;
      if (t.lastAutoBuddyOn === today) continue;
      try {
        await famRef.collection('notifications').add({
          kind: 'pulse_auto_buddy',
          to: t.helperOfRecord,
          title: `🔋 ${t.name || 'Trackable'} is running low`,
          body: `Only ${Math.round(t.balanceUnits)} units left — add some when you get a chance?`,
          href: '/pulse',
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
        await d.ref.update({ lastAutoBuddyOn: today });
        pinged++;
      } catch { /* swallow */ }
    }
  } catch { /* swallow */ }
  return pinged;
}

function renderBriefHtml(name: string | undefined, lines: string[], time: string): string {
  const greeting = `Good morning${name ? ', ' + esc(name.split(' ')[0]) : ''}`;
  const items = lines.map((l) => `<p style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:14px;color:#0F1F44;line-height:1.5;margin:0 0 8px;">${esc(l)}</p>`).join('');
  return `<!doctype html>
<html><body style="margin:0;background:#FBF7EC;padding:20px;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;padding:20px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <div style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:11px;font-weight:900;letter-spacing:1.4px;color:#B58A2F;text-transform:uppercase;margin-bottom:6px;">📬 Kaya Pulse · ${esc(formatTime12h(time))}</div>
    <h1 style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:20px;font-weight:900;color:#0F1F44;margin:0 0 14px;letter-spacing:-0.2px;">☀️ ${greeting}</h1>
    ${items}
    <a href="${APP_URL}/pulse" style="display:inline-block;margin-top:12px;background:#D4A847;color:#0F1F44;font-family:Nunito,Helvetica,Arial,sans-serif;font-weight:900;font-size:13px;padding:10px 18px;border-radius:10px;text-decoration:none;">Open Kaya Pulse →</a>
    <p style="font-family:Nunito,Helvetica,Arial,sans-serif;font-size:11px;color:#9aa3ad;margin:18px 0 0;">You set this brief in Kaya Pulse → Metered → Morning brief. Change anytime.</p>
  </div>
</body></html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
