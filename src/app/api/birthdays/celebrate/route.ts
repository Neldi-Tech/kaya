// POST { familyId, triggeredBy } — idempotent morning kickoff for today's
// birthdays (Kaya Birthdays B1, approved 2026-06-10).
//
// For each family member whose birthday is TODAY and whose celebration hasn't
// been kicked off this year:
//   • posts the Kaya celebration message into the family chat
//   • emails the parents + helpers (+ the kid's login email) a themed wish CTA
//   • stamps family.birthdays[{personId}_{year}].kickoffAt (the idempotency guard)
//
// Admin SDK throughout — celebration state lives on the family doc, so NO
// Firestore-rules change is needed (members already read the family doc).
// Triggered client-side on first app open (BirthdayHero); the B4 cron will add
// a guaranteed 6:30 AM firing.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import {
  todaysBirthdays, ordinalAge, type BirthdayPersonSource, type BirthdayPerson,
} from '@/lib/birthdays';

export const runtime = 'nodejs';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const resend = apiKey ? new Resend(apiKey) : null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emailHtml(p: BirthdayPerson, appUrl: string): string {
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

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; triggeredBy?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const triggeredBy = typeof body.triggeredBy === 'string' ? body.triggeredBy : '';
  if (!familyId || !triggeredBy) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  // Caller must belong to the family (any role can trigger — it's idempotent).
  const callerSnap = await db.collection('users').doc(triggeredBy).get();
  if (!callerSnap.exists || callerSnap.data()?.familyId !== familyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const famRef = db.collection('families').doc(familyId);
  const [famSnap, childrenSnap, usersSnap] = await Promise.all([
    famRef.get(),
    famRef.collection('children').get(),
    db.collection('users').where('familyId', '==', familyId).get(),
  ]);
  if (!famSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });

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
  usersSnap.forEach((d) => {
    const u = d.data() as Record<string, unknown>;
    const role = String(u.role || '');
    if ((role === 'parent' || role === 'helper') && typeof u.email === 'string' && u.email) {
      parentHelperEmails.push(u.email);
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

  const people = todaysBirthdays(sources);
  if (people.length === 0) return NextResponse.json({ ok: true, celebrated: [] });

  const existing = (famSnap.data()?.birthdays || {}) as Record<string, { kickoffAt?: number }>;
  const appUrl = req.nextUrl.origin;
  const celebrated: string[] = [];

  for (const p of people) {
    if (existing[p.stateKey]?.kickoffAt) continue;  // already kicked off this year

    // 1 · Family-chat celebration post (from Kaya).
    const ageBit = p.age ? `${ordinalAge(p.age)} ` : '';
    const text = `🎉🎂 It's ${p.name}'s ${ageBit}birthday today! Drop your wish — every wish lights a candle ${p.theme.emoji}`;
    const threadRef = famRef.collection('threads').doc('group');
    const threadSnap = await threadRef.get();
    if (threadSnap.exists) {
      await threadRef.collection('messages').add({
        senderUid: 'kaya', senderName: 'Kaya 🎂', text, createdAt: FieldValue.serverTimestamp(),
      });
      await threadRef.update({
        lastText: text, lastSenderUid: 'kaya', lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
    }

    // 2 · Emails — parents + helpers + (kid's login email). Skip the birthday
    //     adult's own email (no spoiling their own surprise tone).
    if (resend) {
      const to = [...parentHelperEmails];
      if (p.kind === 'kid' && p.email) to.push(p.email);
      const dedup = Array.from(new Set(to.filter(Boolean)));
      if (dedup.length > 0) {
        await resend.emails.send({
          from: FROM, to: dedup,
          subject: `🎂 It's ${p.name}'s ${ageBit}birthday today!`,
          html: emailHtml(p, appUrl),
        }).catch(() => {});
      }
    }

    // 3 · Stamp the state (idempotency + UI source of truth).
    await famRef.set({
      birthdays: {
        [p.stateKey]: {
          name: p.name, ...(p.age ? { age: p.age } : {}), themeId: p.theme.id,
          kickoffAt: Date.now(), wishes: existing[p.stateKey] && Array.isArray((existing[p.stateKey] as { wishes?: unknown[] }).wishes) ? (existing[p.stateKey] as { wishes?: unknown[] }).wishes : [],
        },
      },
    }, { merge: true });
    celebrated.push(p.stateKey);
  }

  return NextResponse.json({ ok: true, celebrated });
}
