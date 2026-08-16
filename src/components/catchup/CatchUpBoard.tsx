'use client';

// ⏰ The Catch-Up Board — parent view (approved design 2026-08-10 · CU-2).
//
// Per-kid cards: On-Track % (🟢🟡🔴) + trend, cleared-count celebration
// FIRST, then open catch-ups (worst streak first) with three one-tap
// nudges each:
//   🔔 Remind now      in-app bell + push to the kid (parent-initiated —
//                      the board itself never auto-nags)
//   📌 On today's list an ad-hoc "Catch up:" item on the kid's My Day
//   🗣️ Raise on Sunday pins it for the Catch-Up Corner meeting step
//
// Header carries the family's visibility switch: kids see only their own
// strip ('own', default) or each other's scores too ('family').

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import { notifyCatchUpNudge } from '@/lib/notify';
import { addKidWorkplanItem, todayDateString } from '@/lib/kidWorkplan';
import {
  computeFamilyCatchUps, scoreMeta, trendLabel, CATCHUP_PERIODS,
  type KidCatchUps, type CatchUpItem, type CatchUpPeriod,
} from '@/lib/catchUpBoard';

const SCORE_CLS: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-600',
  none: 'bg-kaya-warm text-kaya-sand',
};

export default function CatchUpBoard() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const [rows, setRows] = useState<KidCatchUps[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // R2-2/R2-3 — standard period filter + collapsible kid cards (the
  // worst score auto-expands when a fresh compute lands).
  const [period, setPeriod] = useState<CatchUpPeriod>(7);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!family?.id || children.length === 0) return;
    let dead = false;
    setRows(null);
    computeFamilyCatchUps(family.id, children.map((c) => ({
      id: c.id, name: c.name, avatarEmoji: c.avatarEmoji,
    })), period).then((r) => {
      if (dead) return;
      setRows(r);
      const scored = r.filter((k) => k.onTrackPct != null);
      const worst = scored.sort((a, b) => (a.onTrackPct! - b.onTrackPct!))[0];
      setExpanded(new Set(worst ? [worst.childId] : []));
    }).catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [family?.id, children, period]);

  if (!family?.id || !profile?.familyId || children.length === 0) return null;

  const visibility = family.catchUpVisibility || 'own';

  const say = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2500); };

  const remindNow = (kid: KidCatchUps, item: CatchUpItem) => {
    const child = children.find((c) => c.id === kid.childId);
    const kidUid = (child as { uid?: string } | undefined)?.uid;
    if (!kidUid) { say(`${kid.name.split(' ')[0]} has no login yet — pinned to My Day instead.`); void pinToday(kid, item, true); return; }
    setBusyKey(`${kid.childId}:${item.key}:remind`);
    notifyCatchUpNudge({
      familyId: family.id, kidUid, kidName: kid.name,
      icon: item.icon, label: item.label, href: item.href,
    });
    setBusyKey(null);
    say(`🔔 Nudge sent to ${kid.name.split(' ')[0]}.`);
  };

  const pinToday = async (kid: KidCatchUps, item: CatchUpItem, silent = false) => {
    setBusyKey(`${kid.childId}:${item.key}:pin`);
    try {
      await addKidWorkplanItem(family.id, kid.childId, {
        label: `Catch up: ${item.label}`,
        icon: item.icon,
        category: 'other',
        daysOfWeek: [],
        kind: 'adhoc',
        scheduledDates: [todayDateString()],
        active: true,
        createdBy: profile.uid,
      });
      if (!silent) say(`📌 On ${kid.name.split(' ')[0]}'s list for today.`);
    } catch {
      say('Could not add it — please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const raiseSunday = async (kid: KidCatchUps, item: CatchUpItem) => {
    setBusyKey(`${kid.childId}:${item.key}:sunday`);
    try {
      const pins = { ...(family.catchUpPins || {}) };
      const list = pins[kid.childId] || [];
      if (!list.some((p) => p.key === item.key)) {
        pins[kid.childId] = [...list, { key: item.key, icon: item.icon, label: item.label }];
        await updateFamily(profile.familyId, { catchUpPins: pins });
      }
      say(`🗣️ On Sunday's Catch-Up Corner.`);
    } catch {
      say('Could not pin it — please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const setVisibility = (v: 'own' | 'family') => {
    void updateFamily(profile.familyId!, { catchUpVisibility: v }).catch(() => {});
  };

  return (
    <section className="mt-6 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-6">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-display text-lg font-black">⏰ Catch-Up Board</h2>
          <p className="text-[12px] text-kaya-sand mt-0.5">
            What each kid keeps skipping — chores, reflections, quests, treasures — honestly counted (sick days never count).
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">Kids see:</span>
          {([['own', 'Own only'], ['family', 'Each other']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setVisibility(v)}
              aria-pressed={visibility === v}
              className={`h-7 px-2.5 rounded-full text-[10.5px] font-extrabold border-2 transition-colors ${
                visibility === v ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate' : 'bg-white text-kaya-chocolate border-kaya-warm-dark'
              }`}>{label}</button>
          ))}
        </div>
      </div>

      {flash && (
        <p className="mt-3 text-[12px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-kaya-sm px-3 py-2">{flash}</p>
      )}

      {/* R2-3 — the standard period pills */}
      <div className="flex gap-1.5 mt-3">
        {CATCHUP_PERIODS.map((p) => (
          <button key={p.days} type="button" onClick={() => setPeriod(p.days)}
            aria-pressed={period === p.days}
            className={`px-3 py-1.5 rounded-full text-[10.5px] font-extrabold border-2 transition-colors ${
              period === p.days ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate' : 'bg-white text-kaya-chocolate border-kaya-warm-dark'
            }`}>{p.label}</button>
        ))}
      </div>

      {rows === null ? (
        <p className="mt-4 text-[12.5px] text-kaya-sand">Reading the days…</p>
      ) : (
        <>
        {/* R2-2 — statistics first: the family in one glance. Tap a chip
            to expand that kid below. */}
        {(() => {
          const due = rows.reduce((n, k) => n + k.due, 0);
          const done = rows.reduce((n, k) => n + k.done, 0);
          const famPct = due > 0 ? Math.round((done / due) * 100) : null;
          const famMeta = scoreMeta(famPct);
          const clearedTotal = rows.reduce((n, k) => n + k.cleared, 0);
          return (
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-2">
              <div className="rounded-kaya border border-kaya-warm-dark bg-kaya-cream/60 px-3 py-2.5 text-center">
                <p className="text-[16px] font-black">{famMeta.emoji} {famPct == null ? '—' : `${famPct}%`}</p>
                <p className="text-[9.5px] uppercase tracking-wider font-bold text-kaya-sand mt-0.5">Family on-track</p>
              </div>
              {rows.map((k) => {
                const m = scoreMeta(k.onTrackPct);
                const t = trendLabel(k);
                return (
                  <button key={k.childId} type="button"
                    onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(k.childId)) n.delete(k.childId); else n.add(k.childId); return n; })}
                    className={`rounded-kaya border px-3 py-2.5 text-center transition-colors ${expanded.has(k.childId) ? 'border-kaya-gold bg-kaya-gold/10' : 'border-kaya-warm-dark bg-white hover:border-kaya-sand'}`}>
                    <p className="text-[16px] font-black">{k.emoji} <span className={m.cls === 'green' ? 'text-emerald-600' : m.cls === 'amber' ? 'text-amber-600' : m.cls === 'red' ? 'text-red-500' : 'text-kaya-sand'}>{k.onTrackPct == null ? '—' : `${k.onTrackPct}%`}</span>{t ? ` ${t.startsWith('▲') ? '▲' : t.startsWith('▼') ? '▼' : '—'}` : ''}</p>
                    <p className="text-[9.5px] uppercase tracking-wider font-bold text-kaya-sand mt-0.5">{k.name.split(' ')[0]}</p>
                  </button>
                );
              })}
              <div className="rounded-kaya border border-kaya-warm-dark bg-kaya-cream/60 px-3 py-2.5 text-center">
                <p className="text-[16px] font-black text-emerald-600">👏 {clearedTotal}</p>
                <p className="text-[9.5px] uppercase tracking-wider font-bold text-kaya-sand mt-0.5">Cleared this period</p>
              </div>
            </div>
          );
        })()}

        <div className="mt-4 space-y-3">
          {rows.map((kid) => {
            const meta = scoreMeta(kid.onTrackPct);
            const trend = trendLabel(kid);
            const open = kid.items;
            const isOpen = expanded.has(kid.childId);
            return (
              <div key={kid.childId} className="border border-kaya-warm-dark rounded-kaya p-3.5">
                <button type="button" className="w-full flex items-center gap-2.5 flex-wrap text-left"
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(kid.childId)) n.delete(kid.childId); else n.add(kid.childId); return n; })}
                  aria-expanded={isOpen}>
                  <span className="text-xl">{kid.emoji}</span>
                  <span className="font-display font-black text-[14.5px] flex-1">{kid.name}</span>
                  {kid.choresPct != null && <span className="text-[10.5px] font-black px-2 py-0.5 rounded-full bg-kaya-warm text-kaya-chocolate">🧹 {kid.choresPct}%</span>}
                  {trend && <span className="text-[11px] font-bold text-kaya-sand">{trend}</span>}
                  <span className={`text-[12px] font-black px-2.5 py-1 rounded-full ${SCORE_CLS[meta.cls]}`}>
                    {meta.emoji} {meta.label}
                  </span>
                  <span className="text-kaya-sand font-black text-[12px]">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                <div>

                {kid.cleared > 0 && (
                  <p className="mt-2 text-[12.5px] font-bold text-emerald-700">
                    👏 Cleared {kid.cleared} catch-up{kid.cleared === 1 ? '' : 's'} this week{open.length === 0 ? ' — nothing open!' : ''}
                  </p>
                )}
                {kid.cleared === 0 && open.length === 0 && (
                  <p className="mt-2 text-[12.5px] text-kaya-sand">
                    {kid.onTrackPct == null ? 'Nothing was due this week.' : 'On rhythm — nothing to catch up. ✨'}
                  </p>
                )}

                {open.map((item) => (
                  <div key={item.key} className="mt-2.5 pt-2.5 border-t border-dashed border-kaya-warm-dark">
                    <p className="text-[13px] leading-snug">
                      <span className="mr-1">{item.icon}</span>
                      <b>{item.label}</b>
                    </p>
                    <p className="text-[11.5px] text-kaya-sand mt-0.5">{item.detail}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <button type="button" disabled={busyKey === `${kid.childId}:${item.key}:remind`}
                        onClick={() => remindNow(kid, item)}
                        className="px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold bg-kaya-gold-light text-kaya-chocolate border-2 border-kaya-gold/60 hover:bg-kaya-gold/40 disabled:opacity-50 transition-colors">
                        🔔 Remind now
                      </button>
                      <button type="button" disabled={busyKey === `${kid.childId}:${item.key}:pin`}
                        onClick={() => pinToday(kid, item)}
                        className="px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold bg-white text-kaya-chocolate border-2 border-kaya-warm-dark hover:border-kaya-sand disabled:opacity-50 transition-colors">
                        📌 Put on today&apos;s My Day
                      </button>
                      <button type="button" disabled={busyKey === `${kid.childId}:${item.key}:sunday`}
                        onClick={() => raiseSunday(kid, item)}
                        className={`px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold border-2 transition-colors disabled:opacity-50 ${
                          (family.catchUpPins?.[kid.childId] || []).some((p) => p.key === item.key)
                            ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate'
                            : 'bg-white text-kaya-chocolate border-kaya-warm-dark hover:border-kaya-sand'
                        }`}>
                        🗣️ {(family.catchUpPins?.[kid.childId] || []).some((p) => p.key === item.key) ? 'On Sunday ✓' : 'Raise on Sunday'}
                      </button>
                    </div>
                  </div>
                ))}
                </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}
      <p className="text-[10.5px] text-kaya-sand mt-3 leading-relaxed">
        🟢 ≥80% · 🟡 50–79% · 🔴 &lt;50% — done ÷ due across all lanes. The board only reads; nudges fire only when you tap. Skipped-3×-in-a-week items join Sunday&apos;s Catch-Up Corner automatically.
      </p>
    </section>
  );
}
