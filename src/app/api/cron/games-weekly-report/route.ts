// Kaya Games — weekly parent report (Vercel cron, Sundays 7pm).
//
// For each family with game activity in the last 7 days, emails the parents a
// per-kid round-up (plays, games tried, House Points earned, mood trend).
// Admin-SDK reads + Resend email — no rules deploy. No-ops cleanly without
// admin creds or a Resend key.
//
// Note: scans each family's gamePlays once per week (unbounded). Fine at beta
// scale; bound it (by weekKey + a rollup) before wide launch.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';
import { getGame } from '@/lib/gamesCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const resend = apiKey ? new Resend(apiKey) : null;

interface KidRollup { plays: number; points: number; games: Set<string>; moods: number[] }

const MOOD = ['', '😢', '😟', '😐', '🙂', '😄'];

function buildHtml(rows: { name: string; r: KidRollup }[]): string {
  const items = rows.map(({ name, r }) => {
    const moodAvg = r.moods.length ? r.moods.reduce((a, b) => a + b, 0) / r.moods.length : null;
    const topGame = [...r.games].map((id) => getGame(id)?.name).filter(Boolean)[0];
    return `
      <tr>
        <td style="padding:10px 12px;font-weight:700;color:#1A1240;">${name}</td>
        <td style="padding:10px 12px;color:#5A4F7A;">${r.plays} play${r.plays === 1 ? '' : 's'} · ${r.games.size} game${r.games.size === 1 ? '' : 's'}</td>
        <td style="padding:10px 12px;font-weight:800;color:#6B3FE0;">${r.points} pts</td>
        <td style="padding:10px 12px;color:#5A4F7A;">${moodAvg != null ? `${MOOD[Math.round(moodAvg)] || ''} ${moodAvg.toFixed(1)}/5` : ''}</td>
      </tr>${topGame ? `<tr><td colspan="4" style="padding:0 12px 10px;color:#9b8aa8;font-size:12px;">Favourite: ${topGame}</td></tr>` : ''}`;
  }).join('');

  return `
  <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;background:#F5F0FF;padding:24px;border-radius:16px;">
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:32px;">🎮</div>
      <h1 style="font-size:20px;color:#1A1240;margin:4px 0;">Your family's Kaya Games week</h1>
      <p style="color:#5A4F7A;font-size:13px;margin:0;">Here's how the kids played this week.</p>
    </div>
    <table style="width:100%;background:#fff;border-radius:12px;border-collapse:collapse;overflow:hidden;">
      ${items}
    </table>
    <p style="color:#9b8aa8;font-size:12px;text-align:center;margin-top:16px;">
      House Points earned are the ones you approved. Tune each game's value in Games → 🛡️ Controls.
    </p>
  </div>`;
}

async function run() {
  const db = getAdminFirestore();
  if (!db) return { skipped: true, reason: 'admin-sdk-not-configured' };
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const families = await db.collection('families').get();
  let familiesWithActivity = 0;
  let emailsSent = 0;

  for (const fam of families.docs) {
    const familyId = fam.id;
    const playsSnap = await db.collection('families').doc(familyId).collection('gamePlays').get();
    const plays = playsSnap.docs
      .map((d) => d.data() as { kidId?: string; gameId?: string; pointsAwarded?: number; score?: number | null; createdAt?: number })
      .filter((p) => (Number(p.createdAt) || 0) >= since);
    if (plays.length === 0) continue;
    familiesWithActivity++;

    const kidsSnap = await db.collection('families').doc(familyId).collection('children').get();
    const kidName: Record<string, string> = {};
    kidsSnap.forEach((k) => { kidName[k.id] = (k.data() as { name?: string }).name || 'Your child'; });

    const perKid: Record<string, KidRollup> = {};
    for (const p of plays) {
      const kid = String(p.kidId || '');
      if (!kid) continue;
      const e = perKid[kid] || (perKid[kid] = { plays: 0, points: 0, games: new Set(), moods: [] });
      e.plays += 1;
      e.points += Number(p.pointsAwarded) || 0;
      if (p.gameId) e.games.add(String(p.gameId));
      if (p.gameId === 'mood-checkin' && typeof p.score === 'number') e.moods.push(p.score);
    }
    const rows = Object.entries(perKid).map(([kid, r]) => ({ name: kidName[kid] || 'Your child', r }));
    if (rows.length === 0) continue;

    const parentsSnap = await db.collection('users')
      .where('familyId', '==', familyId).where('role', '==', 'parent').get();
    const tos = parentsSnap.docs
      .map((d) => (d.data() as { email?: string }).email)
      .filter((e): e is string => !!e);
    if (!resend || tos.length === 0) continue;

    const html = buildHtml(rows);
    for (const to of tos) {
      try {
        await resend.emails.send({ from: FROM, to, subject: "🎮 Your family's Kaya Games week", html });
        emailsSent += 1;
      } catch { /* skip a bad address, keep going */ }
    }
  }

  return { ok: true, familiesWithActivity, emailsSent };
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authz = req.headers.get('authorization') || '';
    if (authz !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await run());
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
