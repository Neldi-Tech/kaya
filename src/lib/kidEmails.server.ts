// 📬 Kids' Email Updates — SERVER resolution (KID PR1).
//
// The prefs store a POINTER (kid-profile / parent / contact); this resolves
// the live address at send time (F9). The senders themselves land with
// their features: 🏅 reward emails (KID PR2), 🌞 morning digest (KID PR3) —
// both call resolveKidEmailAddress and log to the 📜 alertLog.

import type { KidEmailPrefs } from './kidEmails.shared';

type AdminDb = FirebaseFirestore.Firestore;

interface FamilyDataSlice {
  kidEmailUpdates?: Record<string, KidEmailPrefs>;
  externalContacts?: { id: string; name: string; email: string }[];
}

export interface ResolvedKidEmail {
  email: string;
  /** Where it resolved from — logged for the parent-facing trace. */
  sourceLabel: 'kid profile' | 'parent' | 'approved contact';
}

/** Resolve the live address for one kid, or null when the pointer is unset,
 *  dangling (contact removed, parent left) or the target has no email —
 *  in every null case NOTHING sends, silently (D1: default-off posture). */
export async function resolveKidEmailAddress(
  db: AdminDb,
  familyId: string,
  childId: string,
  famData: FamilyDataSlice | undefined,
): Promise<ResolvedKidEmail | null> {
  const source = famData?.kidEmailUpdates?.[childId]?.source;
  if (!source) return null;
  try {
    if (source.type === 'kid') {
      const kid = await db.collection('families').doc(familyId)
        .collection('children').doc(childId).get();
      const email = (kid.data() as { email?: string } | undefined)?.email;
      return email ? { email, sourceLabel: 'kid profile' } : null;
    }
    if (source.type === 'parent') {
      const user = await db.collection('users').doc(source.uid).get();
      const u = user.data() as { email?: string; familyId?: string; role?: string } | undefined;
      // The pointer must still be a parent OF THIS family — a departed or
      // re-roled account silently stops receiving (same safety posture as
      // the alert-emails resolver).
      if (!u?.email || u.familyId !== familyId || u.role !== 'parent') return null;
      return { email: u.email, sourceLabel: 'parent' };
    }
    const c = (famData?.externalContacts ?? []).find((x) => x.id === source.id);
    return c?.email ? { email: c.email, sourceLabel: 'approved contact' } : null;
  } catch {
    return null; // resolution is best-effort — never throws into a sender
  }
}

// ═══ 🏅 Reward emails (KID PR2) ═══════════════════════════════════════════
//
// One sender for every reward source — awards (giveAward pings the
// /api/kids/reward-email route) and server-side task approvals (the
// workplan proof-review route calls sendKidRewardEmail directly). All
// best-effort: a failed email never touches the reward itself (D4).
// Every send writes a kind:'kid_reward' entry to the 📜 alertLog with the
// facts + template version, so parents can read it as sent (D5/F9).

import { Resend } from 'resend';

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = resendKey ? new Resend(resendKey) : null;

/** Bump together with renderKidRewardEmail's markup AND the KidRewardTab
 *  renderer in /pantry/utility-meters/alerts (F9 discipline). */
export const KID_REWARD_TEMPLATE_VERSION = 1;

export interface KidRewardFacts {
  kidName: string;
  emoji: string;      // 🏅 / 💎 / 👏
  headline: string;   // "+15 House Points!" / "Kudos!"
  detail: string;     // "Clean your room — from Dad"
  balance?: number;   // HP after the reward
  streak?: number;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderKidRewardEmail(f: KidRewardFacts): string {
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;padding:14px">
    <div style="border-radius:18px;overflow:hidden;border:1px solid #EFE4CC">
      <div style="background:linear-gradient(135deg,#F0A32A,#E58A1F);padding:22px 16px;color:#fff;text-align:center">
        <div style="font-size:40px;line-height:1">${esc(f.emoji)}</div>
        <div style="font-size:22px;font-weight:900;margin-top:6px">${esc(f.headline)}</div>
        <div style="font-size:13px;font-weight:800;opacity:.95;margin-top:3px">${esc(f.detail)}</div>
      </div>
      <div style="padding:16px;text-align:center;background:#fff">
        ${f.balance != null ? `
        <div style="font-size:12px;color:#5C6975;font-weight:700">Your balance</div>
        <div style="font-size:28px;font-weight:900;color:#1F2A44">${f.balance.toLocaleString('en-US')} HP</div>` : ''}
        ${f.streak && f.streak > 1 ? `<div style="font-size:12px;color:#2E7D4F;font-weight:800;margin-top:3px">🔥 ${f.streak}-day streak — keep it going!</div>` : ''}
        <a href="${APP_URL}/my-day" style="display:inline-block;background:#F0A32A;color:#3a2a08;font-weight:900;font-size:13px;border-radius:999px;padding:10px 26px;text-decoration:none;margin-top:12px">See my day →</a>
      </div>
      <div style="padding:9px 12px;font-size:10px;color:#8A8471;background:#FFFDF7;border-top:1px solid #EFE4CC">
        Sent because your parent switched on Reward emails · parents manage this in Household Setup.
      </div>
    </div>
  </div>`;
}

async function writeKidAlertLog(db: AdminDb, familyId: string, entry: Record<string, unknown>) {
  try {
    await db.collection('families').doc(familyId).collection('alertLog').add(entry);
  } catch { /* logging never blocks the reward */ }
}

/** Send one reward email to a kid IF the parent armed the stream. Silent
 *  no-op on: stream off, no/dangling address pointer, Resend missing. */
export async function sendKidRewardEmail(
  db: AdminDb,
  familyId: string,
  childId: string,
  reward: { emoji: string; headline: string; detail: string },
): Promise<void> {
  try {
    const famData = (await db.collection('families').doc(familyId).get()).data() as
      (FamilyDataSlice & Record<string, unknown>) | undefined;
    const prefs = famData?.kidEmailUpdates?.[childId];
    if (!prefs?.rewards) return;
    const resolved = await resolveKidEmailAddress(db, familyId, childId, famData);
    if (!resolved) return;

    const kid = (await db.collection('families').doc(familyId)
      .collection('children').doc(childId).get()).data() as
      { name?: string; totalPoints?: number; streak?: number } | undefined;
    const facts: KidRewardFacts = {
      kidName: kid?.name || 'you',
      emoji: reward.emoji,
      headline: reward.headline,
      detail: reward.detail,
      ...(kid?.totalPoints != null ? { balance: kid.totalPoints } : {}),
      ...(kid?.streak ? { streak: kid.streak } : {}),
    };
    const subject = `${reward.emoji} ${reward.headline} — ${reward.detail}`.slice(0, 140);

    let sent = false; let error: string | undefined;
    if (!resend) { error = 'resend-not-configured'; }
    else {
      try {
        await resend.emails.send({
          from: RESEND_FROM, to: [resolved.email], subject,
          html: renderKidRewardEmail(facts),
        });
        sent = true;
      } catch (e) { error = e instanceof Error ? e.message : 'send-failed'; }
    }

    await writeKidAlertLog(db, familyId, {
      kind: 'kid_reward',
      childId, childName: kid?.name || 'Kid',
      firedAt: Date.now(),
      trigger: 'reward',
      sourceLabel: resolved.sourceLabel,
      channels: {
        email: {
          on: true, sent,
          ...(error ? { error } : {}),
          to: [{ name: kid?.name || 'Kid', email: resolved.email }],
          subject,
          templateVersion: KID_REWARD_TEMPLATE_VERSION,
          kidFacts: facts,
        },
      },
    });
  } catch { /* never throws into a reward flow */ }
}

// ═══ 🌞 Morning routine digest (KID PR3) ═══════════════════════════════════
//
// One email per kid per local day at the parent-set time (default 06:30),
// fired from the hourly pulse-scan cron. Same TZ constant the reminders +
// birthdays engines use for the closed beta — when a per-family timezone
// lands, all three engines adopt it together. Dedupe: lastDigestDayKey on
// the kid's prefs; stamped once an attempt was made (one digest per day,
// success or honestly-logged failure).

/** Bump together with renderKidDigestEmail AND the digest view in
 *  /pantry/utility-meters/alerts (F9 discipline). */
export const KID_DIGEST_TEMPLATE_VERSION = 1;

export interface KidDigestFacts {
  kidName: string;
  dateLabel: string;                                    // "Sunday · 06-Jul-2026"
  tasks: { icon: string; label: string; points?: number }[];
  yesterdayPoints: number;
  balance: number;
  streak: number;
}

function renderKidDigestEmail(f: KidDigestFacts): string {
  const taskRows = f.tasks.length > 0
    ? f.tasks.map((t) => `
      <div style="display:flex;align-items:center;gap:8px;border:1px solid #EFE4CC;border-radius:12px;padding:9px 11px;margin:6px 14px">
        <span style="font-size:16px">${esc(t.icon || '✅')}</span>
        <span style="font-weight:800;font-size:13px;color:#1F2A44;flex:1">${esc(t.label)}</span>
        ${t.points ? `<span style="font-size:11px;font-weight:900;color:#C77E0A">+${t.points} HP</span>` : ''}
      </div>`).join('')
    : `<div style="text-align:center;padding:14px;font-size:13px;color:#5C6975;font-weight:700">No tasks today — free day! 🎈</div>`;
  const stat = (label: string, value: string, color: string) => `
    <div style="flex:1;background:#FBF4E4;border-radius:10px;padding:8px;text-align:center">
      <div style="font-size:10px;color:#8A8471;font-weight:800">${label}</div>
      <div style="font-size:16px;font-weight:900;color:${color}">${value}</div>
    </div>`;
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;padding:14px">
    <div style="border-radius:18px;overflow:hidden;border:1px solid #EFE4CC;background:#fff">
      <div style="background:linear-gradient(135deg,#1F2A44,#2E3D5C);padding:16px;color:#fff">
        <div style="font-size:16px;font-weight:900">🌞 Good morning, ${esc(f.kidName)}!</div>
        <div style="font-size:12px;opacity:.9;margin-top:2px">${esc(f.dateLabel)} · here's your day 👇</div>
      </div>
      ${taskRows}
      <div style="display:flex;gap:8px;margin:12px 14px">
        ${stat('YESTERDAY', `+${f.yesterdayPoints} HP`, '#C77E0A')}
        ${stat('BALANCE', `${f.balance.toLocaleString('en-US')} HP`, '#1F2A44')}
        ${stat('STREAK', f.streak > 0 ? `🔥 ${f.streak}` : '—', '#2E7D4F')}
      </div>
      <div style="text-align:center;padding:0 14px 14px">
        <a href="${APP_URL}/my-day" style="display:inline-block;background:#F0A32A;color:#3a2a08;font-weight:900;font-size:13px;border-radius:999px;padding:10px 26px;text-decoration:none">Open my day →</a>
      </div>
      <div style="padding:9px 12px;font-size:10px;color:#8A8471;background:#FFFDF7;border-top:1px solid #EFE4CC">
        Sent daily at your family's chosen time · parents manage this in Household Setup.
      </div>
    </div>
  </div>`;
}

/** Build + send one kid's morning digest. Returns true when an attempt was
 *  made (the caller stamps lastDigestDayKey); false when the stream is off
 *  or the address pointer doesn't resolve (retrying costs nothing). */
export async function sendKidMorningDigest(
  db: AdminDb,
  familyId: string,
  childId: string,
  famData: FamilyDataSlice | undefined,
  ctx: { todayKey: string; yesterdayKey: string; dowKey: string; dateLabel: string; tz: string },
): Promise<boolean> {
  try {
    const prefs = famData?.kidEmailUpdates?.[childId];
    if (!prefs?.digest) return false;
    const resolved = await resolveKidEmailAddress(db, familyId, childId, famData);
    if (!resolved) return false;

    const famRef = db.collection('families').doc(familyId);
    const childSnap = await famRef.collection('children').doc(childId).get();
    if (!childSnap.exists) return false;
    const kid = childSnap.data() as { name?: string; totalPoints?: number; streak?: number };

    // Today's plan — recurring items on this weekday + adhoc items dated
    // today, skipping paused ones (a pause is never a miss, and never noise).
    const itemsSnap = await childSnap.ref.collection('workplanItems').get();
    const tasks = itemsSnap.docs
      .map((d) => d.data() as {
        label?: string; icon?: string; active?: boolean; pointsValue?: number;
        daysOfWeek?: string[]; kind?: string; scheduledDates?: string[];
        timeLocal?: string; pause?: { from?: string; to?: string };
      })
      .filter((t) => {
        if (t.active === false) return false;
        const p = t.pause;
        if (p?.from && p.from <= ctx.todayKey && (!p.to || ctx.todayKey <= p.to)) return false;
        if (t.kind === 'adhoc') return (t.scheduledDates ?? []).includes(ctx.todayKey);
        return (t.daysOfWeek ?? []).includes(ctx.dowKey);
      })
      .sort((a, b) => (a.timeLocal ?? '99:99').localeCompare(b.timeLocal ?? '99:99'))
      .map((t) => ({
        icon: t.icon || '✅',
        label: t.label || 'Task',
        ...(t.pointsValue && t.pointsValue > 0 ? { points: t.pointsValue } : {}),
      }));

    // Yesterday's earned points — positive award points dated yesterday
    // in the family's local day (module-only query, in-memory filter).
    let yesterdayPoints = 0;
    try {
      const awardsSnap = await famRef.collection('awards').where('childId', '==', childId).get();
      awardsSnap.docs.forEach((d) => {
        const a = d.data() as { points?: number; createdAt?: FirebaseFirestore.Timestamp };
        const at = a.createdAt?.toDate?.();
        if (!at || !a.points || a.points <= 0) return;
        const key = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
        if (key === ctx.yesterdayKey) yesterdayPoints += a.points;
      });
    } catch { /* stat is best-effort — digest still goes */ }

    const facts: KidDigestFacts = {
      kidName: kid.name || 'you',
      dateLabel: ctx.dateLabel,
      tasks,
      yesterdayPoints,
      balance: kid.totalPoints ?? 0,
      streak: kid.streak ?? 0,
    };
    const subject = `🌞 Good morning ${facts.kidName} — ${tasks.length === 0 ? 'free day!' : `${tasks.length} thing${tasks.length === 1 ? '' : 's'} today!`}`;

    let sent = false; let error: string | undefined;
    if (!resend) { error = 'resend-not-configured'; }
    else {
      try {
        await resend.emails.send({
          from: RESEND_FROM, to: [resolved.email], subject,
          html: renderKidDigestEmail(facts),
        });
        sent = true;
      } catch (e) { error = e instanceof Error ? e.message : 'send-failed'; }
    }

    await writeKidAlertLog(db, familyId, {
      kind: 'kid_digest',
      childId, childName: kid.name || 'Kid',
      firedAt: Date.now(),
      trigger: 'digest',
      sourceLabel: resolved.sourceLabel,
      channels: {
        email: {
          on: true, sent,
          ...(error ? { error } : {}),
          to: [{ name: kid.name || 'Kid', email: resolved.email }],
          subject,
          templateVersion: KID_DIGEST_TEMPLATE_VERSION,
          kidDigestFacts: facts,
        },
      },
    });
    return true;
  } catch {
    return false; // never throws into the cron
  }
}

// ═══ 📬 Hive Statement Mail (HIVE PR4) ═════════════════════════════════════
//
// The period's whole story — Money · Hive activity · Business · Points ·
// Behavior (growth voice, F9) — emailed to the kid with parents ALWAYS
// CC'd, plus any approved contacts / parent-added extra addresses the
// family selected (Elia's extended-CC addition). Weekly (chosen day) or
// monthly (the 1st), at the family's chosen time window. Fired from the
// hourly pulse-scan cron; one send per scheduled day via lastStatementKey.

/** Bump together with renderKidStatementEmail AND the alerts-page renderer
 *  (the log stores facts + this version — F9 discipline). */
export const KID_STATEMENT_TEMPLATE_VERSION = 1;

interface StatementData {
  kidName: string;
  periodLabel: string;                     // "13–19 Jul" / "June"
  balances: { hp: number; coins: number; potCents: number; cashCents: number };
  moneyDeltaCents: number;                 // Pot+Cash net change over the period
  hpEarned: number;
  salesCount: number;
  salesCents: number;
  kudos: number;
  improvements: number;
  currency: string;
}

function renderKidStatementEmail(d: StatementData): string {
  const money = (c: number) => `${d.currency} ${Math.round(c / 100).toLocaleString('en-US')}`;
  const delta = d.moneyDeltaCents;
  const deltaLine = delta === 0 ? 'steady this period'
    : `${delta > 0 ? '▲ +' : '▼ −'}${money(Math.abs(delta))} this period`;
  const row = (icon: string, title: string, sub: string, right: string) => `
    <div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid #F0EAD9;padding:10px 0">
      <span style="font-size:18px">${icon}</span>
      <span style="flex:1"><b style="font-size:13px;color:#1F2A44">${title}</b><br>
        <span style="font-size:11px;color:#8A8471">${esc(sub)}</span></span>
      <b style="font-size:12.5px;color:#1F2A44;white-space:nowrap">${esc(right)}</b>
    </div>`;
  const growth = d.improvements > 0
    ? `${d.kudos > 0 ? `${d.kudos} kudos 🎉 · ` : ''}${d.improvements} thing${d.improvements === 1 ? '' : 's'} to grow — you've got this 💪`
    : d.kudos > 0 ? `${d.kudos} kudos 🎉 — keep shining!` : 'a quiet week — new chances ahead 🌱';
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:14px">
    <div style="border-radius:18px;overflow:hidden;border:1px solid #EFE4CC;background:#fff">
      <div style="background:linear-gradient(135deg,#1F2A44,#2E3D5C);padding:16px;color:#fff">
        <div style="font-size:16px;font-weight:900">🐝 Your Hive · ${esc(d.periodLabel)}</div>
        <div style="font-size:12px;opacity:.9;margin-top:3px">💰 Money ${esc(deltaLine)}</div>
      </div>
      <div style="padding:6px 16px 2px">
        ${row('💵', 'Money now', `⭐ ${d.hpEarned >= 0 ? '' : ''}${d.balances.hp.toLocaleString('en-US')} HP · 🪙 ${d.balances.coins.toLocaleString('en-US')} · 💵 ${money(d.balances.cashCents)}`, `🍯 ${money(d.balances.potCents)}`)}
        ${row('🏪', 'Business', d.salesCount > 0 ? `${d.salesCount} sale${d.salesCount === 1 ? '' : 's'} this period` : 'no sales this period', d.salesCount > 0 ? `+${money(d.salesCents)}` : '—')}
        ${row('⭐', 'Points earned', 'from chores, routines & your business', `+${d.hpEarned.toLocaleString('en-US')} HP`)}
        ${row('👏', 'Behavior', growth, d.kudos > 0 ? '😊' : '🌱')}
      </div>
      <div style="text-align:center;padding:10px 16px 16px">
        <a href="${APP_URL}/hive/statement" style="display:inline-block;background:#F0A32A;color:#3a2a08;font-weight:900;font-size:13px;border-radius:999px;padding:10px 26px;text-decoration:none">📜 Open my full statement →</a>
      </div>
      <div style="padding:9px 12px;font-size:10px;color:#8A8471;background:#FFFDF7;border-top:1px solid #EFE4CC">
        Sent on your family's schedule · parents receive the same email · manage in Household Setup.
      </div>
    </div>
  </div>`;
}

/** Build + send one kid's Hive statement. Returns true when an attempt was
 *  made (caller stamps lastStatementKey). Parents are ALWAYS CC'd; extended
 *  CC comes from the parent-selected contacts + extra addresses. */
export async function sendKidStatementMail(
  db: AdminDb,
  familyId: string,
  childId: string,
  famData: (FamilyDataSlice & {
    alertEmails?: import('./alertEmails.shared').AlertEmailsConfig;
  }) | undefined,
  ctx: { periodLabel: string; startMs: number; endMs: number; tz: string },
): Promise<boolean> {
  try {
    const prefs = famData?.kidEmailUpdates?.[childId];
    if (!prefs?.statement) return false;
    const resolved = await resolveKidEmailAddress(db, familyId, childId, famData);
    if (!resolved) return false;

    const famRef = db.collection('families').doc(familyId);
    const childSnap = await famRef.collection('children').doc(childId).get();
    if (!childSnap.exists) return false;
    const kid = childSnap.data() as { name?: string };

    // Parents — ALWAYS CC'd (via the alert-email cascade's global level).
    const parentsSnap = await db.collection('users')
      .where('familyId', '==', familyId).where('role', '==', 'parent').get();
    const parentEmails = parentsSnap.docs
      .map((d) => (d.data() as { email?: string }).email)
      .filter((e): e is string => !!e);
    // Extended CC (Elia's addition): approved contacts + parent extras.
    const contacts = (famData?.externalContacts ?? [])
      .filter((c) => (prefs.statementCcContacts ?? []).includes(c.id))
      .map((c) => c.email);
    const extras = (prefs.statementCcExtra ?? []).filter(Boolean);
    const cc = Array.from(new Set([...parentEmails, ...contacts, ...extras]))
      .filter((e) => e !== resolved.email);

    // Wallet + period ledger.
    const walletSnap = await famRef.collection('kids').doc(childId)
      .collection('wallet').doc('balances').get();
    const w = (walletSnap.data() ?? {}) as {
      housePoints?: number; honeyCoins?: number; treasuryCents?: number; cashCents?: number;
    };
    const txSnap = await famRef.collection('kids').doc(childId)
      .collection('hiveTransactions').orderBy('createdAt', 'desc').limit(300).get();
    let moneyDeltaCents = 0; let hpEarned = 0; let salesCount = 0; let salesCents = 0;
    txSnap.docs.forEach((doc2) => {
      const t = doc2.data() as {
        layer?: string; direction?: string; amount?: number; category?: string; status?: string;
        createdAt?: FirebaseFirestore.Timestamp;
      };
      const ms = t.createdAt?.toMillis?.();
      if (t.status !== 'completed' || typeof ms !== 'number' || ms < ctx.startMs || ms >= ctx.endMs) return;
      const amt = Number(t.amount ?? 0);
      const signed = t.direction === 'in' ? amt : -amt;
      if (t.layer === 'treasury' || t.layer === 'cash') moneyDeltaCents += signed;
      if (t.layer === 'house_points' && t.direction === 'in') hpEarned += amt;
      if (t.layer === 'treasury' && t.direction === 'in' && t.category === 'business') {
        salesCount += 1; salesCents += amt;
      }
    });

    // Behavior — kudos + improvement notes in the period, growth voice (F9).
    let kudos = 0; let improvements = 0;
    try {
      const awardsSnap = await famRef.collection('awards').where('childId', '==', childId).get();
      awardsSnap.docs.forEach((d2) => {
        const a = d2.data() as { kind?: string; createdAt?: FirebaseFirestore.Timestamp };
        const ms = a.createdAt?.toMillis?.();
        if (typeof ms !== 'number' || ms < ctx.startMs || ms >= ctx.endMs) return;
        if (a.kind === 'kudos') kudos += 1;
        if (a.kind === 'improvement_note') improvements += 1;
      });
    } catch { /* behavior stats are best-effort */ }

    const famCurrency = (famData as { currency?: string } | undefined)?.currency
      ?? (await famRef.get()).get('hiveConfig.currency') ?? 'TZS';
    const data: StatementData = {
      kidName: kid.name || 'you',
      periodLabel: ctx.periodLabel,
      balances: {
        hp: w.housePoints ?? 0, coins: w.honeyCoins ?? 0,
        potCents: w.treasuryCents ?? 0, cashCents: w.cashCents ?? 0,
      },
      moneyDeltaCents, hpEarned, salesCount, salesCents,
      kudos, improvements,
      currency: typeof famCurrency === 'string' ? famCurrency : 'TZS',
    };
    const subject = `🐝 Your Hive ${ctx.periodLabel}, ${data.kidName} — ${moneyDeltaCents >= 0 ? 'you grew! 📈' : 'the full story inside'}`;

    let sent = false; let error: string | undefined;
    if (!resend) { error = 'resend-not-configured'; }
    else {
      try {
        await resend.emails.send({
          from: RESEND_FROM, to: [resolved.email],
          ...(cc.length > 0 ? { cc } : {}),
          subject, html: renderKidStatementEmail(data),
        });
        sent = true;
      } catch (e) { error = e instanceof Error ? e.message : 'send-failed'; }
    }

    await writeKidAlertLog(db, familyId, {
      kind: 'kid_statement',
      childId, childName: kid.name || 'Kid',
      firedAt: Date.now(),
      trigger: 'statement',
      sourceLabel: resolved.sourceLabel,
      channels: {
        email: {
          on: true, sent,
          ...(error ? { error } : {}),
          to: [
            { name: kid.name || 'Kid', email: resolved.email },
            ...cc.map((e) => ({ name: 'CC', email: e })),
          ],
          subject,
          templateVersion: KID_STATEMENT_TEMPLATE_VERSION,
          // Rendered by the existing kid-email view in the Alert log.
          kidFacts: {
            kidName: data.kidName,
            emoji: '🧾',
            headline: `Hive statement · ${ctx.periodLabel}`,
            detail: `Money ${moneyDeltaCents >= 0 ? '+' : '−'}${data.currency} ${Math.round(Math.abs(moneyDeltaCents) / 100).toLocaleString('en-US')} · ${salesCount} sale${salesCount === 1 ? '' : 's'} · +${hpEarned} HP · ${kudos} kudos`,
          },
        },
      },
    });
    return true;
  } catch {
    return false; // never throws into the cron
  }
}
