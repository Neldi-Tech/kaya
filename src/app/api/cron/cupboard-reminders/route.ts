// Kaya Sparks · Treasures 2.0 — 🗄 Cupboard reminders (hourly).
//
// Two gentle loops, neither of which ever emails (D32):
//
//   📖 Reading (D32) — for every open reading whose reminder says today
//      at this hour: ONE bell + push to the reader ("📖 Read? Percy
//      Jackson — p.42 of 375"). It is also already sitting on My Day /
//      the Workplan as a real to-do. If a KID's reading has gone quiet
//      for `quietLineDays` (default 7), ONE quiet line to the parents,
//      at most once a week, traced in alertLog as a bell — never an
//      alarm, never a deduction (D7).
//
//   🎲 Game Night (D38 · C5) — on the family's chosen day + time: one
//      push to parents + kids, "Family fun tonight?", linking to the
//      Picker. (Wired in C5; the cadence lives in Cupboard settings.)
//
// Own route (not treasure-reminders) so the Keeper-Check ladder and this
// can evolve without touching each other — and so the parallel
// Treasures workstream never collides with it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminMessaging } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';
const ENDED = ['handed_on', 'donated', 'sold', 'outgrown', 'retired'];

function dayKeyTZ(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function hourTZ(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? '0');
  return h === 24 ? 0 : h;
}
function minuteTZ(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, minute: '2-digit' }).formatToParts(d);
  return Number(p.find((x) => x.type === 'minute')?.value ?? '0');
}
function dowOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, (tm || 1) - 1, td || 1) - Date.UTC(fy, (fm || 1) - 1, fd || 1)) / 86400000);
}
/** Mirrors isReadingDay() in the Cupboard gateway. */
function isReadingDay(mode: string, startedOn: string, today: string): boolean {
  if (mode === 'off') return false;
  if (mode === 'daily') return true;
  if (mode === 'weekdays') { const w = dowOf(today); return w >= 1 && w <= 5; }
  if (mode === 'weekly') return dowOf(today) === dowOf(startedOn || today);
  return false;
}

interface Reading {
  id?: string; readerKidId?: string; readerUid?: string; readerName?: string;
  readNo?: number; startedOn?: string; pages?: number; currentPage?: number;
  lastMarkOn?: string; finishedOn?: string;
  reminder?: { mode?: string; hour?: number };
  lastNudgeOn?: string; quietLineOn?: string;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  const messaging = getAdminMessaging();

  const now = new Date();
  const today = dayKeyTZ(now);
  const hour = hourTZ(now);
  const minute = minuteTZ(now);

  let families = 0, nudges = 0, quietLines = 0, gameNights = 0;

  const push = async (uid: string, title: string, body: string, url: string, tag: string) => {
    if (!messaging) return;
    try {
      const toks = await db.collection('users').doc(uid).collection('fcmTokens').get();
      const tokens = toks.docs.map((t) => t.id);
      if (!tokens.length) return;
      await messaging.sendEachForMulticast({ tokens, data: { title, body: body.slice(0, 160), url, tag } });
    } catch { /* best-effort */ }
  };

  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    families++;
    try {
      const col = famDoc.ref.collection('sparks_treasures');
      const settingsSnap = await famDoc.ref.collection('sparks_treasure_private').doc('cupboard__settings').get();
      const s = (settingsSnap.exists ? settingsSnap.data() : {}) as {
        reading?: { quietLineDays?: number };
        gameNight?: { enabled?: boolean; dayOfWeek?: number; hour?: number; minute?: number };
        lastGameNightOn?: string;
      };
      const quietLineDays = Number.isFinite(Number(s.reading?.quietLineDays)) ? Number(s.reading?.quietLineDays) : 7;

      // Cheapest exit: no books on the shelf at all.
      const bSnap = await col.where('categoryId', '==', 'book').get();
      const gSnap = await col.where('categoryId', '==', 'game').limit(1).get();
      if (bSnap.empty && gSnap.empty) continue;

      let kidsLoaded = false;
      const kidUid = new Map<string, string>();
      const kidNames = new Map<string, string>();
      let parentUids: string[] = [];
      const loadPeople = async () => {
        if (kidsLoaded) return;
        kidsLoaded = true;
        const kids = await famDoc.ref.collection('children').get();
        for (const k of kids.docs) {
          const d = k.data() as { uid?: string; name?: string };
          if (d.uid) kidUid.set(k.id, d.uid);
          kidNames.set(k.id, (d.name || 'Your child').split(' ')[0]);
        }
        const users = await db.collection('users').where('familyId', '==', famDoc.id).get();
        parentUids = users.docs.filter((u) => (u.data().role || '') === 'parent').map((u) => u.id);
      };

      // ── 📖 reading reminders ─────────────────────────────────────
      for (const doc of bSnap.docs) {
        const t = doc.data() as { name?: string; emoji?: string; status?: string; readings?: Reading[]; kidId?: string };
        if (ENDED.includes(String(t.status))) continue;
        const readings = Array.isArray(t.readings) ? t.readings : [];
        if (!readings.some((r) => !r.finishedOn)) continue;
        await loadPeople();
        let changed = false;
        const next = readings.map((r) => ({ ...r }));
        const link = `/sparks/treasures/cupboard/${doc.id}`;
        const label = `${t.emoji || '📖'} ${t.name || 'your book'}`;

        for (const r of next) {
          if (r.finishedOn) continue;
          const mode = String(r.reminder?.mode || 'off');
          const atHour = Number.isFinite(Number(r.reminder?.hour)) ? Number(r.reminder?.hour) : 19;
          const readerUid = r.readerKidId ? kidUid.get(String(r.readerKidId)) : String(r.readerUid || '');
          const where = r.pages ? `p.${r.currentPage || 0} of ${r.pages}` : `page ${r.currentPage || 0}`;

          // ① the nudge — once per reading day, at the chosen hour, only
          //    if no page was marked today.
          if (mode !== 'off' && atHour === hour && isReadingDay(mode, String(r.startedOn || today), today)
              && r.lastMarkOn !== today && r.lastNudgeOn !== today && readerUid) {
            await famDoc.ref.collection('notifications').add({
              type: 'cupboard-read',
              title: `📖 Read tonight? ${t.name || ''}`.trim(),
              message: `You’re at ${where}. A few pages, then two lines about it.`,
              read: false, forUserId: readerUid, link,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(readerUid, `📖 Read? ${t.name || ''}`.trim(), `You’re at ${where}.`, link, 'cupboard-read');
            r.lastNudgeOn = today; changed = true; nudges++;
          }

          // ② the quiet line — a KID's reading silent for N days → one
          //    bell to parents, at most once a week. Never email (D32).
          if (quietLineDays > 0 && r.readerKidId && parentUids.length) {
            const since = String(r.lastMarkOn || r.startedOn || today);
            const silent = daysBetween(since, today);
            const lastLine = r.quietLineOn ? daysBetween(String(r.quietLineOn), today) : 99;
            if (silent >= quietLineDays && lastLine >= 7 && hour === 18) {
              const kid = kidNames.get(String(r.readerKidId)) || r.readerName || 'Your child';
              for (const p of parentUids) {
                await famDoc.ref.collection('notifications').add({
                  type: 'cupboard-quiet',
                  title: `📖 ${kid}’s book has gone quiet`,
                  message: `${t.name || 'The book'} — no page marked for ${silent} days. A nudge from you goes a long way.`,
                  read: false, forUserId: p, link,
                  createdAt: FieldValue.serverTimestamp(),
                }).catch(() => {});
              }
              await famDoc.ref.collection('alertLog').add({
                kind: 'cupboard_reading_quiet',
                firedAt: Date.now(),
                trigger: `${kid} — ${t.name || 'book'} silent ${silent} days (≥ ${quietLineDays})`,
                sourceLabel: `📖 ${label}`,
                kidId: String(r.readerKidId),
                day: today,
                channels: { bell: { on: true, to: parentUids.length } },
              }).catch(() => {});
              r.quietLineOn = today; changed = true; quietLines++;
            }
          }
        }
        if (changed) await doc.ref.update({ readings: next }).catch(() => {});
      }

      // ── 🎲 Game Night (D38) — fires once on the chosen day + time ──
      const gn = s.gameNight;
      if (gn && gn.enabled !== false && !gSnap.empty) {
        const day = Number.isFinite(Number(gn.dayOfWeek)) ? Number(gn.dayOfWeek) : 5;
        const atHour = Number.isFinite(Number(gn.hour)) ? Number(gn.hour) : 18;
        const atMinute = [0, 15, 30, 45].includes(Number(gn.minute)) ? Number(gn.minute) : 30;
        // Hourly cron at :20 — fire in the hour slot the family chose
        // (minute is a display preference; the push says the real time).
        void minute;
        if (dowOf(today) === day && hour === atHour && s.lastGameNightOn !== today) {
          await loadPeople();
          const when = `${String(atHour).padStart(2, '0')}:${String(atMinute).padStart(2, '0')}`;
          const link = '/sparks/treasures/cupboard/games?pick=1';
          const all = [...parentUids, ...Array.from(kidUid.values())];
          for (const u of all) {
            await famDoc.ref.collection('notifications').add({
              type: 'cupboard-gamenight',
              title: '🎲 Family fun tonight?',
              message: `Game night at ${when} — Kaya can pick something that fits who’s in.`,
              read: false, forUserId: u, link,
              createdAt: FieldValue.serverTimestamp(),
            }).catch(() => {});
            await push(u, '🎲 Family fun tonight?', `Game night at ${when} — tap to pick.`, link, 'cupboard-gamenight');
          }
          await settingsSnap.ref.set({ lastGameNightOn: today }, { merge: true }).catch(() => {});
          gameNights++;
        }
      }
    } catch { /* one family never blocks the rest */ }
  }

  return NextResponse.json({ ok: true, today, hour, families, nudges, quietLines, gameNights });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
