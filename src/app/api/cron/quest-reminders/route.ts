// Kaya Sparks · Quests — cut-off reminders + done-late resolution (D11 · R1).
//
// Hourly sweep. For every family, every ACTIVE quest with reminders on:
//
//   · a nudge one hour before the cut-off → the KID only, bell + push.
//     Never an email: an email to a child about not having done
//     something yet is the wrong instrument entirely.
//   · at or after the cut-off, step still open → the miss alert:
//     bell + push to the kid's parents, and ONE email to the resolved
//     recipients (D11 cascade: Quest > Sparks > Family Global, plus any
//     extra outside addresses on the quest — a tutor, a grandparent).
//   · R1 · the step gets done later the same day → we APPEND a "done
//     late" line to the SAME alertLog entry and send a quiet ✅ push.
//     Never a second alarming email. Parents who were told the child
//     hadn't done it get told when they do.
//
// Rest days, paused quests and days with no planned step are skipped
// entirely — a reminder for something that was never due is noise, and
// noise is how a family learns to ignore the channel.
//
// Every send is traced in `alertLog` exactly like the household engine,
// so "did Kaya actually email me?" is answerable from the 📜 log.

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

/** Bumped whenever the miss email's markup changes, so the alert log can
 *  re-render an old entry exactly as it was sent. */
const QUEST_MISS_TEMPLATE_VERSION = 1;

type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dayKeyTZ(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function hhmmTZ(d: Date): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = p.find((x) => x.type === 'hour')?.value ?? '00';
  const m = p.find((x) => x.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function dowOf(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DOW_KEYS[new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay()];
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

interface QuestDoc {
  kidId?: string; title?: string; emoji?: string; status?: string;
  activeDays?: DayOfWeek[]; cutoffHHmm?: string; pausedUntil?: string;
  remindersEnabled?: boolean; extraEmails?: string[];
  alertRecipientUids?: string[];
  streak?: { current?: number; shields?: number };
  lastNudgeOn?: string; lastMissAlertOn?: string; missAlertLogId?: string;
  missResolvedOn?: string;
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
  const nowHHmm = hhmmTZ(now);
  const nowMin = minutesOf(nowHHmm);
  const todayDow = dowOf(today);

  let families = 0, scanned = 0, nudges = 0, misses = 0, resolved = 0;

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
      const questsSnap = await famDoc.ref.collection('sparks_quests')
        .where('status', '==', 'active').get();
      if (questsSnap.empty) continue;

      // Resolve the family's people once.
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

      for (const qDoc of questsSnap.docs) {
        const q = qDoc.data() as QuestDoc;
        scanned++;
        if (q.remindersEnabled === false) continue;
        if (q.pausedUntil && today <= q.pausedUntil) continue;
        const activeDays = Array.isArray(q.activeDays) ? q.activeDays : [];
        if (!activeDays.includes(todayDow)) continue;

        const kidId = String(q.kidId || '');
        if (!kidId) continue;

        // Today's step. No step planned = nothing to chase.
        const stepsSnap = await famDoc.ref.collection('sparks_quest_steps')
          .where('questId', '==', qDoc.id)
          .where('date', '==', today)
          .get();
        if (stepsSnap.empty) continue;
        const steps = stepsSnap.docs.map((s) => s.data() as { done?: boolean; title?: string; minutes?: number });
        const open = steps.find((s) => !s.done);
        const allDone = !open;

        const cutoff = typeof q.cutoffHHmm === 'string' ? q.cutoffHHmm : '17:00';
        const cutMin = minutesOf(cutoff);
        const title = String(q.title || 'Quest');
        const emoji = String(q.emoji || '🚀');
        const name = kidName.get(kidId) || 'Your child';
        const link = `/sparks/${kidId}/quests/${qDoc.id}`;

        // ── R1 · done late → append to the SAME entry, quiet push ────
        if (allDone && q.lastMissAlertOn === today && q.missResolvedOn !== today) {
          if (q.missAlertLogId) {
            await famDoc.ref.collection('alertLog').doc(q.missAlertLogId).update({
              doneLate: { at: Date.now(), by: name },
            }).catch(() => {});
          }
          for (const p of parents) {
            await push(
              p.uid,
              `✅ ${name} did it`,
              `${title} — done after the cut-off, but done.`,
              link, 'quest-done-late',
            );
          }
          await qDoc.ref.update({ missResolvedOn: today }).catch(() => {});
          resolved++;
          continue;
        }
        if (allDone) continue;

        // ── the kid nudge, one hour before the cut-off ───────────────
        if (nowMin >= cutMin - 60 && nowMin < cutMin && q.lastNudgeOn !== today) {
          const uidOfKid = kidUid.get(kidId);
          if (uidOfKid) {
            await famDoc.ref.collection('notifications').add({
              type: 'quest-nudge',
              title: `${emoji} ${open?.minutes ?? 10} minutes left on ${title}`,
              message: open?.title ? `Today: ${open.title}` : 'Your step is still waiting.',
              read: false, forUserId: uidOfKid, link,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(uidOfKid, `${emoji} ${title}`,
              open?.title ? `Today: ${open.title}` : 'Your step is still waiting.',
              link, 'quest-nudge');
          }
          await qDoc.ref.update({ lastNudgeOn: today }).catch(() => {});
          nudges++;
          continue;
        }

        // ── the miss alert, once per quest per day ───────────────────
        if (nowMin >= cutMin && q.lastMissAlertOn !== today) {
          // D11 · Quest > Sparks > Family Global, then the extra outside
          // addresses the family added to THIS quest.
          const { uids, level } = resolveAlertRecipients(
            alertCfg, 'sparks', parentUids, q.alertRecipientUids,
          );
          const to = parents
            .filter((p) => uids.includes(p.uid) && p.email)
            .map((p) => ({ name: p.name, email: p.email }));
          const extras = (Array.isArray(q.extraEmails) ? q.extraEmails : [])
            .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
            .map((e) => ({ name: e, email: e }));
          const all = [...to, ...extras];

          const subject = `${emoji} ${name} hasn’t done today’s Quest step — ${title}`;
          const html = missEmail({
            name, title, emoji, cutoff,
            stepTitle: open?.title || 'today’s step',
            minutes: open?.minutes ?? 10,
            streak: Number(q.streak?.current) || 0,
            shields: Number(q.streak?.shields) || 0,
            appUrl: APP_URL, link,
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
            kind: 'quest_miss',
            firedAt: Date.now(),
            trigger: `${title} · step open past ${cutoff}`,
            sourceLabel: `${emoji} ${title}`,
            questId: qDoc.id,
            kidId,
            day: today,
            recipientLevel: level,
            channels: {
              email: {
                on: true, sent, ...(error ? { error } : {}),
                to: all,
                subject,
                templateVersion: QUEST_MISS_TEMPLATE_VERSION,
              },
            },
          }).catch(() => null);

          for (const p of parents) {
            await famDoc.ref.collection('notifications').add({
              type: 'quest-miss',
              title: `${emoji} ${name} hasn’t done today’s step`,
              message: `${title} — ${open?.minutes ?? 10} minutes of work still open.`,
              read: false, forUserId: p.uid, link,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(p.uid, `${emoji} ${name} hasn’t done today’s step`,
              `${title} — still open.`, link, 'quest-miss');
          }

          const patch: Record<string, unknown> = { lastMissAlertOn: today };
          if (logRef) patch.missAlertLogId = logRef.id;
          await qDoc.ref.update(patch).catch(() => {});
          misses++;
        }
      }
    } catch {
      continue; // one family's failure never blocks the rest
    }
  }

  return NextResponse.json({ ok: true, today, nowHHmm, families, scanned, nudges, misses, resolved });
}

function missEmail(a: {
  name: string; title: string; emoji: string; cutoff: string;
  stepTitle: string; minutes: number; streak: number; shields: number;
  appUrl: string; link: string;
}): string {
  const streakLine = a.streak > 0
    ? `${a.streak}-day streak at risk${a.shields > 0 ? ` · 🛡️ ${a.shields} shield${a.shields === 1 ? '' : 's'} available` : ''}`
    : 'No streak going yet — tonight is a good place to start one.';
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:26px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#3B2E86,#5AB7D6)">
      <div style="font-size:11px;font-weight:900;letter-spacing:2px;opacity:.85">🚀 KAYA SPARKS · QUESTS</div>
      <div style="font-size:30px;margin-top:8px">${a.emoji}</div>
      <div style="font-size:18px;font-weight:900;margin-top:6px">${a.name} hasn’t done today’s step</div>
      <div style="font-size:12.5px;opacity:.9;margin-top:3px">${a.title} · due by ${a.cutoff}</div>
    </div>
    <div style="background:#fff;border:1px solid #ECE4D3;border-radius:14px;padding:18px;margin-top:14px;color:#0F1F44;font-size:14px;line-height:1.55">
      <strong>Today:</strong> ${a.stepTitle}<br>
      <span style="color:#5A6488;font-size:13px">${a.minutes} minutes of work · ${streakLine}</span>
      <p style="color:#5A6488;font-size:12.5px;line-height:1.6;margin:14px 0 0">
        If ${a.name} does it later this evening, we’ll tell you — you won’t have to wonder, and we won’t email you again about today.
      </p>
    </div>
    <div style="text-align:center;margin-top:16px">
      <a href="${a.appUrl}${a.link}" style="display:inline-block;background:#D4A847;color:#3D2E08;font-weight:900;font-size:14px;border-radius:999px;padding:11px 28px;text-decoration:none">Open the quest →</a>
    </div>
    <p style="font-size:10.5px;color:#5A6488;margin-top:16px;text-align:center">
      Change the cut-off, the recipients or turn this off on the quest’s own page.
    </p>
  </div>`;
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
