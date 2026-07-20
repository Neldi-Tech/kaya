// Kaya Birthdays · B4 — the daily "never-missed" sweep (approved 2026-06-10).
//
// Runs every morning and, for EVERY family:
//   1. DAY-OF kickoff — the same celebration the client BirthdayHero fires
//      (family-chat post + themed emails + stamp kickoffAt), but guaranteed
//      even if nobody opens the app today. Idempotent per person/year.
//   2. ADVANCE heads-up — a 7-day and a 1-day-before nudge to PARENTS (in-app
//      + email) so they can plan a gift. Idempotent via pre7At / pre1At.
//
// Admin SDK throughout; celebration/reminder state lives on the family doc
// (`family.birthdays[{personId}_{year}]`) so NO firestore-rules change. The
// per-person day-of logic mirrors /api/birthdays/celebrate (left untouched as
// the client-triggered path) — kept here so a broken family never blocks the
// rest of the sweep. Secured by CRON_SECRET when set.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { daysToNextBirthday, ageAtNextBirthday } from '@/lib/dates';
import { readParticipationAges } from '@/lib/participation';
import {
  todaysBirthdays, ordinalAge, type BirthdayPersonSource, type BirthdayPerson,
} from '@/lib/birthdays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = apiKey ? new Resend(apiKey) : null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Day-of celebration email (matches /api/birthdays/celebrate).
function dayOfEmailHtml(p: BirthdayPerson, appUrl: string): string {
  const ageBit = p.age ? `${ordinalAge(p.age)} ` : '';
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:26px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,${p.theme.from},${p.theme.to})">
      <div style="font-size:30px">🎉🎂🎈</div>
      <div style="font-size:20px;font-weight:900;margin-top:8px">It's ${esc(p.name)}'s ${ageBit}birthday today!</div>
      <div style="font-size:13px;opacity:.92;margin-top:4px">${p.theme.emoji} The whole family is celebrating</div>
    </div>
    <div style="text-align:center;margin-top:18px">
      <a href="${appUrl}/my-day" style="display:inline-block;background:#F39C2F;color:#fff;font-weight:800;font-size:14px;border-radius:999px;padding:11px 24px;text-decoration:none">Send your wish in Kaya →</a>
      <div style="font-size:11.5px;color:#5C6975;margin-top:12px">One tap drops your wish into the family chat 🎂</div>
    </div>
  </div>`;
}

// Advance parent heads-up email (7-day / 1-day before).
function preEmailHtml(name: string, daysAway: number, ageNext: number | null, appUrl: string): string {
  const when = daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
  return `
  <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
    <div style="border-radius:16px;padding:24px 18px;text-align:center;color:#fff;background:linear-gradient(135deg,#1F2D3D 0%,#3E4DA0 70%,#D4A847 160%)">
      <div style="font-size:28px">🎁</div>
      <div style="font-size:19px;font-weight:900;margin-top:8px">${esc(name)}'s birthday is ${when}</div>
      ${ageNext ? `<div style="font-size:13px;opacity:.92;margin-top:3px">Turning ${ordinalAge(ageNext)} 🎂</div>` : ''}
    </div>
    <div style="text-align:center;margin-top:16px">
      <a href="${appUrl}/reminders" style="display:inline-block;background:#5B6CC8;color:#fff;font-weight:800;font-size:14px;border-radius:999px;padding:11px 24px;text-decoration:none">Open Gift Brain →</a>
      <div style="font-size:11.5px;color:#5C6975;margin-top:12px">A nudge to plan ahead — saved gift ideas live in Kaya Reminders.</div>
    </div>
  </div>`;
}

/** Calendar year of the birthday `daysAway` days from now (handles the
 *  Dec→Jan boundary for the stamp key). */
function occurrenceYear(daysAway: number): number {
  const d = new Date();
  d.setDate(d.getDate() + daysAway);
  return d.getFullYear();
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const appUrl = APP_URL;
  let families = 0, celebrated = 0, reminded = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    const famRef = famDoc.ref;
    try {
      const [childrenSnap, usersSnap] = await Promise.all([
        famRef.collection('children').get(),
        db.collection('users').where('familyId', '==', famDoc.id).get(),
      ]);

      const sources: BirthdayPersonSource[] = [];
      childrenSnap.forEach((d) => {
        const c = d.data() as Record<string, unknown>;
        sources.push({
          id: d.id, kind: 'kid',
          name: String(c.name || 'Kiddo'),
          birthday: typeof c.birthday === 'string' ? c.birthday : undefined,
          gender: typeof c.gender === 'string' ? c.gender : undefined,
          interests: Array.isArray(c.interests) ? (c.interests as string[]) : undefined,
          aspirations: Array.isArray(c.aspirations) ? (c.aspirations as string[]) : undefined,
          email: c.loginEnabled && typeof c.email === 'string' ? c.email : undefined,
        });
      });
      const parentHelperEmails: string[] = [];
      const parentEmails: string[] = [];
      const parentUids: string[] = [];
      usersSnap.forEach((d) => {
        const u = d.data() as Record<string, unknown>;
        const role = String(u.role || '');
        if ((role === 'parent' || role === 'helper') && typeof u.email === 'string' && u.email) parentHelperEmails.push(u.email);
        if (role === 'parent') {
          parentUids.push(d.id);
          if (typeof u.email === 'string' && u.email) parentEmails.push(u.email);
        }
        if (role === 'parent' || role === 'helper') {
          sources.push({
            id: d.id, kind: 'adult',
            name: String(u.displayName || 'Family member'),
            birthday: typeof u.birthday === 'string' ? u.birthday : undefined,
            gender: typeof u.gender === 'string' ? u.gender : undefined,
            privacy: (u.birthdayPrivacy as 'public' | 'partial' | 'private') || 'partial',
          });
        }
      });

      const existing = (famDoc.data()?.birthdays || {}) as Record<string, { kickoffAt?: number; pre7At?: number; pre1At?: number; wishes?: unknown[] }>;

      // ── 1 · Day-of kickoff (guaranteed) ──────────────────────────────
      const people = todaysBirthdays(sources);
      for (const p of people) {
        if (existing[p.stateKey]?.kickoffAt) continue;
        const ageBit = p.age ? `${ordinalAge(p.age)} ` : '';
        const text = `🎉🎂 It's ${p.name}'s ${ageBit}birthday today! Drop your wish — every wish lights a candle ${p.theme.emoji}`;
        const threadRef = famRef.collection('threads').doc('group');
        if ((await threadRef.get()).exists) {
          await threadRef.collection('messages').add({
            senderUid: 'kaya', senderName: 'Kaya 🎂', text, createdAt: FieldValue.serverTimestamp(),
          }).catch(() => {});
          await threadRef.update({
            lastText: text, lastSenderUid: 'kaya', lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          }).catch(() => {});
        }
        if (resend) {
          const to = [...parentHelperEmails];
          if (p.kind === 'kid' && p.email) to.push(p.email);
          const dedup = Array.from(new Set(to.filter(Boolean)));
          if (dedup.length > 0) {
            await resend.emails.send({
              from: FROM, to: dedup,
              subject: `🎂 It's ${p.name}'s ${ageBit}birthday today!`,
              html: dayOfEmailHtml(p, appUrl),
            }).catch(() => {});
          }
        }
        await famRef.set({
          birthdays: {
            [p.stateKey]: {
              name: p.name, ...(p.age ? { age: p.age } : {}), themeId: p.theme.id,
              kickoffAt: Date.now(),
              wishes: Array.isArray(existing[p.stateKey]?.wishes) ? existing[p.stateKey]!.wishes : [],
            },
          },
        }, { merge: true });
        celebrated++;
      }

      // ── 2 · Advance heads-up — 7 days & 1 day before ─────────────────
      for (const src of sources) {
        if (!src.birthday) continue;
        if (src.kind === 'adult' && src.privacy === 'private') continue; // respect privacy
        const dd = daysToNextBirthday(src.birthday);
        if (dd !== 7 && dd !== 1) continue;
        const sk = `${src.id}_${occurrenceYear(dd)}`;
        const stampField: 'pre7At' | 'pre1At' = dd === 7 ? 'pre7At' : 'pre1At';
        if (existing[sk]?.[stampField]) continue; // already nudged

        const ageNext = ageAtNextBirthday(src.birthday);
        const when = dd === 1 ? 'tomorrow' : `in ${dd} days`;
        // In-app to parents.
        for (const pid of parentUids) {
          await famRef.collection('notifications').add({
            type: 'reminder',
            title: `🎁 ${src.name}'s birthday ${when}`,
            message: ageNext ? `Turning ${ordinalAge(ageNext)} — plan a gift in Reminders.` : 'A nudge to plan ahead — open Reminders.',
            read: false, forUserId: pid, link: '/reminders', createdAt: FieldValue.serverTimestamp(),
          }).catch(() => {});
        }
        // Email to parents.
        if (resend && parentEmails.length > 0) {
          await resend.emails.send({
            from: FROM, to: Array.from(new Set(parentEmails)),
            subject: `🎁 ${src.name}'s birthday ${when}`,
            html: preEmailHtml(src.name, dd, ageNext, appUrl),
          }).catch(() => {});
        }
        await famRef.set({ birthdays: { [sk]: { name: src.name, [stampField]: Date.now() } } }, { merge: true });
        reminded++;
      }

      // ── 3 · 🌟 Little Star graduation (2026-07-26) ───────────────────
      // A week before a kid's birthday crosses a participation threshold,
      // tell the parents Kaya will include them automatically on the day.
      // Once per surface per kid (graduationNotified flags).
      const ages = readParticipationAges(famDoc.data() as { participationAges?: Record<string, number> });
      for (const kidDoc of childrenSnap.docs) {
        const kid = kidDoc.data() as Record<string, unknown>;
        const bday = typeof kid.birthday === 'string' ? kid.birthday : '';
        if (!bday) continue;
        const dd = daysToNextBirthday(bday);
        const ageNext = ageAtNextBirthday(bday);
        if (dd === null || ageNext === null || dd > 7 || dd < 1) continue;
        const overrides = (kid.participationOverrides || {}) as { sparks?: boolean; meetings?: boolean };
        const notified = (kid.graduationNotified || {}) as { sparks?: boolean; meetings?: boolean };
        const name = String(kid.name || 'Your little star').split(' ')[0];
        const grads: Array<{ key: 'sparks' | 'meetings'; label: string; link: string }> = [];
        if (ageNext === ages.sparksFromAge && overrides.sparks === undefined && !notified.sparks) {
          grads.push({ key: 'sparks', label: '✨ Kaya Sparks — tasks & routines', link: '/sparks' });
        }
        if (ageNext === ages.meetingsFromAge && overrides.meetings === undefined && !notified.meetings) {
          grads.push({ key: 'meetings', label: '🗓️ Sunday meetings', link: '/meetings' });
        }
        for (const g of grads) {
          for (const pid of parentUids) {
            await famRef.collection('notifications').add({
              type: 'reminder',
              title: `🌟 ${name} turns ${ageNext} next week!`,
              message: `${name} is ready to join ${g.label}. Kaya will include ${name} automatically on the birthday — or adjust it on the profile.`,
              read: false, forUserId: pid, link: g.link, createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
          }
          if (resend && parentEmails.length > 0) {
            await resend.emails.send({
              from: FROM, to: Array.from(new Set(parentEmails)),
              subject: `🌟 ${name} is ready to join ${g.key === 'sparks' ? 'Kaya Sparks' : 'Sunday meetings'}!`,
              html: `<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1E120B">${name} turns ${ageNext} next week — old enough for <b>${g.label.replace(/^[^ ]+ /, '')}</b> by your family's participation ages. Kaya will include ${name} automatically on the birthday. 🎉<br><br>Want it different? Adjust ${name}'s profile in Kaya.</p>`,
            }).catch(() => {});
          }
          await kidDoc.ref.set({ graduationNotified: { ...notified, [g.key]: true } }, { merge: true });
          reminded++;
        }
      }
    } catch {
      continue; // a broken family never blocks the rest of the sweep
    }
  }

  return NextResponse.json({ ok: true, families, celebrated, reminded });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
