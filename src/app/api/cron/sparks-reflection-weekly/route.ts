// Slice 7o · Daily Reflection · weekly review · Sunday cron.
//
// Once per week (Vercel cron: Sunday 20:00 local-ish → 17:00 UTC for
// Africa/Dar_es_Salaam by default), iterates families → kids and:
//   1. Reads the last 7 days of sparks_reflections for the kid (TZ-local).
//   2. If at least 1 entry exists, calls the in-app AI route
//      /api/sparks/ai/reflection-week with the entries + kid name.
//   3. Persists the structured review at
//      /families/{f}/sparks_reflection_weeks/{kidId}_{YYYY-WW}.
//   4. Drops a 🪞 in-app notification to the kid + each parent so the
//      review card surfaces on next open.
//
// Admin SDK throughout · CRON_SECRET-protected when set · idempotent
// per (kid, weekKey) — re-running same week overwrites with current.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { dayKeyInTZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

interface AIEntry { date: string; text: string }

/** ISO-week-ish key (YYYY-Wnn) for the local-day key. Monday-start. */
function weekKeyOf(localDayKey: string): string {
  const [y, m, d] = localDayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  // ISO week: Thursday rule.
  const day = (dt.getUTCDay() + 6) % 7; // 0=Mon
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const fdow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fdow + 3);
  const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Last 7 local-days walking back from `endLocal` (inclusive). */
function last7LocalDays(endLocal: string): string[] {
  const [y, m, d] = endLocal.split('-').map(Number);
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    dt.setUTCDate(dt.getUTCDate() - i);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
  }
  return out;
}

async function callReviewAPI(args: {
  kidName: string; weekKey: string; entries: AIEntry[];
}): Promise<Record<string, unknown> | null> {
  try {
    const url = `${APP_URL}/api/sparks/ai/reflection-week`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.skipped || data.error) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });

  const today = dayKeyInTZ(new Date(), TZ);
  const weekKey = weekKeyOf(today);
  const window = last7LocalDays(today);
  const weekStart = window[0];
  const weekEnd = window[6];

  let families = 0, kidsScanned = 0, generated = 0, skipped = 0;

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const childrenSnap = await famDoc.ref.collection('children').get();
      if (childrenSnap.empty) continue;

      const usersSnap = await db.collection('users').where('familyId', '==', famDoc.id).get();
      const parentIds = usersSnap.docs
        .filter((u) => (u.data().role || '') === 'parent')
        .map((u) => u.id);

      for (const kidDoc of childrenSnap.docs) {
        const kidId = kidDoc.id;
        const kidName = (kidDoc.data().name as string | undefined) || kidId.slice(0, 6);
        kidsScanned++;

        // Pull every reflection in the 7-day window (one equality filter).
        const refSnap = await famDoc.ref.collection('sparks_reflections')
          .where('kidId', '==', kidId)
          .get();
        const entries: AIEntry[] = refSnap.docs
          .map((r) => r.data() as { date?: string; text?: string })
          .filter((r) => r.date && window.includes(r.date))
          .map((r) => ({ date: r.date as string, text: (r.text || '').trim() }))
          .filter((r) => r.text.length > 0)
          .sort((a, b) => a.date.localeCompare(b.date));

        if (entries.length === 0) { skipped++; continue; }

        const ai = await callReviewAPI({ kidName, weekKey, entries });
        if (!ai) { skipped++; continue; }

        const docId = `${kidId}_${weekKey}`;
        const docRef = famDoc.ref.collection('sparks_reflection_weeks').doc(docId);
        await docRef.set({
          kidId,
          weekKey,
          weekStart,
          weekEnd,
          loggedDays: entries.length,
          streakAtGen: entries.length, // best-effort approximation; full streak math is client-side
          themes:       Array.isArray(ai.themes)       ? ai.themes       : [],
          highlights:   Array.isArray(ai.highlights)   ? ai.highlights   : [],
          mood_by_day:  Array.isArray(ai.mood_by_day)  ? ai.mood_by_day  : [],
          mood_summary: String(ai.mood_summary || ''),
          tip:          String(ai.tip || ''),
          highlight_for_parent: String(ai.highlight_for_parent || ''),
          generatedAt:  FieldValue.serverTimestamp(),
        }).catch(() => {});

        // 🔔 in-app — kid + parents.
        const link = '/sparks';
        for (const uid of [kidId, ...parentIds]) {
          await famDoc.ref.collection('notifications').add({
            type: 'sparks-reflection-week',
            title: `🪞 Your week in reflection`,
            message: String(ai.highlight_for_parent || ai.mood_summary || 'Tap to see this week’s highlights.').slice(0, 160),
            read: false,
            forUserId: uid,
            link,
            createdAt: FieldValue.serverTimestamp(),
          }).catch(() => {});
        }

        generated++;
      }
    } catch {
      continue;
    }
  }

  return NextResponse.json({ ok: true, today, weekKey, families, kidsScanned, generated, skipped });
}

export async function GET(req: NextRequest)  { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
