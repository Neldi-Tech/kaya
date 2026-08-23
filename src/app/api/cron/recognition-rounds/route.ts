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
import {
  buildDismissMemory, isSuppressed, dismissKey, DISMISS_MEMORY_DAYS,
  type DismissalRecord, type RoundDismissal,
} from '@/lib/recognitionDismiss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TZ = 'Africa/Dar_es_Salaam';
const ROUND_TEMPLATE_VERSION = 2; // 2 = ✕ dismiss-aware (DL PR-A)

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
  kind: 'coverage' | 'best' | 'improved' | 'comeback' | 'leader';
  line: string;
  daysSince?: number;
  /** 👑 LW PR-L5 — the sealed leaderTerm this item celebrates. */
  termId?: string;
  /** 🎁 FX PR-6 — the engine's gift recommendation for this kid: nearest
   *  within-reach store reward NOT given recently (the system remembers
   *  via shineCards.giftMeta). */
  giftIdea?: { label: string; rewardId: string };
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
        const k = d.data() as { name?: string; avatarEmoji?: string; totalPoints?: number };
        return { id: d.id, name: (k.name || 'Kid').split(' ')[0], emoji: k.avatarEmoji || '🧒', totalPoints: k.totalPoints || 0 };
      });
      if (kids.length === 0) continue;

      // 🧠 DL PR-A — what the parents taught Kaya: dismissals in the last
      // 60 days → coverage clocks, paused kids, paused kinds, dismissed
      // crowns. Applied before every pick below.
      const dismissSnap = await famRef.collection('recognitionDismissals')
        .where('at', '>=', now.getTime() - DISMISS_MEMORY_DAYS * 86400_000).get()
        .catch(() => null);
      const mem = buildDismissMemory(
        (dismissSnap?.docs || []).map((d) => d.data() as DismissalRecord),
        now.getTime(),
      );
      const suppressed = (kidId: string, kind: string) => isSuppressed(mem, kidId, kind, now.getTime());

      // 🎁 FX PR-6 — gift recommendation engine: active store rewards vs
      // each kid's spendable, EXCLUDING gifts recorded on their cards in
      // the last 45 days (the system remembers what was given).
      const rewardsSnap = await famRef.collection('rewards').get();
      const storeRewards = rewardsSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as { title?: string; icon?: string; pointsCost?: number; active?: boolean; kind?: string }) }))
        .filter((r) => r.active && r.kind !== 'family' && (r.pointsCost ?? 0) > 0);
      const recentCardsSnap = await famRef.collection('shineCards')
        .where('at', '>=', now.getTime() - 45 * 86400_000).get();
      const givenRewardIds = new Map<string, Set<string>>();
      for (const d of recentCardsSnap.docs) {
        const c = d.data() as { kidId?: string; giftMeta?: { rewardId?: string } };
        if (!c.kidId || !c.giftMeta?.rewardId) continue;
        const set = givenRewardIds.get(c.kidId) || new Set<string>();
        set.add(c.giftMeta.rewardId);
        givenRewardIds.set(c.kidId, set);
      }
      const cfgFloor = (fam as { rewardsConfig?: { minPointsFloor?: number; minPointsFloorPerKid?: Record<string, number> } }).rewardsConfig;
      const giftIdeaFor = (kidId: string): { label: string; rewardId: string } | undefined => {
        const kid = kids.find((k) => k.id === kidId);
        if (!kid) return undefined;
        const floor = cfgFloor?.minPointsFloorPerKid?.[kidId] ?? cfgFloor?.minPointsFloor ?? 0;
        const spendable = Math.max(0, kid.totalPoints - floor);
        const given = givenRewardIds.get(kidId) || new Set<string>();
        const fresh = storeRewards.filter((r) => !given.has(r.id));
        const within = fresh.filter((r) => (r.pointsCost ?? 0) <= spendable).sort((a, b) => (b.pointsCost ?? 0) - (a.pointsCost ?? 0))[0];
        const stretch = fresh.filter((r) => (r.pointsCost ?? 0) > spendable).sort((a, b) => (a.pointsCost ?? 0) - (b.pointsCost ?? 0))[0];
        const pick = within || stretch;
        return pick ? { label: `${pick.icon || '🎁'} ${pick.title || 'Reward'}`, rewardId: pick.id } : undefined;
      };

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
        // 🧠 "already recognized" / "away" dismissals count as the last
        // award FOR COVERAGE ONLY (no points, no card).
        const ms = Math.max(lastAwardMs.get(kidId) || 0, mem.coverageClock.get(kidId) || 0);
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

      const covKid = kids.filter((k) => !suppressed(k.id, 'coverage')).sort((a, b) => daysSince(b.id) - daysSince(a.id))[0];
      const covDays = covKid ? daysSince(covKid.id) : 0;
      if (covKid && covDays >= 4) {
        items.push({
          kidId: covKid.id, kidName: covKid.name, emoji: covKid.emoji, kind: 'coverage',
          ...(giftIdeaFor(covKid.id) ? { giftIdea: giftIdeaFor(covKid.id) } : {}),
          // ⚠️ never `undefined` in an Admin write — a never-awarded kid used
          // to make the WHOLE round write throw (silently: no round, no nudge).
          ...(covDays === 999 ? {} : { daysSince: covDays }),
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
          .filter((k) => !used.has(k.id) && !suppressed(k.id, 'best'))
          .map((k) => ({ k, r: thisWeek(k.id) }))
          .filter((x) => x.r.rated >= 4)
          .sort((a, b) => b.r.pct - a.r.pct)[0];
        if (!ranked) return null;
        return {
          kidId: ranked.k.id, kidName: ranked.k.name, emoji: ranked.k.emoji, kind: 'best',
          ...(giftIdeaFor(ranked.k.id) ? { giftIdea: giftIdeaFor(ranked.k.id) } : {}),
          line: `${ranked.k.name} — best week: ${ranked.r.pct}% Excellent across ${ranked.r.rated} ratings.`,
        };
      };
      const improvedPick = (): RoundItem | null => {
        const ranked = kids
          .filter((k) => !used.has(k.id) && !suppressed(k.id, 'improved'))
          .map((k) => ({ k, a: priorWeek(k.id), b: thisWeek(k.id) }))
          .filter((x) => x.a.rated >= 4 && x.b.rated >= 4 && x.b.pct - x.a.pct >= 10)
          .sort((x, y) => (y.b.pct - y.a.pct) - (x.b.pct - x.a.pct))[0];
        if (!ranked) return null;
        return {
          kidId: ranked.k.id, kidName: ranked.k.name, emoji: ranked.k.emoji, kind: 'improved',
          ...(giftIdeaFor(ranked.k.id) ? { giftIdea: giftIdeaFor(ranked.k.id) } : {}),
          line: `${ranked.k.name} — most improved: ${ranked.a.pct}% → ${ranked.b.pct}% in two weeks. 🏵️`,
        };
      };
      const comebackPick = (): RoundItem | null => {
        for (const k of kids) {
          if (used.has(k.id) || suppressed(k.id, 'comeback')) continue;
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
              ...(giftIdeaFor(k.id) ? { giftIdea: giftIdeaFor(k.id) } : {}),
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

      // ⏳ RR PR-4 — carry-over: items from the PREVIOUS round whose kid
      // was never celebrated in its 72h window ride into this round with a
      // "still waiting" flag, so coverage never silently drops.
      const prevSnap = await famRef.collection('recognitionRounds')
        .orderBy('date', 'desc').limit(1).get();
      if (!prevSnap.empty) {
        const prev = prevSnap.docs[0].data() as { date: string; items?: RoundItem[]; dismissed?: Record<string, RoundDismissal> };
        const prevStart = new Date(`${prev.date}T00:00:00`).getTime();
        const cardsSnap = await famRef.collection('shineCards')
          .where('at', '>=', prevStart).get();
        const celebratedKids = new Set(cardsSnap.docs.map((d) => (d.data() as { kidId?: string }).kidId));
        for (const it of prev.items || []) {
          if (celebratedKids.has(it.kidId) || used.has(it.kidId)) continue;
          // ✕ dismissed last round → parent already answered it; never carry.
          if (prev.dismissed?.[dismissKey(it.kidId, it.kind)]) continue;
          if (suppressed(it.kidId, it.kind)) continue;
          items.push({
            ...it,
            line: `${it.line} · ⏳ still waiting since ${prev.date.slice(8)}/${prev.date.slice(5, 7)}`,
          });
          used.add(it.kidId);
        }
      }
      // 👑 LW PR-L5 — a week as Leader of the Week sealed in the last 10
      // days and not yet celebrated → "celebrate the leader" item (even if
      // the kid is already in this round for another reason — the crown is
      // its own moment). Single-field range on sealedAt; flag filtered in code.
      try {
        const since10 = Date.now() - 10 * 86400_000;
        const termsSnap = await famRef.collection('leaderTerms').where('sealedAt', '>=', since10).get();
        const sealed = termsSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as { childId: string; name: string; emoji: string; style?: string; celebrated?: boolean; counts?: { approved: number; adjusted: number }; ledMeeting?: boolean; honest?: boolean; mission?: { done?: boolean }; sealedAt?: number }) }))
          .filter((t) => !t.celebrated && !mem.dismissedTerms.has(t.id))
          .sort((a, b) => (b.sealedAt || 0) - (a.sealedAt || 0));
        const seenKid = new Set<string>();
        for (const t of sealed) {
          if (seenKid.has(t.childId) || suppressed(t.childId, 'leader')) continue;
          seenKid.add(t.childId);
          const n = (t.counts?.approved || 0) + (t.counts?.adjusted || 0);
          items.push({
            kidId: t.childId, kidName: t.name, emoji: t.emoji || '🧒', kind: 'leader', termId: t.id,
            line: `👑 Celebrate ${t.name.split(' ')[0]}'s week as leader — ${t.style || 'New Leader'} · ${n} note${n === 1 ? '' : 's'} made a difference${t.ledMeeting ? ' · led the meeting' : ''}${t.honest ? ' · Honest ✓' : ''}${t.mission?.done ? ' · Mission ✓' : ''}`,
          });
        }
      } catch { /* best-effort */ }
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
        learnedFrom: mem.count,
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
            link: '/recognition',
            createdAt: new Date(),
          }).catch(() => { /* bell is best-effort */ });
        }
      }

      // ── 📧 Email (traced) ───────────────────────────────────────
      if (cfg.channels.email && resend) {
        const to = audience.map((u) => u.email).filter((e): e is string => !!e);
        if (to.length > 0) {
          const rows = items.map((i) =>
            `<tr><td style="padding:8px 12px;background:#F7F1E3;border-radius:10px;font-size:14px;color:#1E120B"><b>${i.emoji} ${i.line}</b>${i.giftIdea ? `<br/><span style="font-size:12px;color:#A87D0F;font-weight:700">🎁 gift idea: ${i.giftIdea.label}</span>` : ''}</td></tr>
             <tr><td style="height:8px"></td></tr>`).join('');
          const html =
            `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9B8A72;font-weight:800;margin:0">🌟 Kaya · Recognition round</p>
              <p style="font-size:15px;color:#1E120B;margin:10px 0 16px">A minute to make someone's week — here's who's shining (and who's waiting):</p>
              <table style="width:100%;border-collapse:collapse">${rows}</table>
              <p style="margin:18px 0 0"><a href="https://www.ourkaya.com/recognition" style="background:#D4A017;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:10px 22px;border-radius:999px;display:inline-block">🎉 Celebrate now</a></p>
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
