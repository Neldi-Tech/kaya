'use client';

// ── Goals Review (Sunday-Meeting v4 · 2026-06-21 · GOALS PR2 2026-07-19) ──
// An independent tab (My Day + Workplan + the Meetings page) with two parts:
//   1) "Review your open goals" — EVERY goal still open: last week's AND
//      carried/unreviewed ones from older weeks, grouped by origin week
//      with ⏳ days-pending chips. Each is markable ✓ done / ↻ not yet
//      (+ 🍂 "let it go" for carried ones), each with an optional NOTE.
//      Saved onto this cycle's submission (goalsReflection, origin-tagged)
//      so the meeting presenter shows the updates — AND back-filled onto
//      each goal's origin history entry so the register is instantly true.
//   2) "🎯 Goal Register" — every goal across every meeting, newest first,
//      status (✓ accomplished / ↻ carried / 🍂 released / · not yet
//      reviewed), note, and ⏳ pending-days on open ones. Rows are TAPPABLE:
//      update status + note on any goal, any day. Goal text is immutable —
//      the register is the family's keepsake.
// Reviews address goals by origin week + position, never by text — duplicate
// wordings never collide. Completing a goal fires confetti; a carried goal
// finally done is a comeback 🎉; "not yet" stays gentle, never shaming.
//
// Self-contained: resolves identity from auth/family context so callers just
// render <GoalsReviewView />.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  getMeetingSubmission, setMeetingSubmission, meetingCycleKey,
} from '@/lib/meetingSubmissions';
import {
  getMeetingSubmissionHistory, updateGoalReflections,
  type SubmissionHistoryDoc,
} from '@/lib/meetingSubmissionHistory';
import { toDisplayDate } from '@/lib/dates';

const PURPLE = '#9B5DE5';
const EMERALD = '#5BA88C';

export interface OpenLine {
  entryDate: string;   // origin week (YYYY-MM-DD) — the addressing key
  index: number;       // position within that week's goals — never text-matched
  text: string;
  done: boolean;
  note: string;
  released: boolean;
  /** GOALS PR3 — last "not yet" day + how many distinct days it was carried. */
  postponedAt?: string;
  carryCount?: number;
}

/** Whole local days since a YYYY-MM-DD key (never negative). */
function daysSince(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return 0;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000));
}

/** Today's LOCAL YYYY-MM-DD (postpone stamps use local days, never UTC). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Sun 26-Jul-2026" — weekday + Kaya display date, for the ⏰ Due chip. */
export function dueDateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return toDisplayDate(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${toDisplayDate(iso)}`;
}

/** Build the OPEN goal lines from a member's history + current-cycle
 *  submission. Pure — module-scoped so the Meetings page's prep-tab
 *  shortcut can reuse it via loadOpenGoalLines (GOALS PR3). */
function buildOpenLines(
  h: SubmissionHistoryDoc | null,
  sub: { goalsReflection?: Array<{ text: string; done: boolean; note?: string; originDate?: string; originIndex?: number; released?: boolean }> } | null,
): OpenLine[] {
  const entries = h?.entries || [];
  if (entries.length === 0) return [];
  const latestDate = entries.find((e) => (e.goals || []).length > 0)?.date;
  const out: OpenLine[] = [];
  entries.forEach((e) => {
    (e.goals || []).forEach((g, i) => {
      if (!g) return;
      const r = e.goalsReflection?.[i];
      if (r?.done === true || r?.released) return; // closed — register only
      // Overlay this cycle's unsaved-to-archive reflection: origin-tagged
      // first; legacy untagged lines belong to the LATEST week (by position).
      const tagged = sub?.goalsReflection?.find((x) => x.originDate === e.date && x.originIndex === i);
      const legacy = e.date === latestDate
        ? sub?.goalsReflection?.find((x, xi) => !x.originDate && (x.text === g || xi === i))
        : undefined;
      const src = tagged || legacy;
      if (src?.released) return;
      out.push({
        entryDate: e.date, index: i, text: g,
        done: src?.done ?? false,
        note: src?.note || r?.note || '',
        released: false,
        ...(r?.postponedAt ? { postponedAt: r.postponedAt } : {}),
        ...(r?.carryCount ? { carryCount: r.carryCount } : {}),
      });
    });
  });
  return out;
}

/** One-shot open-goals read for the Meeting-Prep shortcut card. */
export async function loadOpenGoalLines(familyId: string, uid: string): Promise<OpenLine[]> {
  const [h, sub] = await Promise.all([
    getMeetingSubmissionHistory(familyId, uid).catch(() => null),
    getMeetingSubmission(familyId, uid).catch(() => null),
  ]);
  return buildOpenLines(h, sub);
}

/** The Set / ↻ Postponed / ⏰ Due chip row (GOALS PR3). */
export function GoalDateChips({ line, dueKey }: { line: Pick<OpenLine, 'entryDate' | 'postponedAt' | 'carryCount'>; dueKey?: string | null }) {
  return (
    <span className="flex flex-wrap gap-1 mt-1.5">
      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: '#F0EBE3', color: '#9B8A72' }}>
        Set {toDisplayDate(line.entryDate) || line.entryDate}
      </span>
      {line.postponedAt && (
        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: '#F6EFCF', color: '#8a6d1a' }}>
          ↻ Postponed {toDisplayDate(line.postponedAt) || line.postponedAt}{(line.carryCount || 0) > 1 ? ` · ×${line.carryCount}` : ''}
        </span>
      )}
      {dueKey && (
        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: '#EAF6EE', color: '#2E6B39' }}>
          ⏰ Due {dueDateLabel(dueKey)}
        </span>
      )}
    </span>
  );
}

export default function GoalsReviewView() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = family?.id;
  const uid = profile?.uid;
  const role = (profile?.role === 'kid' ? 'kid' : profile?.role === 'helper' ? 'helper' : 'parent') as 'kid' | 'parent' | 'helper';
  const scheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;

  // Resolve a kid's childId (can be empty-string — match by email, never [0]).
  const childId = useMemo(() => {
    if (role !== 'kid' || !profile) return undefined;
    const direct = profile.childId?.trim();
    if (direct) return direct;
    const myEmail = profile.email?.toLowerCase() ?? '';
    if (!myEmail) return undefined;
    return (children || []).find((c: { id: string; emailLower?: string; email?: string }) =>
      (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id;
  }, [role, profile, children]);

  const name = (profile?.displayName || 'friend').split(' ')[0];
  const avatarEmoji = useMemo(() => {
    if (role === 'kid' && childId) return (children || []).find((c: { id: string; avatarEmoji?: string }) => c.id === childId)?.avatarEmoji;
    return undefined;
  }, [role, childId, children]);

  const [hist, setHist] = useState<SubmissionHistoryDoc | null>(null);
  const [lines, setLines] = useState<OpenLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Register inline editor — which row is open (entryDate:index), its draft.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState<{ done: boolean; released: boolean; note: string }>({ done: false, released: false, note: '' });
  const [rowSaving, setRowSaving] = useState(false);
  const burstRef = useRef<HTMLDivElement | null>(null);

  // The upcoming meeting day — every open goal is "due" then (GOALS PR3).
  const dueKey = meetingCycleKey(scheduleDow);

  const reload = () => {
    if (!familyId || !uid) return;
    Promise.all([
      getMeetingSubmissionHistory(familyId, uid).catch(() => null),
      getMeetingSubmission(familyId, uid).catch(() => null),
    ]).then(([h, sub]) => {
      setHist(h);
      setLines(buildOpenLines(h, sub));
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!familyId || !uid) return;
    let cancelled = false;
    Promise.all([
      getMeetingSubmissionHistory(familyId, uid).catch(() => null),
      getMeetingSubmission(familyId, uid).catch(() => null),
    ]).then(([h, sub]) => {
      if (cancelled) return;
      setHist(h);
      setLines(buildOpenLines(h, sub));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, uid]);

  const setLine = (entryDate: string, index: number, patch: Partial<OpenLine>) => {
    setLines((prev) => prev.map((l) => (l.entryDate === entryDate && l.index === index ? { ...l, ...patch } : l)));
    setSavedAt(null);
  };

  const celebrate = () => {
    const host = burstRef.current;
    if (!host) return;
    const icons = ['🎉', '✨', '🎊', '⭐', '💛'];
    for (let i = 0; i < 16; i++) {
      const s = document.createElement('span');
      s.textContent = icons[i % icons.length];
      s.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:0;font-size:${12 + Math.random() * 12}px;pointer-events:none;animation:gr-fall ${0.9 + Math.random()}s ease-in forwards`;
      host.appendChild(s);
      setTimeout(() => s.remove(), 2000);
    }
  };

  /** Persist a set of lines: origin back-fill (register truth) + this
   *  cycle's submission stamp (the presenter shows it at the meeting). */
  const persist = async (toSave: OpenLine[]) => {
    if (!familyId || !uid) return;
    await updateGoalReflections(familyId, uid, toSave.map((l) => ({
      entryDate: l.entryDate, goalIndex: l.index,
      done: l.done,
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
      ...(l.released ? { released: true } : {}),
      // GOALS PR3 — a "not yet" review stamps today as the postponed date
      // (the lib bumps the carry counter at most once per distinct day).
      ...(!l.done && !l.released ? { postponedAt: todayIso() } : {}),
    })));
    await setMeetingSubmission(familyId, uid, {
      name,
      emoji: avatarEmoji,
      childId,
      role,
      gratitudes: [],
      appreciations: [],
      goals: [],
      goalsReflection: toSave.map((l) => ({
        text: l.text,
        done: l.done,
        ...(l.note.trim() ? { note: l.note.trim() } : {}),
        originDate: l.entryDate,
        originIndex: l.index,
        ...(l.released ? { released: true } : {}),
      })),
      cycleKey: meetingCycleKey(scheduleDow) ?? undefined,
    });
  };

  const save = async () => {
    if (!familyId || !uid) return;
    setSaving(true);
    const anyNewlyDone = lines.some((l) => l.done);
    try {
      await persist(lines);
      setSavedAt(Date.now());
      if (anyNewlyDone) celebrate();
      reload();
    } finally {
      setSaving(false);
    }
  };

  // Register — all goals across history, newest first, with status + note +
  // pending days; each row addressable for the tap-to-update editor.
  const register = useMemo(() => (hist?.entries || [])
    .flatMap((e) => (e.goals || []).map((g, i) => ({
      key: `${e.date}:${i}`,
      entryDate: e.date,
      index: i,
      goal: g,
      done: e.goalsReflection?.[i]?.done,
      released: e.goalsReflection?.[i]?.released,
      note: e.goalsReflection?.[i]?.note,
      postponedAt: e.goalsReflection?.[i]?.postponedAt,
      carryCount: e.goalsReflection?.[i]?.carryCount,
    })))
    .filter((r) => r.goal), [hist]);

  const openRegisterRow = (r: { key: string; done?: boolean; released?: boolean; note?: string }) => {
    if (openRow === r.key) { setOpenRow(null); return; }
    setOpenRow(r.key);
    setRowDraft({ done: r.done === true, released: r.released === true, note: r.note || '' });
  };

  const saveRegisterRow = async (r: { entryDate: string; index: number; goal: string }) => {
    if (!familyId || !uid) return;
    setRowSaving(true);
    try {
      await persist([{
        entryDate: r.entryDate, index: r.index, text: r.goal,
        done: rowDraft.done, note: rowDraft.note, released: rowDraft.released && !rowDraft.done,
      }]);
      if (rowDraft.done) celebrate();
      setOpenRow(null);
      reload();
    } finally {
      setRowSaving(false);
    }
  };

  // Review groups: origin weeks with open goals, newest first.
  const groups = useMemo(() => {
    const byDate = new Map<string, OpenLine[]>();
    lines.forEach((l) => {
      const arr = byDate.get(l.entryDate) || [];
      arr.push(l);
      byDate.set(l.entryDate, arr);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, ls], gi) => ({ date, lines: ls, isLatest: gi === 0, pendingDays: daysSince(date) }));
  }, [lines]);

  if (!familyId || !uid) return null;
  if (loading) {
    return <p className="text-center text-[13px] font-extrabold py-8" style={{ color: PURPLE }}>Loading your goals…</p>;
  }

  const pendChip = (days: number) => days > 0 ? (
    <span className="ml-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: '#FDF3DD', color: '#B8860B' }}>
      ⏳ pending {days} day{days === 1 ? '' : 's'}
    </span>
  ) : null;

  const statusButtons = (l: { done: boolean; released: boolean }, onPick: (p: { done: boolean; released: boolean }) => void, carried: boolean) => (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onPick({ done: true, released: false })}
        className="flex-1 rounded-lg py-2 text-[12.5px] font-black border-2 transition-colors"
        style={l.done
          ? { background: EMERALD, borderColor: EMERALD, color: '#fff' }
          : { background: '#fff', borderColor: '#E8E0D4', color: '#3D241A' }}
      >✓ Did it</button>
      <button
        type="button"
        onClick={() => onPick({ done: false, released: false })}
        className="flex-1 rounded-lg py-2 text-[12.5px] font-black border-2 transition-colors"
        style={!l.done && !l.released
          ? { background: '#F6E2B0', borderColor: '#D4A017', color: '#3D241A' }
          : { background: '#fff', borderColor: '#E8E0D4', color: '#3D241A' }}
      >{carried ? '↻ Still going' : '↻ Not yet'}</button>
      {carried && (
        <button
          type="button"
          onClick={() => onPick({ done: false, released: true })}
          className="flex-1 rounded-lg py-2 text-[12.5px] font-black border-2 transition-colors"
          style={l.released
            ? { background: '#EFE6DA', borderColor: '#B7A38A', color: '#6B5B45' }
            : { background: '#fff', borderColor: '#E8E0D4', color: '#3D241A' }}
        >🍂 Let it go</button>
      )}
    </div>
  );

  return (
    <div className="space-y-3" ref={burstRef} style={{ position: 'relative' }}>
      <style>{`@keyframes gr-fall{to{transform:translateY(420px) rotate(540deg);opacity:0}}`}</style>

      {/* ── Review your OPEN goals — last week + carried (GOALS PR2) ── */}
      {groups.length > 0 ? (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: '#E8E0FF', background: 'linear-gradient(180deg,#F8F4FF,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide" style={{ color: PURPLE }}>
            🔍 Review your open goals
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: '#5C6975' }}>
            Everything still open — from last week and carried from before. Update any day; your family sees it at the meeting.
          </p>

          {groups.map((g) => (
            <div key={g.date} className="mt-3">
              <p className="text-[11px] font-black" style={{ color: g.isLatest ? '#2D1B5E' : '#B8860B' }}>
                {g.isLatest ? `From last week · ${toDisplayDate(g.date) || g.date}` : `↻ Carried from ${toDisplayDate(g.date) || g.date}`}
                {!g.isLatest && pendChip(g.pendingDays)}
              </p>
              <div className="mt-1.5 space-y-2.5">
                {g.lines.map((l) => (
                  <div key={`${l.entryDate}:${l.index}`} className="rounded-xl bg-white border p-2.5" style={{ borderColor: '#F0E8FF' }}>
                    {statusButtons(l, (p) => setLine(l.entryDate, l.index, p), !g.isLatest)}
                    <p className="text-[13px] font-bold mt-2" style={{ color: '#3D241A' }}>{l.text}</p>
                    <GoalDateChips line={l} dueKey={dueKey} />
                    <textarea
                      value={l.note}
                      onChange={(e) => setLine(l.entryDate, l.index, { note: e.target.value })}
                      placeholder="Add a note — how did it go? What made it hard or easy?"
                      rows={2}
                      className="w-full mt-2 rounded-lg border px-2.5 py-2 text-[12.5px] resize-none"
                      style={{ borderColor: '#E8E0D4', background: '#FCFAF5', color: '#3D241A' }}
                    />
                    {!l.done && !l.released && (
                      <p className="text-[10.5px] mt-1" style={{ color: '#B8860B' }}>↻ Stays open — you&rsquo;ve got this 💪</p>
                    )}
                    {l.released && (
                      <p className="text-[10.5px] mt-1" style={{ color: '#8A7A62' }}>🍂 Will rest in the register — letting go is okay too.</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full text-[12.5px] font-extrabold text-white transition-colors disabled:opacity-50"
              style={{ background: PURPLE }}
            >
              {saving ? 'Saving…' : savedAt ? '✓ Saved' : 'Save review'}
            </button>
            {savedAt && !saving && (
              <span className="text-[10.5px] font-bold" style={{ color: EMERALD }}>🎉 Saved — shows in the meeting.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-2 p-5 text-center" style={{ borderColor: '#F0E8FF', background: '#fff' }}>
          <div className="text-3xl mb-1">🎯</div>
          <p className="font-black text-[14px]" style={{ color: '#2D1B5E' }}>No open goals right now</p>
          <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
            Set a goal in your meeting prep — it&rsquo;ll show here to review and mark how it went.
          </p>
        </div>
      )}

      {/* ── Goal Register — tappable rows (GOALS PR2) ─────────────── */}
      {register.length > 0 && (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: '#E8E0FF', background: 'linear-gradient(180deg,#F5F0FF,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide mb-3" style={{ color: PURPLE }}>
            🎯 Goal Register
          </p>
          <div className="space-y-2">
            {register.map((r) => {
              const open = r.done !== true && !r.released;
              const expanded = openRow === r.key;
              return (
                <div key={r.key} className={`rounded-xl ${expanded ? 'border-2 bg-white p-2.5' : ''}`} style={expanded ? { borderColor: '#D9C6F7' } : undefined}>
                  <button type="button" onClick={() => openRegisterRow(r)} className="w-full flex items-start gap-2 text-left">
                    <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black ${
                      r.done === true ? 'bg-emerald-100 text-emerald-600' :
                      r.released ? 'bg-[#EFE6DA] text-[#8A7A62]' :
                      r.done === false ? 'bg-amber-100 text-amber-500' :
                      'bg-white/60 text-[#9B8A72] border border-dashed border-[#9B8A72]/40'
                    }`}>
                      {r.done === true ? '✓' : r.released ? '🍂' : r.done === false ? '↻' : '·'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className={`text-[12.5px] leading-snug ${r.done || r.released ? 'line-through text-[#9B8A72]' : ''}`} style={{ color: r.done || r.released ? undefined : '#3D241A' }}>
                          {r.goal}
                        </span>
                        <span className="ml-1.5 text-[10px]" style={{ color: '#9B8A72' }}>
                          {toDisplayDate(r.entryDate) || r.entryDate}
                        </span>
                        {open && pendChip(daysSince(r.entryDate))}
                      </div>
                      {open && (
                        <GoalDateChips line={{ entryDate: r.entryDate, postponedAt: r.postponedAt, carryCount: r.carryCount }} dueKey={dueKey} />
                      )}
                      {r.note && !expanded && (
                        <p className="text-[11.5px] italic mt-0.5" style={{ color: '#7C6A52' }}>&ldquo;{r.note}&rdquo;</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] font-black mt-1" style={{ color: PURPLE }}>{expanded ? '▾' : 'update ›'}</span>
                  </button>
                  {expanded && (
                    <div className="mt-2.5 pl-7">
                      {statusButtons(
                        { done: rowDraft.done, released: rowDraft.released },
                        (p) => setRowDraft((d) => ({ ...d, ...p })),
                        true,
                      )}
                      <textarea
                        value={rowDraft.note}
                        onChange={(e) => setRowDraft((d) => ({ ...d, note: e.target.value }))}
                        placeholder="Add or update the note…"
                        rows={2}
                        className="w-full mt-2 rounded-lg border px-2.5 py-2 text-[12.5px] resize-none"
                        style={{ borderColor: '#E8E0D4', background: '#FCFAF5', color: '#3D241A' }}
                      />
                      <div className="flex justify-end mt-2">
                        <button
                          type="button"
                          disabled={rowSaving}
                          onClick={() => saveRegisterRow(r)}
                          className="h-9 px-5 rounded-full text-[12px] font-extrabold text-white disabled:opacity-50"
                          style={{ background: PURPLE }}
                        >
                          {rowSaving ? 'Updating…' : 'Update'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px]" style={{ color: '#9B8A72' }}>
            ✓ accomplished · ↻ carried · 🍂 released · · not yet reviewed — tap any goal to update it
          </p>
        </div>
      )}
    </div>
  );
}
