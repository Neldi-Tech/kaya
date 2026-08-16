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
  computeFamilyCatchUps, scoreMeta, trendLabel,
  type KidCatchUps, type CatchUpItem,
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

  useEffect(() => {
    if (!family?.id || children.length === 0) return;
    let dead = false;
    computeFamilyCatchUps(family.id, children.map((c) => ({
      id: c.id, name: c.name, avatarEmoji: c.avatarEmoji,
    }))).then((r) => { if (!dead) setRows(r); }).catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [family?.id, children]);

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
            What each kid keeps skipping — chores, reflections, quests, treasures — last 7 days, honestly counted (sick days never count).
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

      {rows === null ? (
        <p className="mt-4 text-[12.5px] text-kaya-sand">Reading the week…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((kid) => {
            const meta = scoreMeta(kid.onTrackPct);
            const trend = trendLabel(kid);
            const open = kid.items;
            return (
              <div key={kid.childId} className="border border-kaya-warm-dark rounded-kaya p-3.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-xl">{kid.emoji}</span>
                  <span className="font-display font-black text-[14.5px] flex-1">{kid.name}</span>
                  {trend && <span className="text-[11px] font-bold text-kaya-sand">{trend}</span>}
                  <span className={`text-[12px] font-black px-2.5 py-1 rounded-full ${SCORE_CLS[meta.cls]}`}>
                    {meta.emoji} {meta.label}
                  </span>
                </div>

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
            );
          })}
        </div>
      )}
      <p className="text-[10.5px] text-kaya-sand mt-3 leading-relaxed">
        🟢 ≥80% · 🟡 50–79% · 🔴 &lt;50% — done ÷ due across all lanes. The board only reads; nudges fire only when you tap. Skipped-3×-in-a-week items join Sunday&apos;s Catch-Up Corner automatically.
      </p>
    </section>
  );
}
