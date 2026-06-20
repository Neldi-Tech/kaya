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
//   • Option A — *expand by default* near the meeting when nothing's
//     filled. Option C — a "📅 Meeting prep ready" alert pill on top.
//
// 2026-06-14 — UP TO 3 LINES per section (Elia), then Appreciations
// UNCAPPED (some families appreciate everyone). Each section starts with
// one input and a "+ Add another" — Gratitude/Goals cap at
// MAX_SUBMISSION_LINES (3); Appreciations have no visible limit
// (MAX_APPRECIATION_LINES backstop only). Each appreciation LINE carries
// its own @-tag (tap a family member), revealed to them on meeting day.
//
// Self-contained — pulls family from context, persists to the
// upcomingMeetingSubmissions subcollection via setMeetingSubmission, which
// hydrates + saves per-field non-destructively.

import { useEffect, useMemo, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import {
  setMeetingSubmission, getMeetingSubmission, MAX_SUBMISSION_LINES, MAX_APPRECIATION_LINES,
  appreciationTagsForLine, type AppreciationTag,
} from '@/lib/meetingSubmissions';
import { getFamilyMembers } from '@/lib/firestore';
import { ChevronRight } from 'lucide-react';

type TagOption = { id: string; name: string; emoji: string };

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const;
const PURPLE = '#9B5DE5';

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
  const { family, children: familyChildren } = useFamily();
  const familyId = family?.id;
  const scheduleDow = family?.meetingSetup?.schedule?.dayOfWeek;
  const todayDow = new Date().getDay();
  const daysUntil = daysUntilNextMeeting(scheduleDow, todayDow);

  const visible = familyId && (daysUntil === null || daysUntil >= 0);

  // Each section is now a list of up to MAX_SUBMISSION_LINES. Starts with
  // one empty line. Appreciation tag arrays stay index-aligned with
  // `appreciations`.
  const [gratitudes, setGratitudes] = useState<string[]>(['']);
  const [appreciations, setAppreciations] = useState<string[]>(['']);
  const [goals, setGoals] = useState<string[]>(['']);
  // Per-line multi-tag: each appreciation can tag several people, or All.
  const [apprTags, setApprTags] = useState<AppreciationTag[]>([{ ids: [], names: [] }]);

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from the saved submission so the boxes show what was already
  // written (data-loss fix), now restoring all lines + per-line tags.
  useEffect(() => {
    if (!familyId || !meId) return;
    let cancelled = false;
    getMeetingSubmission(familyId, meId)
      .then((sub) => {
        if (cancelled || !sub) return;
        const g = sub.gratitudes?.length ? sub.gratitudes : [''];
        const a = sub.appreciations?.length ? sub.appreciations : [''];
        const go = sub.goals?.length ? sub.goals : [''];
        setGratitudes(g);
        setAppreciations(a);
        setGoals(go);
        // Rebuild per-line multi-tags (handles old single-tag shape too).
        setApprTags(a.map((_, i) => appreciationTagsForLine(sub, i)));
        if (sub.gratitudes?.length || sub.appreciations?.length || sub.goals?.length) {
          setSavedAt(sub.updatedAt || Date.now());
        }
      })
      .catch(() => { /* tolerate offline — fall back to blank */ })
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, [familyId, meId]);

  // Family roster for the @-tag picker (kids + parents), excluding self.
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    const kids: TagOption[] = (familyChildren || []).map((c: { id: string; name: string; avatarEmoji?: string }) => ({ id: c.id, name: c.name, emoji: c.avatarEmoji || '🧒' }));
    getFamilyMembers(familyId)
      .then((members) => {
        if (cancelled) return;
        const parents: TagOption[] = members
          .filter((m) => m.role === 'parent')
          .map((m) => ({ id: m.uid, name: (m.displayName || 'Parent').split(' ')[0], emoji: (m as { avatarEmoji?: string }).avatarEmoji || '👤' }));
        const all = [...parents, ...kids].filter((o) => o.id !== meId && o.id !== childId);
        setTagOptions(all);
      })
      .catch(() => { if (!cancelled) setTagOptions(kids.filter((o) => o.id !== childId)); });
    return () => { cancelled = true; };
  }, [familyId, familyChildren, meId, childId]);

  const filledCount = useMemo(
    () => [gratitudes, appreciations, goals].filter((arr) => arr.some((s) => s.trim().length > 0)).length,
    [gratitudes, appreciations, goals],
  );

  const shouldOpenByDefault =
    hydrated && daysUntil !== null && daysUntil <= OPEN_BY_DEFAULT_DAYS && filledCount === 0;
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride !== null ? openOverride : shouldOpenByDefault;
  const showAlert = shouldOpenByDefault;

  // ── Line helpers ─────────────────────────────────────────────────
  const dirty = () => setSavedAt(null);
  const editLine = (
    arr: string[], setArr: (v: string[]) => void, i: number, val: string,
  ) => { const next = [...arr]; next[i] = val; setArr(next); dirty(); };
  const addLine = (arr: string[], setArr: (v: string[]) => void) => {
    if (arr.length >= MAX_SUBMISSION_LINES) return;
    setArr([...arr, '']); dirty();
  };
  const removeLine = (arr: string[], setArr: (v: string[]) => void, i: number) => {
    const next = arr.filter((_, idx) => idx !== i);
    setArr(next.length ? next : ['']); dirty();
  };
  // Appreciation lines remove text + tag in lock-step.
  const removeApprLine = (i: number) => {
    const drop = <T,>(a: T[]) => a.filter((_, idx) => idx !== i);
    const t = drop(appreciations); const tags = drop(apprTags);
    setAppreciations(t.length ? t : ['']);
    setApprTags(t.length ? tags : [{ ids: [], names: [] }]);
    dirty();
  };
  const addApprLine = () => {
    if (appreciations.length >= MAX_APPRECIATION_LINES) return;
    setAppreciations([...appreciations, '']);
    setApprTags([...apprTags, { ids: [], names: [] }]);
    dirty();
  };
  // Toggle one person on a line's multi-select (clears "All").
  const togglePerson = (i: number, opt: TagOption) => {
    const next = [...apprTags];
    const cur = next[i] || { ids: [], names: [] };
    const has = cur.ids.includes(opt.id) && !cur.all;
    if (cur.all) {
      next[i] = { ids: [opt.id], names: [opt.name] };
    } else if (has) {
      const keep = cur.ids.map((id, j) => ({ id, name: cur.names[j] })).filter((r) => r.id !== opt.id);
      next[i] = { ids: keep.map((r) => r.id), names: keep.map((r) => r.name) };
    } else {
      next[i] = { ids: [...cur.ids, opt.id], names: [...cur.names, opt.name] };
    }
    setApprTags(next); dirty();
  };
  // Toggle the exclusive "All / Everyone" option for a line.
  const toggleAll = (i: number) => {
    const next = [...apprTags];
    const cur = next[i] || { ids: [], names: [] };
    next[i] = cur.all ? { ids: [], names: [] } : { ids: [], names: [], all: true };
    setApprTags(next); dirty();
  };

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
        gratitudes,
        appreciations,
        goals,
        // Per-line multi-tag; the lib drops tags on empty-text lines.
        appreciationTags: apprTags,
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
      {showAlert && (
        <div
          className="flex items-center gap-2 mb-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold border-2"
          style={{ background: PURPLE, borderColor: '#7C3DC8', color: '#fff' }}
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
        style={{ borderColor: PURPLE, background: 'linear-gradient(135deg, #FAF5FF, #fff)' }}
      >
        <button
          type="button"
          onClick={() => setOpenOverride((o) => (o === null ? !open : !o))}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
          aria-expanded={open}
        >
          <span className="text-xl" aria-hidden>📨</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[1.5px]" style={{ color: PURPLE }}>
              Sunday Meeting prep · {whenLabel}
            </p>
            <p className="text-[12.5px] font-extrabold text-[#2D1B5E] leading-snug">
              Share what&apos;s on your heart — add up to 3 each · {filledCount}/3 sections
            </p>
          </div>
          <ChevronRight
            size={18}
            className="shrink-0 transition-transform"
            style={{ color: PURPLE, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </button>

        {open && (
          <div className="px-3.5 pb-3.5 space-y-3">
            {/* 🙏 Gratitude */}
            <SectionLines
              emoji="🙏" label="Gratitude" placeholder="I'm thankful for…"
              values={gratitudes}
              onEdit={(i, v) => editLine(gratitudes, setGratitudes, i, v)}
              onAdd={() => addLine(gratitudes, setGratitudes)}
              onRemove={(i) => removeLine(gratitudes, setGratitudes, i)}
            />

            {/* 💛 Appreciation — each line with its own @-tag */}
            <div className="rounded-xl bg-white border border-[#F0E8FF] p-2.5">
              <p className="text-[10px] font-black uppercase tracking-[1.2px]" style={{ color: PURPLE }}>
                <span aria-hidden>💛</span> Appreciation
                <span className="ml-1 font-bold text-[#5C6975] normal-case">· tap who each is for (pick several or All)</span>
              </p>
              <div className="mt-1.5 space-y-2.5">
                {appreciations.map((val, i) => {
                  const tag = apprTags[i] || { ids: [], names: [] };
                  return (
                  <div key={i} className={i > 0 ? 'pt-2.5 border-t border-[#F4EFFB]' : ''}>
                    {tagOptions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1">
                        {/* 👨‍👩‍👧‍👦 All — exclusive "Everyone" */}
                        <button
                          type="button"
                          onClick={() => toggleAll(i)}
                          className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-extrabold border transition-colors ${
                            tag.all ? 'text-white border-transparent' : 'text-[#5C6975] border-[#E8E0F5] bg-[#FAF7FF]'
                          }`}
                          style={tag.all ? { background: PURPLE } : undefined}
                        >
                          <span aria-hidden>👨‍👩‍👧‍👦</span>All{tag.all ? ' ✓' : ''}
                        </button>
                        {tagOptions.map((o) => {
                          const on = !tag.all && tag.ids.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => togglePerson(i, o)}
                              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-extrabold border transition-colors ${
                                on ? 'text-white border-transparent' : 'text-[#5C6975] border-[#E8E0F5] bg-[#FAF7FF]'
                              }`}
                              style={on ? { background: PURPLE } : undefined}
                            >
                              <span aria-hidden>{o.emoji}</span>@{o.name}{on ? ' ✓' : ''}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      {appreciations.length > 1 && (
                        <span className="text-[10px] font-black w-3 shrink-0" style={{ color: '#C4B89A' }}>{i + 1}</span>
                      )}
                      <input
                        value={val}
                        onChange={(e) => editLine(appreciations, setAppreciations, i, e.target.value)}
                        placeholder={(tag.all || tag.ids.length) ? `…for…` : 'I appreciate @name for…'}
                        maxLength={140}
                        className="flex-1 bg-transparent text-[13px] font-extrabold leading-snug placeholder-[#B9AFC9] focus:outline-none"
                        style={{ color: '#2D1B5E' }}
                      />
                      {appreciations.length > 1 && (
                        <button type="button" onClick={() => removeApprLine(i)} aria-label="Remove line"
                          className="text-[13px] font-black shrink-0" style={{ color: '#C4B89A' }}>✕</button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
              <AddAnother count={appreciations.length} onAdd={addApprLine} unlimited />
            </div>

            {/* 🎯 Goal */}
            <SectionLines
              emoji="🎯" label="Goal for the week" placeholder="This week I want to…"
              values={goals}
              onEdit={(i, v) => editLine(goals, setGoals, i, v)}
              onAdd={() => addLine(goals, setGoals)}
              onRemove={(i) => removeLine(goals, setGoals, i)}
            />

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || filledCount === 0}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-[12.5px] font-extrabold text-white transition-colors disabled:opacity-50"
                style={{ background: PURPLE }}
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

// A "+ Add another" button. Capped sections (Gratitude/Goals) show
// "(n/3)" and grey out at the max; `unlimited` (Appreciation) shows a
// plain "+ Add another" — some families appreciate everyone, so there's
// no visible limit (only a high defensive backstop in the lib).
function AddAnother({ count, onAdd, unlimited = false }: { count: number; onAdd: () => void; unlimited?: boolean }) {
  const max = unlimited ? MAX_APPRECIATION_LINES : MAX_SUBMISSION_LINES;
  const atMax = count >= max;
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={atMax}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold border border-dashed transition-colors disabled:cursor-default"
      style={atMax
        ? { background: '#F4F1EC', color: '#B9AFC9', borderColor: '#E8E0D4' }
        : { background: '#F3ECFF', color: PURPLE, borderColor: PURPLE }}
    >
      ＋ Add another
      {!unlimited && (
        <span style={{ opacity: 0.7 }}>{atMax ? `(${max}/${max} — max)` : `(${count}/${max})`}</span>
      )}
    </button>
  );
}

// A simple multi-line section (Gratitude / Goal) — up to 3 inputs with
// add/remove. No tags (those are appreciation-only).
function SectionLines({
  emoji, label, placeholder, values, onEdit, onAdd, onRemove,
}: {
  emoji: string;
  label: string;
  placeholder: string;
  values: string[];
  onEdit: (i: number, v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="rounded-xl bg-white border border-[#F0E8FF] p-2.5">
      <p className="text-[10px] font-black uppercase tracking-[1.2px]" style={{ color: PURPLE }}>
        <span aria-hidden>{emoji}</span> {label}
      </p>
      <div className="mt-1 space-y-1.5">
        {values.map((val, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {values.length > 1 && (
              <span className="text-[10px] font-black w-3 shrink-0" style={{ color: '#C4B89A' }}>{i + 1}</span>
            )}
            <input
              value={val}
              onChange={(e) => onEdit(i, e.target.value)}
              placeholder={placeholder}
              maxLength={140}
              className="flex-1 bg-transparent text-[13px] font-extrabold leading-snug placeholder-[#B9AFC9] focus:outline-none"
              style={{ color: '#2D1B5E' }}
            />
            {values.length > 1 && (
              <button type="button" onClick={() => onRemove(i)} aria-label="Remove line"
                className="text-[13px] font-black shrink-0" style={{ color: '#C4B89A' }}>✕</button>
            )}
          </div>
        ))}
      </div>
      <AddAnother count={values.length} onAdd={onAdd} />
    </div>
  );
}
