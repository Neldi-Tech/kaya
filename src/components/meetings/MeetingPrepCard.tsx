'use client';

// ── Sunday-Meeting v2 (b2) · Pre-meeting prep card (shared) ─────────────
//
// 3 short sections everyone fills BEFORE the meeting (Gratitudes /
// Appreciations / Goals) so the meeting just reads off the screen.
//
// 2026-06-13 discoverability fix (Options A + C from chat):
//   • Lifted from /my-day into a shared component so /workplan and
//     /kid Home can render it too — many families hide My Day in
//     `kidModules`, which left the only doorway invisible.
//   • Option A — *expand by default* + *bigger* visual when the
//     meeting is within `OPEN_BY_DEFAULT_DAYS` (3 days) AND nothing
//     has been filled yet. The thin-strip-with-chevron treatment now
//     only applies after the kid has saved a line.
//   • Option C — adds a top "📅 Meeting prep ready" alert pill above
//     the card during the same window, so even a kid scrolling fast
//     spots it as "something I need to do today", not as a
//     notification banner.
//
// Self-contained — pulls family from context, persists to the
// upcomingMeetingSubmissions subcollection via setMeetingSubmission.
// The Appreciations placeholder uses the v2 "I appreciate @name for…"
// framing per Elia's tweak.

import { useMemo, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { setMeetingSubmission } from '@/lib/meetingSubmissions';
import { ChevronRight } from 'lucide-react';

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const;

/** When the meeting is this many days away or closer AND nothing has
 *  been filled yet, the card opens with the 3 input fields visible
 *  by default. Outside this window it stays collapsed to keep the
 *  surface tidy (kids re-tap to re-open). */
const OPEN_BY_DEFAULT_DAYS = 3;

function daysUntilNextMeeting(scheduleDow: number | undefined, todayDow: number): number | null {
  if (typeof scheduleDow !== 'number') return null;
  const diff = (scheduleDow - todayDow + 7) % 7;
  return diff; // 0 = today, 1 = tomorrow, …
}

export default function MeetingPrepCard({
  meId, role, name, childId, avatarEmoji,
}: {
  meId: string;        // uid
  role: 'parent' | 'kid' | 'helper';
  name: string;
  childId?: string;    // when role === 'kid'
  avatarEmoji?: string;
}) {
  const { family } = useFamily();
  const familyId = family?.id;
  const scheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;
  const todayDow = new Date().getDay();
  const daysUntil = daysUntilNextMeeting(scheduleDow, todayDow);

  // Visible whenever there's no schedule, or the schedule is anywhere
  // in the next 7 days (i.e. always — a kid who's late one week can
  // still fill in next week's). Hiding the card requires an explicit
  // "filled and dismissed" flag, queued for a follow-up.
  const visible = familyId && (daysUntil === null || daysUntil >= 0);

  const [gratitude, setGratitude] = useState('');
  const [appreciation, setAppreciation] = useState('');
  const [goal, setGoal] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filledCount = useMemo(
    () => [gratitude, appreciation, goal].filter((s) => s.trim().length > 0).length,
    [gratitude, appreciation, goal],
  );

  // Default-open when the meeting is near AND nothing is filled yet —
  // kids should never have to discover the chevron during prep week.
  const shouldOpenByDefault =
    daysUntil !== null && daysUntil <= OPEN_BY_DEFAULT_DAYS && filledCount === 0;
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride !== null ? openOverride : shouldOpenByDefault;

  // Alert pill above the card — only during the open-by-default window
  // and only if the kid hasn't filled anything yet. As soon as they
  // save a line, the alert goes away and the card slims down.
  const showAlert = shouldOpenByDefault;

  const handleSave = async () => {
    if (!familyId) return;
    setSaving(true);
    setError(null);
    try {
      await setMeetingSubmission(familyId, meId, {
        name,
        emoji: avatarEmoji,
        childId,
        role,
        gratitudes: [gratitude],
        appreciations: [appreciation],
        goals: [goal],
      });
      setSavedAt(Date.now());
    } catch (e: any) {
      setError(e?.message || 'Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const meetingDay = typeof scheduleDow === 'number' ? DAY_NAMES[scheduleDow] : 'Sunday';
  const whenLabel = daysUntil === null
    ? `Before ${meetingDay}`
    : daysUntil === 0
      ? `Today · ${meetingDay} meeting`
      : daysUntil === 1
        ? `Tomorrow · ${meetingDay} meeting`
        : `In ${daysUntil} days · ${meetingDay} meeting`;

  return (
    <div className="mb-4">
      {/* Option C — "meeting prep ready" pill. Sits on top of the card
          during the open-by-default window so the kid sees a clear
          "do this now" signal, not a notification strip. */}
      {showAlert && (
        <div
          className="flex items-center gap-2 mb-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold border-2"
          style={{ background: '#9B5DE5', borderColor: '#7C3DC8', color: '#fff' }}
          role="status"
        >
          <span aria-hidden>📅</span>
          <span className="flex-1 min-w-0 truncate">
            Meeting prep ready · fill before {meetingDay}!
          </span>
        </div>
      )}

      <div
        className="rounded-2xl border-2 overflow-hidden"
        style={{ borderColor: '#9B5DE5', background: 'linear-gradient(135deg, #FAF5FF, #fff)' }}
      >
        <button
          type="button"
          onClick={() => setOpenOverride((o) => (o === null ? !open : !o))}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
          aria-expanded={open}
        >
          <span className="text-xl" aria-hidden>📨</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[1.5px]" style={{ color: '#9B5DE5' }}>
              Sunday Meeting prep · {whenLabel}
            </p>
            <p className="text-[12.5px] font-extrabold text-[#2D1B5E] leading-snug">
              Fill 3 quick lines so the meeting flows · {filledCount}/3
            </p>
          </div>
          <ChevronRight
            size={18}
            className="shrink-0 transition-transform"
            style={{ color: '#9B5DE5', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </button>
        {open && (
          <div className="px-3.5 pb-3.5 space-y-3">
            <PrepInput
              emoji="🙏"
              label="Gratitude"
              placeholder="I'm thankful for…"
              value={gratitude}
              onChange={setGratitude}
            />
            <PrepInput
              emoji="💛"
              label="Appreciation"
              placeholder="I appreciate @name for…"
              hint="@-tag a family member"
              value={appreciation}
              onChange={setAppreciation}
            />
            <PrepInput
              emoji="🎯"
              label="Goal for the week"
              placeholder="This week I want to…"
              value={goal}
              onChange={setGoal}
            />
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || filledCount === 0}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[12.5px] font-extrabold text-white transition-colors disabled:opacity-50"
                style={{ background: '#9B5DE5' }}
              >
                {saving ? 'Saving…' : savedAt ? '✓ Saved' : 'Save'}
              </button>
              {savedAt && !saving && (
                <span className="text-[10.5px] font-bold text-[#5C6975]">
                  Auto-shows in the meeting screen.
                </span>
              )}
              {error && (
                <span className="text-[11px] text-rose-500 font-bold">⚠️ {error}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PrepInput({
  emoji, label, placeholder, hint, value, onChange,
}: {
  emoji: string;
  label: string;
  placeholder: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl bg-white border border-[#F0E8FF] p-2.5">
      <p className="text-[10px] font-black uppercase tracking-[1.2px]" style={{ color: '#9B5DE5' }}>
        <span aria-hidden>{emoji}</span> {label}
        {hint && <span className="ml-1 font-bold text-[#5C6975] normal-case">· {hint}</span>}
      </p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={140}
        className="mt-1 w-full bg-transparent text-[13px] font-extrabold leading-snug placeholder-[#B9AFC9] focus:outline-none"
        style={{ color: '#2D1B5E' }}
      />
    </div>
  );
}
