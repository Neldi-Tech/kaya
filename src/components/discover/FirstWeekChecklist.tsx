'use client';

// First Week Checklist — pinned to the top of Discover for new parents
// until they've tapped their first rate / award / reward / meeting /
// invite / moment (auto-detected). Reorders by the firstWeekIntent the
// parent picked on onboarding Step 4. Hides forever once all six are
// done (or via the user's per-session "Hide for now" link).

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  EMPTY_PROGRESS,
  FIRST_WEEK_TOTAL,
  countDone,
  orderItemsByIntent,
  primaryItemForIntent,
  readFirstWeekProgress,
  type FirstWeekIntent,
  type FirstWeekProgress,
} from '@/lib/firstWeek';
import { updateUserProfile } from '@/lib/firestore';

// Shape used by the lib's invite check — string OR object with `usedAt`.
// The real Family doc (from lib/firestore Family interface) is assignable
// to this loose shape via the `kid/helper/guest` keys.
type InviteCodeValue =
  | string
  | { usedAt?: { toMillis?: () => number } | null }
  | undefined;
type FamilyForChecklist = {
  inviteCodes?: Record<string, InviteCodeValue>;
} | null | undefined;

type Props = {
  uid: string;
  familyId: string;
  family: FamilyForChecklist;
  intent: FirstWeekIntent | null | undefined;
  alreadyCompleted: boolean;
};

const hideKey = (uid: string) => `kaya.firstWeek.hide.${uid}`;

export default function FirstWeekChecklist({
  uid,
  familyId,
  family,
  intent,
  alreadyCompleted,
}: Props) {
  const [progress, setProgress] = useState<FirstWeekProgress>(EMPTY_PROGRESS);
  const [hiddenForSession, setHiddenForSession] = useState(false);
  const [grad, setGrad] = useState(false);

  // localStorage hide-for-session check
  useEffect(() => {
    try {
      if (window.localStorage.getItem(hideKey(uid)) === '1') {
        setHiddenForSession(true);
      }
    } catch {
      /* private mode — fall through */
    }
  }, [uid]);

  // Read progress on mount + whenever family changes
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    (async () => {
      const p = await readFirstWeekProgress(familyId, family);
      if (!cancelled) setProgress(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, family]);

  const done = countDone(progress);
  const allDone = done >= FIRST_WEEK_TOTAL;
  const itemsInOrder = useMemo(() => orderItemsByIntent(intent), [intent]);
  const primaryId = primaryItemForIntent(intent);
  const nextUp = useMemo(
    () => itemsInOrder.find((i) => !progress[i.id]) ?? null,
    [itemsInOrder, progress],
  );
  const progressPct = Math.round((done / FIRST_WEEK_TOTAL) * 100);

  // Once all 6 done AND not yet stamped → show celebration once and
  // stamp firstWeekCompletedAt so the card hides forever next time.
  useEffect(() => {
    if (!allDone || alreadyCompleted) return;
    setGrad(true);
    updateUserProfile(uid, { firstWeekCompletedAt: Timestamp.now() }).catch(() => {});
  }, [allDone, alreadyCompleted, uid]);

  function hideForSession() {
    try {
      window.localStorage.setItem(hideKey(uid), '1');
    } catch {
      /* ignore */
    }
    setHiddenForSession(true);
  }

  // ── Render gates ──────────────────────────────────────────────────
  if (alreadyCompleted) return null;
  if (hiddenForSession) return null;

  // Graduation celebration — one session, then alreadyCompleted hides
  // it on next visit.
  if (grad) {
    return (
      <div className="bg-gradient-to-br from-pantry-leaf to-pantry-leaf-dk rounded-kaya p-6 text-center text-white shadow-lg">
        <div className="text-4xl mb-2">🎉</div>
        <h3 className="font-display font-black text-xl mb-1">You&apos;ve found the rhythm.</h3>
        <p className="text-sm text-white/90 mb-4 max-w-md mx-auto leading-relaxed">
          All six first-week habits done. Kaya holds the rest from here — the daily tap, the
          gentle reminders, the Sunday meeting. You&apos;re in.
        </p>
        <button
          type="button"
          onClick={() => setGrad(false)}
          className="bg-white text-pantry-leaf-dk font-extrabold text-sm px-6 py-2 rounded-full"
        >
          Got it ✓
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-kaya border-[1.5px] border-brand-honey/45 p-4 sm:p-5 shadow-sm"
      style={{
        background: 'linear-gradient(180deg, #FCF0D2 0%, #FBE9B5 100%)',
        boxShadow: '0 8px 28px rgba(243, 156, 47, 0.10)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">🌱</span>
          <div className="min-w-0">
            <h3 className="font-display font-black text-[15.5px] text-brand-navy leading-tight">
              Your first week with Kaya
            </h3>
            <p className="text-[11.5px] text-brand-ink/60 leading-snug">
              Six small habits to find the rhythm. The card hides once they&apos;re all done.
            </p>
          </div>
        </div>
        <span className="bg-white/80 border border-brand-honey/30 text-brand-honey-dk text-[11px] font-extrabold px-2.5 py-1 rounded-full whitespace-nowrap">
          {done} of {FIRST_WEEK_TOTAL} done
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-brand-navy/10 rounded-full overflow-hidden my-3">
        <div
          className="h-full bg-gradient-to-r from-brand-honey to-brand-honey-dk rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Items */}
      <ul className="flex flex-col gap-1.5">
        {itemsInOrder.map((item, idx) => {
          const isDone = progress[item.id];
          const isNextUp = !isDone && nextUp?.id === item.id;
          const isPrimary = primaryId === item.id;
          return (
            <li
              key={item.id}
              className={`bg-white rounded-xl px-3 py-2.5 sm:py-3 grid items-center gap-2.5 sm:gap-3 transition-colors ${
                isDone
                  ? 'border border-pantry-leaf/40 bg-pantry-leaf-soft/50'
                  : isNextUp
                    ? 'border-[1.5px] border-brand-honey/55 shadow-[0_4px_14px_rgba(243,156,47,0.12)]'
                    : 'border border-brand-navy/10'
              }`}
              style={{ gridTemplateColumns: '26px 1fr auto' }}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-extrabold ${
                  isDone
                    ? 'bg-pantry-leaf text-white border border-pantry-leaf'
                    : isNextUp
                      ? 'bg-white text-brand-honey-dk border-[1.5px] border-brand-honey'
                      : 'bg-white text-brand-ink/60 border-[1.5px] border-brand-navy/15'
                }`}
              >
                {isDone ? '✓' : idx + 1}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base leading-none">{item.emoji}</span>
                  <span
                    className={`font-display font-extrabold text-[13.5px] sm:text-[14px] leading-tight ${
                      isDone
                        ? 'text-pantry-leaf-dk line-through decoration-pantry-leaf-dk/40'
                        : 'text-brand-navy'
                    }`}
                  >
                    {item.label}
                  </span>
                  {isPrimary && !isDone && (
                    <span className="bg-white border border-brand-honey/45 text-brand-honey-dk text-[9.5px] font-extrabold uppercase tracking-[0.05em] px-1.5 py-[2px] rounded-full">
                      Your pick
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] text-brand-ink/60 leading-snug mt-0.5">
                  {item.hint}
                </div>
              </div>

              {isDone ? (
                <span className="text-pantry-leaf-dk text-[11px] font-extrabold whitespace-nowrap">
                  Done ✓
                </span>
              ) : (
                <Link
                  href={item.href}
                  className={`text-[12px] font-extrabold rounded-full px-3 py-1.5 whitespace-nowrap no-underline transition-colors ${
                    isNextUp
                      ? 'bg-brand-honey text-brand-navy hover:bg-brand-honey-dk'
                      : 'bg-brand-navy text-white hover:bg-brand-navy-soft'
                  }`}
                >
                  {item.cta} →
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-dashed border-brand-navy/10 flex items-center justify-between gap-3 text-[11.5px] text-brand-ink/60">
        <span>{done === 0 ? 'The first habit takes 5 minutes — the rest follow.' : done < FIRST_WEEK_TOTAL ? `${done} small win${done === 1 ? '' : 's'} in — that's the rhythm starting.` : 'All six done. Card graduating…'}</span>
        <button
          type="button"
          onClick={hideForSession}
          className="text-brand-ink/60 underline underline-offset-[3px] decoration-brand-ink/20 hover:text-brand-navy"
        >
          Hide for now
        </button>
      </div>
    </div>
  );
}
