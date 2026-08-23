// HP2 · Kids review helpers — Admin gateway (D9–D13, approved 2026-08-23).
//
//   GET  ?mode=pending                → KID: eligible helpers this week,
//                                       window state, existing answers
//   GET  ?helperUid=…&weeks=8         → PARENT: reviews by week (+ kid names)
//   GET  ?helperUid=…&summary=1       → PARENT: this week's avg (for the
//                                       Today-tab card); HELPER → 403
//   POST { helperUid, answers[4], liked[], change[], note } → KID submits
//        (one per kid per helper per ISO week; editable while the window
//        is open; first send emails the parents + alertLog 'kid_review')
//
// Storage: families/{f}/helpers/{uid}/kidReviews/{YYYY-Www}_{childId}
// Admin-only — no Firestore rules; helpers and kids never read it.
// Route files export only handlers/config (Next constraint).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { readPolicy, kidsReviewOn, helperLiteFrom, fmtRange, weekBounds } from '@/lib/helperPerf.server';
import { ymdLocal, addDays, mondayOf } from '@/lib/routineFillCore';
import {
  questionSetFor, fillName, scoreAnswers, starsFor, reviewWindowOpen, reviewWeekAnchor, nextWindowOpen,
  KID_REVIEW_VERSION, FACES,
} from '@/lib/kidReviewQuestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

interface UserDoc { familyId?: string; role?: string; childId?: string; displayName?: string; name?: string; email?: string; kidReviewEmail?: boolean }

async function caller(req: NextRequest) {
  const db = getAdminFirestore(); const auth = getAdminAuth();
  if (!db || !auth) return { error: NextResponse.json({ error: 'admin-unavailable' }, { status: 503 }) };
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return { error: NextResponse.json({ error: 'invalid-token' }, { status: 401 }) }; }
  const user = (await db.collection('users').doc(uid).get()).data() as UserDoc | undefined;
  if (!user?.familyId) return { error: NextResponse.json({ error: 'no-family' }, { status: 403 }) };
  return { db, uid, user, famRef: db.collection('families').doc(user.familyId) };
}

function ageOfBirthday(b?: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || '');
  if (!m) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - Number(m[1]);
  const md = (now.getUTCMonth() + 1) - Number(m[2]);
  if (md < 0 || (md === 0 && now.getUTCDate() < Number(m[3]))) age -= 1;
  return age < 0 ? null : age;
}

export async function GET(req: NextRequest) {
  const c = await caller(req);
  if ('error' in c) return c.error;
  const { db, user, famRef } = c;
  void db;
  const sp = req.nextUrl.searchParams;
  const policy = await readPolicy(famRef);

  // ── KID: pending reviews this week ──
  if (sp.get('mode') === 'pending') {
    if (user.role !== 'kid' || !user.childId) return NextResponse.json({ error: 'kids-only' }, { status: 403 });
    const open = reviewWindowOpen();
    const anchor = ymdLocal(reviewWeekAnchor());
    const week = weekBounds(anchor);
    const childSnap = await famRef.collection('children').doc(user.childId).get();
    const child = childSnap.data() as { name?: string; birthday?: string } | undefined;
    const age = ageOfBirthday(child?.birthday);
    // No birthday → no gating (Little Stars rule); otherwise age ≥ minAge.
    if (age !== null && age < policy.kidReview.minAge) return NextResponse.json({ ok: true, open, helpers: [], reason: 'too-young' });
    const helperDocs = await famRef.collection('helpers').get();
    const helpers = [];
    for (const d of helperDocs.docs) {
      const h = helperLiteFrom(d.id, d.data() as Record<string, unknown>);
      if (h.status !== 'active' && h.status !== undefined) continue;
      if (!h.kidIds.includes(user.childId)) continue;
      if (!kidsReviewOn(policy, h.uid)) continue;
      const existing = await famRef.collection('helpers').doc(h.uid).collection('kidReviews').doc(`${week.weekKey}_${user.childId}`).get();
      const ex = existing.exists ? existing.data() as { answers?: number[]; liked?: string[]; change?: string[]; note?: string; submittedAt?: number } : null;
      const set = questionSetFor(h.preset);
      const first = h.displayName.split(' ')[0];
      helpers.push({
        uid: h.uid, name: h.displayName, first, preset: h.preset,
        questions: set.questions.map((q) => ({ id: q.id, text: fillName(q.text, first), labels: q.labels })),
        liked: set.liked, change: set.change,
        existing: ex ? { answers: ex.answers ?? [], liked: ex.liked ?? [], change: ex.change ?? [], note: ex.note ?? '', submittedAt: ex.submittedAt ?? null } : null,
      });
    }
    return NextResponse.json({
      ok: true, open, weekKey: week.weekKey, weekLabel: fmtRange(week.from, week.to),
      closesAt: open ? closesAtFor(week.to) : null,
      nextOpenAt: open ? null : nextWindowOpen().getTime(),
      kidName: child?.name ?? 'Kid', helpers,
    });
  }

  // ── PARENT: reviews for a helper ──
  const helperUid = (sp.get('helperUid') || '').slice(0, 128);
  if (!helperUid) return NextResponse.json({ error: 'helperUid required' }, { status: 400 });
  if (user.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });
  const weeksN = Math.max(1, Math.min(26, parseInt(sp.get('weeks') || '8', 10) || 8));
  const hSnap = await famRef.collection('helpers').doc(helperUid).get();
  if (!hSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const helper = helperLiteFrom(helperUid, hSnap.data() as Record<string, unknown>);
  const today = ymdLocal(new Date());
  const keys: { weekKey: string; from: string; to: string }[] = [];
  let mon = mondayOf(today);
  for (let i = 0; i < weeksN; i++) { keys.push(weekBounds(mon)); mon = addDays(mon, -7); }
  const kidsSnap = await famRef.collection('children').get();
  const kidName = new Map(kidsSnap.docs.map((d) => [d.id, ((d.data() as { name?: string }).name || 'Kid').split(' ')[0]]));
  const eligibleKids = helper.kidIds.filter((k) => kidName.has(k));
  const rSnap = await famRef.collection('helpers').doc(helperUid).collection('kidReviews')
    .where('weekKey', '>=', keys[keys.length - 1].weekKey).where('weekKey', '<=', keys[0].weekKey).get();
  const byWeek = new Map<string, Record<string, unknown>[]>();
  for (const d of rSnap.docs) {
    const r = d.data();
    const arr = byWeek.get(r.weekKey as string) ?? [];
    arr.push(r); byWeek.set(r.weekKey as string, arr);
  }
  const set = questionSetFor(helper.preset);
  const weeks = keys.map((k) => {
    const rows = (byWeek.get(k.weekKey) ?? []).map((r) => ({
      childId: r.childId, kidName: kidName.get(r.childId as string) ?? (r.childName as string) ?? 'Kid',
      answers: (r.answers as number[]) ?? [], pct: r.pct as number, liked: (r.liked as string[]) ?? [], change: (r.change as string[]) ?? [],
      note: (r.note as string) ?? '', submittedAt: r.submittedAt as number, updatedAt: r.updatedAt as number | undefined,
    }));
    const pct = rows.length ? Math.round(rows.reduce((a, r) => a + (r.pct ?? 0), 0) / rows.length) : null;
    return { ...k, label: fmtRange(k.from, k.to), pct, stars: pct === null ? null : starsFor(pct), count: rows.length, eligible: eligibleKids.length, reviews: rows };
  });
  if (sp.get('summary') === '1') {
    const w = weeks[0];
    return NextResponse.json({ ok: true, weekKey: w.weekKey, pct: w.pct, count: w.count, eligible: w.eligible });
  }
  return NextResponse.json({
    ok: true,
    helper: { uid: helper.uid, name: helper.displayName, preset: helper.preset },
    questions: set.questions.map((q) => ({ id: q.id, text: fillName(q.text, helper.displayName.split(' ')[0]), labels: q.labels })),
    eligibleKids: eligibleKids.map((k) => ({ id: k, name: kidName.get(k) })),
    weeks,
  });
}

/** Window closes Monday 02:59 UTC after the week's Sunday. */
function closesAtFor(sunday: string): number {
  const [y, m, d] = addDays(sunday, 1).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 2, 59, 0);
}

export async function POST(req: NextRequest) {
  const c = await caller(req);
  if ('error' in c) return c.error;
  const { db, user, famRef } = c;
  if (user.role !== 'kid' || !user.childId) return NextResponse.json({ error: 'kids-only' }, { status: 403 });
  if (!reviewWindowOpen()) return NextResponse.json({ error: 'window-closed' }, { status: 409 });

  let body: { helperUid?: string; answers?: number[]; liked?: string[]; change?: string[]; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const helperUid = typeof body.helperUid === 'string' ? body.helperUid.slice(0, 128) : '';
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => Number(a)) : [];
  const pct = scoreAnswers(answers);
  if (!helperUid || pct === null) return NextResponse.json({ error: 'helperUid + 4 answers required' }, { status: 400 });
  const clean = (arr: unknown, max: number) => (Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, max) : []);
  const liked = clean(body.liked, 3); const change = clean(body.change, 3);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) : '';

  const policy = await readPolicy(famRef);
  if (!kidsReviewOn(policy, helperUid)) return NextResponse.json({ error: 'not-enabled' }, { status: 403 });
  const hSnap = await famRef.collection('helpers').doc(helperUid).get();
  if (!hSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const helper = helperLiteFrom(helperUid, hSnap.data() as Record<string, unknown>);
  if (!helper.kidIds.includes(user.childId)) return NextResponse.json({ error: 'not-your-helper' }, { status: 403 });
  const childSnap = await famRef.collection('children').doc(user.childId).get();
  const child = childSnap.data() as { name?: string; birthday?: string } | undefined;
  const age = ageOfBirthday(child?.birthday);
  if (age !== null && age < policy.kidReview.minAge) return NextResponse.json({ error: 'too-young' }, { status: 403 });

  const week = weekBounds(ymdLocal(reviewWeekAnchor()));
  const ref = famRef.collection('helpers').doc(helperUid).collection('kidReviews').doc(`${week.weekKey}_${user.childId}`);
  const existing = await ref.get();
  const now = Date.now();
  const kidName = (child?.name || user.displayName || 'Kid').split(' ')[0];
  const set = questionSetFor(helper.preset);
  const doc = {
    weekKey: week.weekKey, from: week.from, to: week.to,
    childId: user.childId, childName: kidName,
    helperUid, helperName: helper.displayName, preset: helper.preset,
    questionSet: set.key, version: KID_REVIEW_VERSION,
    answers, pct, liked, change, note,
    submittedAt: existing.exists ? (existing.data()?.submittedAt as number) ?? now : now,
    updatedAt: now,
  };
  await ref.set(doc, { merge: true });

  // First send → email parents + trace. Edits stay quiet.
  let emailed = 0;
  if (!existing.exists && policy.kidReview.emailOnSubmit) {
    try {
      const members = await db.collection('users').where('familyId', '==', famRef.id).get();
      const parents = members.docs.map((d) => d.data() as UserDoc).filter((u) => u.role === 'parent' && u.email && u.kidReviewEmail !== false);
      const first = helper.displayName.split(' ')[0];
      const payload = {
        kidName, helperName: helper.displayName, starsText: starsFor(pct), pct, weekLabel: fmtRange(week.from, week.to),
        answers: set.questions.map((q, i) => ({ q: fillName(q.text, first), emoji: FACES[answers[i]].emoji, label: q.labels[answers[i]] })),
        liked, change, note: note || undefined, helperUid,
      };
      const sentTo: { name: string; email: string }[] = [];
      for (const p of parents) {
        try {
          const res = await fetch(`${APP_URL}/api/notify`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'kid-review-done', to: [p.email], data: { kidReview: payload } }),
          });
          if (res.ok) { emailed++; sentTo.push({ name: p.name || p.displayName || 'Parent', email: p.email! }); }
        } catch { /* best-effort */ }
      }
      try {
        await famRef.collection('alertLog').add({
          kind: 'kid_review', firedAt: now, trigger: 'system',
          childId: user.childId, childName: kidName, helperName: helper.displayName, weekKey: week.weekKey,
          channels: { email: { on: parents.length > 0, sent: sentTo.length > 0, to: sentTo, subject: `💬 ${kidName} reviewed ${helper.displayName} — ${starsFor(pct)} this week`, templateVersion: 1 } },
        });
      } catch { /* ignore */ }
    } catch { /* never blocks the save */ }
  }
  return NextResponse.json({ ok: true, weekKey: week.weekKey, pct, stars: starsFor(pct), updated: existing.exists, emailed });
}
