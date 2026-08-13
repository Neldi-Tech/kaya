// 🌟 Recognition Rounds — the cadenced nudge engine (RR PR-1).
//
// Hourly cron. Per family, gated by recognitionConfig: on configured local
// weekdays, at/after the configured local hour, computes ONE round per day
// (doc-id = local YYYY-MM-DD, created with .create() so a concurrent run
// can never double-fire) and nudges the reviewer audience by 🔔 bell +
// 📧 traced email.
//
// The round is coverage-FIRST: the kid who has waited longest since their
// last award always leads. Then a rotating lens (best / most-improved /
// comeback) so the same top kid never monopolizes the shine, then the
// weekly best if distinct. Celebrating a round rides the EXISTING award
// rail — this module never mints recognition records of its own.
//
// Timezone: closed-beta constant like the other engines (pulse-scan,
// reminders) — when a per-family timezone lands, they all adopt it
// together.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = 'Africa/Dar_es_Salaam';
const ROUND_TEMPLATE_VERSION = 1;

type Rating = {
  childId: string;
  date: string;
  ratings?: Record<string, string>;
};
type AwardDoc = {
  childId: string;
  kind?: string;
  points?: number;
  createdAt?: { toMillis?: () => number };
};
type RoundItem = {
  kidId: string;
  kidName: string;
  emoji: string;
  kind: 'coverage' | 'best' | 'improved' | 'comeback';
  line: string;
  daysSince?: number;
};

function localParts(d: Date): { hour: number; dow: number; dayKey: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: parseInt(parts.hour, 10),
    dow: dowMap[parts.weekday] ?? new Date(d).getUTCDay(),
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Excellent-rate over a set of rating docs: {rated, excellent, pct}. */
function excellentRate(rows: Rating[]): { rated: number; excellent: number; pct: number } {
  let rated = 0, excellent = 0;
  for (const r of rows) {
    for (const v of Object.values(r.ratings || {})) {
      if (v === 'skip') continue;
      rated++;
      if (v === 'excellent') excellent++;
    }
  }
  return { rated, excellent, pct: rated ? Math.round((excellent / rated) * 100) : 0 };
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if ((req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const now = new Date();
  const { hour, dow, dayKey } = localParts(now);

  const apiKey = process.env.RESEND_API_KEY;
  const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
  const resend = apiKey ? new Resend(apiKey) : null;

  const famSnap = await db.collection('families').get();
  let fired = 0;

  for (const famDoc of famSnap.docs) {
    try {
      const fam = famDoc.data() as {
        recognitionConfig?: {
          active?: boolean; days?: number[]; hourLocal?: number;
          audienceUids?: string[]; channels?: { bell?: boolean; email?: boolean };
        };
      };
      const cfg = {
        active: fam.recognitionConfig?.active ?? true,
        days: fam.recognitionConfig?.days ?? [2, 5],
        hourLocal: fam.recognitionConfig?.hourLocal ?? 18,
        audienceUids: fam.recognitionConfig?.audienceUids ?? [],
        channels: {
          bell: fam.recognitionConfig?.channels?.bell ?? true,
          email: fam.recognitionConfig?.channels?.email ?? true,
        },
      };
      if (!cfg.active || !cfg.days.includes(dow) || hour < cfg.hourLocal) continue;

      const famRef = famDoc.ref;
      const roundRef = famRef.collection('recognitionRounds').doc(dayKey);
      if ((await roundRef.get()).exists) continue;

      // ── Children ────────────────────────────────────────────────
      const kidsSnap = await famRef.collection('children').get();
      const kids = kidsSnap.docs.map((d) => {
        const k = d.data() as { name?: string; avatarEmoji?: string };
        return { id: d.id, name: (k.name || 'Kid').split(' ')[0], emoji: k.avatarEmoji || '🧒' };
      });
      if (kids.length === 0) continue;

      // ── Awards (last 60 days) → days-since-last per kid ─────────
      const since = new Date(now.getTime() - 60 * 86400_000);
      const awardsSnap = await famRef.collection('awards').where('createdAt', '>=', since).get();
      const lastAwardMs = new Map<string, number>();
      for (const d of awardsSnap.docs) {
        const a = d.data() as AwardDoc;
        // Reducing/improvement notes are corrections, not celebrations.
        if (a.kind === 'reducing' || a.kind === 'improvement_note' || (a.points ?? 0) < 0) continue;
        const ms = a.createdAt?.toMillis?.() ?? 0;
        if (ms > (lastAwardMs.get(a.childId) || 0)) lastAwardMs.set(a.childId, ms);
      }
      const daysSince = (kidId: string): number => {
        const ms = lastAwardMs.get(kidId);
        if (!ms) return 999; // never (within the window) — leads coverage
        return Math.floor((now.getTime() - ms) / 86400_000);
      };

      // ── Ratings (last 14 days) → weekly rates per kid ───────────
      const day14 = new Date(now.getTime() - 14 * 86400_000).toISOString().slice(0, 10);
      const day7 = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
      const ratingsSnap = await famRef.collection('ratings').where('date', '>=', day14).get();
      const byKid = new Map<string, Rating[]>();
      for (const d of ratingsSnap.docs) {
        const r = d.data() as Rating;
        const list = byKid.get(r.childId) || [];
        list.push(r);
        byKid.set(r.childId, list);
      }
      const thisWeek = (kidId: string) => excellentRate((byKid.get(kidId) || []).filter((r) => r.date >= day7));
      const priorWeek = (kidId: string) => excellentRate((byKid.get(kidId) || []).filter((r) => r.date < day7));

      // ── Items — coverage FIRST, then rotating lens, then best ───
      const items: RoundItem[] = [];
      const used = new Set<string>();

      const covKid = [...kids].sort((a, b) => daysSince(b.id) - daysSince(a.id))[0];
      const covDays = daysSince(covKid.id);
      if (covDays >= 4) {
        items.push({
          kidId: covKid.id, kidName: covKid.name, emoji: covKid.emoji, kind: 'coverage',
          daysSince: covDays === 999 ? undefined : covDays,
          line: covDays === 999
            ? `${covKid.name} — no award on record yet. First shine tonight?`
            : `${covKid.name} — ${covDays} days since the last award. Longest wait in the family.`,
        });
        used.add(covKid.id);
      }

      const roundCount = (await famRef.collection('recognitionRounds').count().get()).data().count;
      const lens = (['best', 'improved', 'comeback'] as const)[roundCount % 3];

      const bestPick = (): RoundItem | null => {
        const ranked = kids
          .filter((k) => !used.has(k.id))
          .map((k) => ({ k, r: thisWeek(k.id) }))
          .filter((x) => x.r.rated >= 4)
          .sort((a, b) => b.r.pct - a.r.pct)[0];
        if (!ranked) return null;
        return {
          kidId: ranked.k.id, kidName: ranked.k.name, emoji: ranked.k.emoji, kind: 'best',
          line: `${ranked.k.name} — best week: ${ranked.r.pct}% Excellent across ${ranked.r.rated} ratings.`,
        };
      };
      const improvedPick = (): RoundItem | null => {
        const ranked = kids
          .filter((k) => !used.has(k.id))
          .map((k) => ({ k, a: priorWeek(k.id), b: thisWeek(k.id) }))
          .filter((x) => x.a.rated >= 4 && x.b.rated >= 4 && x.b.pct - x.a.pct >= 10)
          .sort((x, y) => (y.b.pct - y.a.pct) - (x.b.pct - x.a.pct))[0];
        if (!ranked) return null;
        return {
          kidId: ranked.k.id, kidName: ranked.k.name, emoji: ranked.k.emoji, kind: 'improved',
          line: `${ranked.k.name} — most improved: ${ranked.a.pct}% → ${ranked.b.pct}% in two weeks. 🏵️`,
        };
      };
      const comebackPick = (): RoundItem | null => {
        for (const k of kids) {
          if (used.has(k.id)) continue;
          const rows = (byKid.get(k.id) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
          const days = new Map<string, { exc: number; bad: number }>();
          for (const r of rows) {
            const d = days.get(r.date) || { exc: 0, bad: 0 };
            for (const v of Object.values(r.ratings || {})) {
              if (v === 'excellent') d.exc++;
              if (v === 'bad') d.bad++;
            }
            days.set(r.date, d);
          }
          const keys = [...days.keys()].sort();
          const hadRough = keys.slice(0, -3).some((d) => (days.get(d)!.bad) > 0);
          const lastThree = keys.slice(-3);
          const cleanRun = lastThree.length === 3 && lastThree.every((d) => days.get(d)!.exc > 0 && days.get(d)!.bad === 0);
          if (hadRough && cleanRun) {
            return {
              kidId: k.id, kidName: k.name, emoji: k.emoji, kind: 'comeback',
              line: `${k.name} — comeback: three clean days in a row after a rough patch. 💪`,
            };
          }
        }
        return null;
      };

      const lensItem = lens === 'best' ? bestPick() : lens === 'improved' ? (improvedPick() || bestPick()) : (comebackPick() || bestPick());
      if (lensItem) { items.push(lensItem); used.add(lensItem.kidId); }
      if (lens !== 'best') {
        const extra = bestPick();
        if (extra) { items.push(extra); used.add(extra.kidId); }
      }
      if (items.length === 0) continue; // nothing worth nudging about

      // ── Audience ────────────────────────────────────────────────
      const usersSnap = await db.collection('users').where('familyId', '==', famDoc.id).get();
      const audience = usersSnap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as { role?: string; email?: string; displayName?: string }) }))
        .filter((u) => cfg.audienceUids.length > 0 ? cfg.audienceUids.includes(u.uid) : u.role === 'parent');
      if (audience.length === 0) continue;

      // ── Write the round (create = concurrency-safe idempotency) ─
      await roundRef.create({
        date: dayKey,
        lens,
        items,
        sentTo: audience.map((u) => u.uid),
        channels: cfg.channels,
        templateVersion: ROUND_TEMPLATE_VERSION,
        createdAt: FieldValue.serverTimestamp(),
      });
      fired++;

      // ── 🔔 Bells ────────────────────────────────────────────────
      if (cfg.channels.bell) {
        for (const u of audience) {
          await famRef.collection('notifications').add({
            type: 'reminder',
            forUserId: u.uid,
            title: '🌟 Recognition round',
            message: items[0].line,
            read: false,
            link: `/award?round=${dayKey}`,
            createdAt: new Date(),
          }).catch(() => { /* bell is best-effort */ });
        }
      }

      // ── 📧 Email (traced) ───────────────────────────────────────
      if (cfg.channels.email && resend) {
        const to = audience.map((u) => u.email).filter((e): e is string => !!e);
        if (to.length > 0) {
          const rows = items.map((i) =>
            `<tr><td style="padding:8px 12px;background:#F7F1E3;border-radius:10px;font-size:14px;color:#1E120B"><b>${i.emoji} ${i.line}</b></td></tr>
             <tr><td style="height:8px"></td></tr>`).join('');
          const html =
            `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9B8A72;font-weight:800;margin:0">🌟 Kaya · Recognition round</p>
              <p style="font-size:15px;color:#1E120B;margin:10px 0 16px">A minute to make someone's week — here's who's shining (and who's waiting):</p>
              <table style="width:100%;border-collapse:collapse">${rows}</table>
              <p style="margin:18px 0 0"><a href="https://www.ourkaya.com/award?round=${dayKey}" style="background:#D4A017;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:10px 22px;border-radius:999px;display:inline-block">🎉 Celebrate now</a></p>
              <p style="font-size:11px;color:#9B8A72;margin:14px 0 0">Two taps: the award sheet comes pre-filled. Unanswered items carry to the next round.</p>
            </div>`;
          let sent = false, error: string | undefined;
          try {
            await resend.emails.send({ from: FROM, to, subject: `🌟 Recognition round — ${items[0].kidName} & family`, html });
            sent = true;
          } catch (e) {
            error = e instanceof Error ? e.message : 'send failed';
          }
          await famRef.collection('alertLog').add({
            kind: 'recognition_round',
            firedAt: Date.now(),
            trigger: `round ${dayKey} · lens ${lens}`,
            sourceLabel: '🌟 Recognition round',
            roundDate: dayKey,
            channels: {
              email: {
                on: true, sent, ...(error ? { error } : {}),
                to: audience.filter((u) => u.email).map((u) => ({ name: u.displayName || 'Parent', email: u.email as string })),
                subject: `🌟 Recognition round — ${items[0].kidName} & family`,
                templateVersion: ROUND_TEMPLATE_VERSION,
              },
            },
          }).catch(() => { /* trace is best-effort */ });
        }
      }
    } catch {
      continue; // one family's failure never blocks the rest
    }
  }

  return NextResponse.json({ ok: true, dayKey, fired });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
