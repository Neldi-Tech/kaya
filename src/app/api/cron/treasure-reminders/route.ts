// Kaya Sparks · Treasures — the Keeper Check escalation ladder + the
// overdue-return chase (D23 · D11 · D16).
//
// Hourly sweep. D23 is Elia's addition of 16-Aug-2026 and it is the
// difference between a feature families use and one they forget: a
// check that never resurfaces is a check nobody does. So a missed check
// ESCALATES rather than quietly disappearing —
//
//   ① due day, at the parent's chosen hour
//        → the KID: bell + push. It is also already sitting on My Day
//          and the Workplan as a real to-do (see lib/sparks/treasures).
//   ② +N days still open (parent-set, default 1)
//        → a second kid nudge AND a push to the parents.
//   ③ +M days still open (parent-set, default 3)
//        → ONE email to the parents through the existing cascade
//          (Treasure > Sparks > Family Global) + any extra addresses.
//   ④ the next due date arrives with the last one still open
//        → marked overdue on the parent roll-up, and the two checks
//          MERGE into one. Never two stacked chores (R2's lesson).
//
// Completing the check at ANY rung closes the ladder: the gateway
// writes `escalationStage: 0` and `lastDoneOn`, and this sweep appends
// a quiet ✅ to the SAME alertLog entry rather than sending a second
// alarming message (R1).
//
// The copy stays "let's check your things" at every rung. Escalation is
// about not letting it slip, never about blame — and nothing is ever
// deducted (D7).
//
// Also here: 🤝 overdue returns. Most things aren't lost, they're lent
// and forgotten, so both sides get a nudge on the due morning and the
// lender gets one more when it goes past.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminMessaging } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { resolveAlertRecipients, type AlertEmailsConfig } from '@/lib/alertEmails.shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

/** Bumped whenever the email markup changes, so 📜 alertLog can
 *  re-render an old entry exactly as it was sent. */
const CHECK_MISS_TEMPLATE_VERSION = 1;

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7, fortnightly: 14, monthly: 30, termly: 90,
};

const LIVE = ['kept', 'lent', 'lost', 'broken', 'repaired'];

function dayKeyTZ(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function hourTZ(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0');
  return h === 24 ? 0 : h;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, (tm || 1) - 1, td || 1)
    - Date.UTC(fy, (fm || 1) - 1, fd || 1)) / 86400000);
}

/** Mirrors nextCheckDue() in the gateway — kept identical so the child's
 *  screen and this sweep can never disagree about when it's due. */
function nextCheckDue(
  lastDoneOn: string | undefined, cadence: string, dayOfWeek: number, today: string,
): string {
  const interval = CADENCE_DAYS[cadence] ?? 14;
  if (!lastDoneOn) {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
    return addDays(today, (dayOfWeek - dow + 7) % 7);
  }
  let due = addDays(lastDoneOn, interval);
  const [y, m, d] = due.split('-').map(Number);
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  due = addDays(due, (dayOfWeek - dow + 7) % 7);
  return due;
}

interface Settings {
  kidId?: string; cadence?: string; dayOfWeek?: number; hour?: number;
  enabled?: boolean; escalatePushAfterDays?: number; escalateEmailAfterDays?: number;
  extraEmails?: string[]; lastDoneOn?: string;
  /** 0 none · 1 kid nudged · 2 parents pushed · 3 parents emailed. */
  escalationStage?: number;
  /** Which due-date the current ladder belongs to, so a new cycle
   *  starts a fresh ladder instead of inheriting the last one's rung. */
  ladderFor?: string;
  lastAlertLogId?: string;
  /** Set when the ladder was closed by a completed check, so the quiet
   *  ✅ fires exactly once. */
  resolvedFor?: string;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  const messaging = getAdminMessaging();

  const now = new Date();
  const today = dayKeyTZ(now);
  const hour = hourTZ(now);

  let families = 0, kidsScanned = 0, rung1 = 0, rung2 = 0, rung3 = 0, closed = 0, returns = 0;

  const push = async (uid: string, title: string, body: string, url: string, tag: string) => {
    if (!messaging) return;
    try {
      const toks = await db.collection('users').doc(uid).collection('fcmTokens').get();
      const tokens = toks.docs.map((t) => t.id);
      if (!tokens.length) return;
      await messaging.sendEachForMulticast({
        tokens, data: { title, body: body.slice(0, 160), url, tag },
      });
    } catch { /* best-effort */ }
  };

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const treasuresCol = famDoc.ref.collection('sparks_treasures');
      const privateCol = famDoc.ref.collection('sparks_treasure_private');

      // Nothing registered = nothing to chase. Cheapest possible exit.
      const anySnap = await treasuresCol.limit(1).get();
      if (anySnap.empty) continue;

      const usersSnap = await db.collection('users').where('familyId', '==', famDoc.id).get();
      const parents = usersSnap.docs
        .filter((u) => (u.data().role || '') === 'parent')
        .map((u) => ({
          uid: u.id,
          email: (u.data().email as string | undefined) || '',
          name: (u.data().displayName as string | undefined) || 'Parent',
        }));
      const parentUids = parents.map((p) => p.uid);
      const alertCfg = (famDoc.data() as { alertEmails?: AlertEmailsConfig }).alertEmails;

      const kidsSnap = await famDoc.ref.collection('children').get();
      const kidName = new Map<string, string>();
      const kidUid = new Map<string, string>();
      for (const k of kidsSnap.docs) {
        const d = k.data() as { name?: string; uid?: string };
        kidName.set(k.id, (d.name || 'Your child').split(' ')[0]);
        if (d.uid) kidUid.set(k.id, d.uid);
      }

      // ── 🤝 Overdue returns (D11) ─────────────────────────────────
      // Both sides on the due morning; the lender again once it slips.
      if (hour === 8) {
        const lentSnap = await treasuresCol.where('status', '==', 'lent').get();
        for (const doc of lentSnap.docs) {
          const t = doc.data() as {
            kidId?: string; name?: string; emoji?: string;
            borrow?: { toName?: string; toChildId?: string; dueOn?: string };
            lastReturnNudgeOn?: string;
          };
          const dueOn = t.borrow?.dueOn;
          if (!dueOn || today < dueOn) continue;
          if (t.lastReturnNudgeOn === today) continue;
          const owner = String(t.kidId || '');
          const link = `/sparks/${owner}/treasures/${doc.id}`;
          const late = daysBetween(dueOn, today);
          const ownerUid = kidUid.get(owner);
          const label = `${t.emoji || '🤝'} ${t.name || 'It'}`;

          if (ownerUid) {
            await push(ownerUid, `${label} is due back`,
              late > 0
                ? `${t.borrow?.toName || 'They'} has had it ${late} day${late === 1 ? '' : 's'} past the day you agreed.`
                : `${t.borrow?.toName || 'They'} said today.`,
              link, 'treasure-return');
          }
          const borrowerUid = t.borrow?.toChildId ? kidUid.get(t.borrow.toChildId) : undefined;
          if (borrowerUid) {
            await push(borrowerUid, `${label} goes back today`,
              `Back to ${kidName.get(owner) || 'them'} — you agreed ${dueOn}.`,
              link, 'treasure-return');
          }
          await doc.ref.update({ lastReturnNudgeOn: today }).catch(() => {});
          returns++;
        }
      }

      // ── 🔑 The Keeper Check ladder (D23) ─────────────────────────
      for (const kidDoc of kidsSnap.docs) {
        const kidId = kidDoc.id;
        const sRef = privateCol.doc(`settings__${kidId}`);
        const sSnap = await sRef.get();
        const s = (sSnap.exists ? sSnap.data() : {}) as Settings;
        if (s.enabled === false) continue;

        const cadence = CADENCE_DAYS[String(s.cadence)] ? String(s.cadence) : 'fortnightly';
        const dayOfWeek = Number.isFinite(Number(s.dayOfWeek)) ? Number(s.dayOfWeek) : 0;
        const atHour = Number.isFinite(Number(s.hour)) ? Number(s.hour) : 9;
        const pushAfter = Number.isFinite(Number(s.escalatePushAfterDays))
          ? Number(s.escalatePushAfterDays) : 1;
        const emailAfter = Number.isFinite(Number(s.escalateEmailAfterDays))
          ? Number(s.escalateEmailAfterDays) : 3;

        // Only chase a check that has something ON it (D9 · watch list).
        const tSnap = await treasuresCol.where('kidId', '==', kidId).get();
        const watch = tSnap.docs
          .map((d) => d.data() as { status?: string; watchlisted?: boolean })
          .filter((t) => LIVE.includes(String(t.status || 'kept')) && t.watchlisted !== false);
        if (watch.length === 0) continue;
        kidsScanned++;

        const dueOn = nextCheckDue(s.lastDoneOn, cadence, dayOfWeek, today);
        const name = kidName.get(kidId) || 'Your child';
        const uidOfKid = kidUid.get(kidId);
        const link = `/sparks/${kidId}/treasures/check`;

        // ── ladder closed by a completed check → ONE quiet ✅ (R1) ──
        // The gateway already zeroed the stage; all that's owed is the
        // reassurance to whoever was told it hadn't happened.
        if (s.lastDoneOn && s.ladderFor && s.lastDoneOn >= s.ladderFor
            && s.resolvedFor !== s.ladderFor) {
          if (s.lastAlertLogId) {
            await famDoc.ref.collection('alertLog').doc(s.lastAlertLogId).update({
              doneLate: { at: Date.now(), by: name },
            }).catch(() => {});
          }
          if ((s.escalationStage ?? 0) >= 2) {
            for (const p of parents) {
              await push(p.uid, `✅ ${name} did the Keeper Check`,
                'All their things are accounted for again.',
                `/sparks/${kidId}/treasures`, 'treasure-check-done');
            }
          }
          await sRef.set({ resolvedFor: s.ladderFor, escalationStage: 0 }, { merge: true })
            .catch(() => {});
          closed++;
          continue;
        }

        if (today < dueOn) continue;                 // not due yet
        if (s.lastDoneOn && s.lastDoneOn >= dueOn) continue; // already done

        const overdue = daysBetween(dueOn, today);
        // A new cycle starts a fresh ladder rather than inheriting the
        // previous one's rung — and ④ merges the two checks into ONE.
        const sameLadder = s.ladderFor === dueOn;
        const stage = sameLadder ? (s.escalationStage ?? 0) : 0;

        // ① due day, at the family's chosen hour
        if (overdue === 0 && stage < 1) {
          if (hour !== atHour) continue;
          if (uidOfKid) {
            await famDoc.ref.collection('notifications').add({
              type: 'treasure-check',
              title: '🔑 Keeper Check time',
              message: `${watch.length} things to tap · about 30 seconds.`,
              read: false, forUserId: uidOfKid, link,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(uidOfKid, '🔑 Keeper Check time',
              `${watch.length} things to tap · about 30 seconds.`, link, 'treasure-check');
          }
          await sRef.set({ kidId, ladderFor: dueOn, escalationStage: 1 }, { merge: true })
            .catch(() => {});
          rung1++;
          continue;
        }

        // ② +N days · second kid nudge AND a parent push
        if (overdue >= pushAfter && stage < 2) {
          if (hour !== atHour) continue;
          if (uidOfKid) {
            await push(uidOfKid, '🔑 Let’s check your things',
              `Still ${watch.length} to tap — it takes half a minute.`, link, 'treasure-check');
          }
          for (const p of parents) {
            await famDoc.ref.collection('notifications').add({
              type: 'treasure-check-miss',
              title: `🔑 ${name}’s Keeper Check is still open`,
              message: `${watch.length} things · due ${dueOn}.`,
              read: false, forUserId: p.uid, link: `/sparks/${kidId}/treasures`,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(p.uid, `🔑 ${name}’s Keeper Check is still open`,
              `${watch.length} things · due ${dueOn}.`,
              `/sparks/${kidId}/treasures`, 'treasure-check-miss');
          }
          await sRef.set({ kidId, ladderFor: dueOn, escalationStage: 2 }, { merge: true })
            .catch(() => {});
          rung2++;
          continue;
        }

        // ③ +M days · ONE email through the existing cascade
        if (overdue >= emailAfter && stage < 3) {
          if (hour !== atHour) continue;
          const { uids, level } = resolveAlertRecipients(alertCfg, 'sparks', parentUids);
          const to = parents
            .filter((p) => uids.includes(p.uid) && p.email)
            .map((p) => ({ name: p.name, email: p.email }));
          const extras = (Array.isArray(s.extraEmails) ? s.extraEmails : [])
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
            .map((e) => ({ name: e, email: e }));
          const all = [...to, ...extras];

          const missingNow = tSnap.docs
            .map((d) => d.data() as { status?: string; name?: string })
            .filter((t) => t.status === 'lost');

          const subject = `🔑 ${name}’s Keeper Check hasn’t happened yet`;
          const html = missEmail({
            name, items: watch.length, dueOn, overdue,
            missing: missingNow.map((m) => String(m.name || 'something')),
            nextDue: nextCheckDue(dueOn, cadence, dayOfWeek, dueOn),
            appUrl: APP_URL, link: `/sparks/${kidId}/treasures`,
          });

          let sent = false;
          let error = '';
          if (resend && all.length) {
            try {
              await resend.emails.send({ from: FROM, to: all.map((r) => r.email), subject, html });
              sent = true;
            } catch (e) {
              error = e instanceof Error ? e.message : 'send failed';
            }
          }

          const logRef = await famDoc.ref.collection('alertLog').add({
            kind: 'treasure_check_miss',
            firedAt: Date.now(),
            trigger: `Keeper Check open ${overdue} day${overdue === 1 ? '' : 's'} past ${dueOn}`,
            sourceLabel: `🔑 ${name}’s Keeper Check`,
            kidId,
            day: today,
            recipientLevel: level,
            channels: {
              email: {
                on: true, sent, ...(error ? { error } : {}),
                to: all,
                subject,
                templateVersion: CHECK_MISS_TEMPLATE_VERSION,
              },
            },
          }).catch(() => null);

          const patch: Record<string, unknown> = {
            kidId, ladderFor: dueOn, escalationStage: 3,
          };
          if (logRef) patch.lastAlertLogId = logRef.id;
          await sRef.set(patch, { merge: true }).catch(() => {});
          rung3++;
        }
      }
    } catch {
      continue; // one family's failure never blocks the rest
    }
  }

  return NextResponse.json({
    ok: true, today, hour, families, kidsScanned, rung1, rung2, rung3, closed, returns,
  });
}

/** ③ · the parent email. Growth-voice, never blame — and it says plainly
 *  that nothing has been taken away, because a parent who reads an
 *  alarming email passes the alarm straight on to the child. */
function missEmail(a: {
  name: string; items: number; dueOn: string; overdue: number;
  missing: string[]; nextDue: string; appUrl: string; link: string;
}): string {
  const missingLine = a.missing.length
    ? `<p style="margin:0 0 10px;font-size:14px;color:#8B2830;">
         Still to find: <b>${a.missing.slice(0, 4).map(esc).join(', ')}</b>
       </p>`
    : '<p style="margin:0 0 10px;font-size:14px;color:#2E7D4F;">Nothing is reported missing — this is just the check itself.</p>';

  return `<!doctype html><html><body style="margin:0;background:#F4EFE3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#0E6B5E,#3FA38F);border-radius:18px;padding:22px;color:#fff;">
      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;opacity:.85;">Kaya · Treasures</div>
      <div style="font-size:19px;font-weight:800;margin-top:6px;">🔑 ${esc(a.name)}’s Keeper Check hasn’t happened yet</div>
      <div style="font-size:13px;opacity:.92;margin-top:6px;">Due ${esc(a.dueOn)} · ${a.overdue} day${a.overdue === 1 ? '' : 's'} ago · ${a.items} things on it</div>
    </div>
    <div style="background:#fff;border:1px solid #E8E0CF;border-radius:18px;padding:20px;margin-top:12px;">
      ${missingLine}
      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#1F2A44;">
        It takes about thirty seconds — ${esc(a.name)} taps once for each thing and we know where
        everything stands again.
      </p>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#5B6B8C;">
        Nothing has been taken away, and nothing will be. Kaya only ever asks — the point is that
        it doesn’t quietly slip. If it’s still open when the next one comes round on
        <b>${esc(a.nextDue)}</b>, the two will merge into a single check rather than stacking up.
      </p>
      <a href="${esc(a.appUrl)}${esc(a.link)}"
         style="display:inline-block;background:#0E6B5E;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:11px 20px;border-radius:999px;">
        Open Treasures
      </a>
    </div>
    <p style="font-size:11px;color:#8A8471;text-align:center;margin-top:14px;">
      You can change how often this comes round in Sparks → Treasures → Check settings.
    </p>
  </div></body></html>`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c
  ));
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
