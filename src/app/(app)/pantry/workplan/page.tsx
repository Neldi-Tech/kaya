'use client';

// /pantry/workplan — Household → Workplan hub.
//
// v4-final §04 (locked 2026-05-18) renames the legacy "People" page to
// "Workplan" and positions it as the parent's command center for
// duties: per-helper recurring schedules + (in Step 7) ad-hoc one-off
// assignments. Old /pantry/people URL redirects here.
//
// Lists all helpers (any preset — nanny / tutor / driver / gardener /
// grandparent / custom) and surfaces their performance + workplan
// inline. Parent can edit any helper's workplan from here without
// going to Settings → Helpers (which still works as the deep-config
// surface for access tiers, frequency, login codes).
//
// Helpers can also navigate here and see THEIR OWN row in detail —
// rules already gate the workplan reads to parent OR self.
//
// Each row shows an at-a-glance face emoji + headline % on the
// always-visible header (so a parent can scan "how's everyone doing"
// without expanding). Tap a row → full PerformanceCard + WorkplanEditor.
//
// Big "＋ Assign one-off work" CTA at the bottom (parent-only) routes
// to /pantry/workplan/assign. Step 6 ships that as a stub; Step 7
// builds the actual 4-field form + ad-hoc schema + helper notify.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { ChevronDown, ChevronUp, Settings as SettingsIcon } from 'lucide-react';
import BackButton from '@/components/ui/BackButton';
import WorkplanEditor from '@/components/helpers/WorkplanEditor';
import PerformanceCard from '@/components/helpers/PerformanceCard';
import { listHelpers } from '@/lib/helpers';
import { getHelperPerformance, perfFace, type HelperPerformanceWindow } from '@/lib/helperPerformance';
import {
  getTodaysFeedback, setFeedbackNote, deleteFeedbackNote,
  type HelperFeedbackNote, type FeedbackSentiment,
} from '@/lib/helperFeedback';
import { todayDateString } from '@/lib/workplan';
import type { HelperLink } from '@/lib/firestore';

// Emoji map per preset — same vocabulary as the role chips in
// Settings → Helpers add form. Used as the avatar on each row.
const PRESET_EMOJI: Record<HelperLink['preset'], string> = {
  nanny:       '🤱',
  tutor:       '📚',
  driver:      '🚗',
  gardener:    '🌿',
  grandparent: '👵',
  custom:      '🤝',
};

const PRESET_LABEL: Record<HelperLink['preset'], string> = {
  nanny:       'Nanny',
  tutor:       'Tutor',
  driver:      'Driver',
  gardener:    'Gardener',
  grandparent: 'Grandparent',
  custom:      'Custom',
};

export default function PantryWorkplanPage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  // Tracks rows the user has explicitly COLLAPSED. Default behaviour
  // is everything open — the page is a scan-at-a-glance scoreboard,
  // not a hierarchy. Chevron toggles add/remove from this set so a
  // parent can hide a row that's getting in the way.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!family) return;
    const list = await listHelpers(family.id);
    setHelpers(list.filter((h) => h.status !== 'removed'));
  }, [family]);
  useEffect(() => { reload(); }, [reload]);

  // Helpers reaching this page can only see their own row in detail
  // (rules already enforce workplan read-access); we hide other rows
  // entirely so the page makes sense to them too.
  const visibleHelpers = helpers
    ? (profile?.role === 'helper'
        ? helpers.filter((h) => h.uid === profile.uid)
        : helpers)
    : null;

  if (!family) return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Household · Workplan</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
            {visibleHelpers === null
              ? 'Today'
              : `Today · ${visibleHelpers.length} ${visibleHelpers.length === 1 ? 'helper' : 'helpers'}`}
          </h1>
        </div>
        {profile?.role === 'parent' && (
          <Link
            href="/settings/helpers"
            className="h-10 px-4 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px] inline-flex items-center gap-1.5 no-underline hover:bg-hive-cream"
          >
            <SettingsIcon size={14} /> Settings
          </Link>
        )}
      </div>

      <p className="text-[12px] text-hive-muted mb-4">
        {profile?.role === 'parent'
          ? <>Tap a helper to see / edit their plan. Use <strong>＋ Assign one-off work</strong> below for ad-hoc tasks outside their regular schedule.</>
          : <>Your duties for today + this week. Tap your row to expand the full plan.</>}
      </p>

      {visibleHelpers === null && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-6 text-center">
          <p className="font-nunito text-[13px] text-hive-muted">Loading…</p>
        </div>
      )}

      {visibleHelpers && visibleHelpers.length === 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">🤝</div>
          <p className="font-nunito font-extrabold text-[14px]">No helpers yet</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-4">
            Add a nanny, tutor, driver, gardener, or grandparent. Each one gets their own workplan + performance view.
          </p>
          {profile?.role === 'parent' && (
            <Link
              href="/settings/helpers"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] no-underline"
            >
              + Add helper in Settings
            </Link>
          )}
        </div>
      )}

      <div className="space-y-3">
        {(visibleHelpers ?? []).map((h) => (
          <PersonCard
            key={h.uid}
            helper={h}
            familyId={family.id}
            isParent={profile?.role === 'parent'}
            expanded={!collapsedIds.has(h.uid)}
            onToggle={() => setCollapsedIds((prev) => {
              const next = new Set(prev);
              if (next.has(h.uid)) next.delete(h.uid);
              else next.add(h.uid);
              return next;
            })}
          />
        ))}
      </div>

      {/* Big "＋ Assign one-off work" CTA — parent only. v4-final §04
          Phone 1 mock anchors this as the page's primary action: most
          recurring duties live on each helper's WorkplanEditor above,
          but ad-hoc one-offs ("buy extra chicken", "pick up cake") get
          assigned from here. Step 6 routes to a coming-soon stub;
          Step 7 ships the actual form + ad-hoc schema + push-notify. */}
      {profile?.role === 'parent' && visibleHelpers && visibleHelpers.length > 0 && (
        <div className="mt-6">
          <Link
            href="/pantry/workplan/assign"
            className="block w-full text-center bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-base py-4 rounded-hive border-2 border-hive-honey-dk no-underline"
          >
            ＋ Assign one-off work
          </Link>
          <p className="text-[11px] text-hive-muted text-center mt-2">
            Ad-hoc tasks outside the regular workplan — helper gets a notification.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Single person row ────────────────────────────────
function PersonCard({ helper, familyId, expanded, onToggle, isParent }: {
  helper: HelperLink;
  familyId: string;
  expanded: boolean;
  onToggle: () => void;
  /** Parent-only affordances inside the expanded card (e.g. the
   *  quick feedback strip — helpers can't write feedback on themselves). */
  isParent: boolean;
}) {
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg overflow-hidden">
      {/* Row header — always visible. Big emoji + name + role +
          inline perf indicator (face emoji + headline %). */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full p-4 flex items-center gap-3 text-left hover:bg-hive-cream/40"
      >
        <span className="text-4xl flex-shrink-0" aria-hidden>
          {PRESET_EMOJI[helper.preset]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-nunito font-extrabold text-[16px] truncate">
            {helper.displayName}
            {helper.status === 'paused' && (
              <span className="ml-2 text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold align-middle">
                Paused
              </span>
            )}
          </p>
          <p className="text-[12px] text-hive-muted mt-0.5 truncate">
            {PRESET_LABEL[helper.preset]} · code <span className="font-mono font-bold">{helper.helperCode}</span>
          </p>
          {/* Always-visible perf strip — face + headline %. Loads
              independently per row; falls back gracefully if no data. */}
          <PerfInline familyId={familyId} helperUid={helper.uid} />
        </div>
        {expanded ? <ChevronUp size={18} className="text-hive-muted flex-shrink-0" /> : <ChevronDown size={18} className="text-hive-muted flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-hive-line p-4 space-y-3 bg-hive-cream/30">
          {/* Quick feedback strip — parent-only. One tap registers
              👍 / 😐 / 👎 for today (upserts the day's note). Feeds
              the new parentFeedback metric in PerformanceCard. v3
              2026-05-18. */}
          {isParent && <FeedbackStrip familyId={familyId} helperUid={helper.uid} />}

          {/* Performance card — big, icon-first, top of expanded view */}
          <PerformanceCard
            familyId={familyId}
            helperUid={helper.uid}
            name={helper.displayName}
          />

          {/* Workplan editor (parent edits; helper views) */}
          <WorkplanEditor
            familyId={familyId}
            helperUid={helper.uid}
            helperName={helper.displayName}
            presetHint={helper.preset}
            defaultOpen={true}
          />
        </div>
      )}
    </div>
  );
}

// ── Inline perf indicator ────────────────────────────
// Tiny always-visible perf strip on the collapsed PersonCard row.
// Same data shape as PerformanceCard but renders as a one-liner so
// parents can scan the team without expanding every row.
// Color-coded face from `perfFace` keeps the visual fast to parse.
function PerfInline({ familyId, helperUid }: { familyId: string; helperUid: string }) {
  const [perf, setPerf] = useState<HelperPerformanceWindow | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getHelperPerformance(familyId, helperUid, { days: 7 });
        if (!cancelled) setPerf(p);
      } catch { /* graceful: render nothing on failure */ }
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid]);

  if (!perf) return null;
  const headlinePct = perf.consolidatedPct ?? perf.todayPct;
  const face = perfFace(headlinePct);
  const tone =
    face.tone === 'great' ? 'text-green-700' :
    face.tone === 'low'   ? 'text-red-700' :
                            'text-hive-navy';

  // Itemise the inputs the headline is built from.
  const inputs: string[] = [];
  if (perf.avgPct !== null) inputs.push(`Workplan ${perf.avgPct}%`);
  if (perf.budget.scorePct !== null) inputs.push(`Budget ${perf.budget.scorePct}%`);

  return (
    <p className="mt-1 text-[11px] inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-base leading-none" aria-hidden>{face.emoji}</span>
      <span className="font-nunito font-extrabold">
        {headlinePct === null
          ? <span className="text-hive-muted">No data yet</span>
          : <span className={tone}>{headlinePct}% · {face.label}</span>}
      </span>
      {inputs.length > 0 && (
        <span className="text-hive-muted">· {inputs.join(' · ')}</span>
      )}
    </p>
  );
}

// ── Feedback strip (v3 — 2026-05-18) ────────────────────────────
// Parent's daily 👍 / 😐 / 👎 on a helper. Upserts the day's note so
// tapping again switches the sentiment; tapping the active one
// removes the note. Inline optional comment ("Was late twice"). Feeds
// the parentFeedback metric in PerformanceCard.
function FeedbackStrip({ familyId, helperUid }: { familyId: string; helperUid: string }) {
  const { profile } = useAuth();
  const [today, setToday] = useState<HelperFeedbackNote | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const t = await getTodaysFeedback(familyId, helperUid);
      setToday(t);
      setNoteDraft(t?.note ?? '');
    } catch { /* swallow */ } finally { setLoaded(true); }
  }, [familyId, helperUid]);
  useEffect(() => { reload(); }, [reload]);

  const setSentiment = async (sentiment: FeedbackSentiment | null) => {
    if (!profile?.uid) return;
    setSaving(true);
    try {
      if (sentiment === null) {
        // Remove today's note.
        await deleteFeedbackNote(familyId, helperUid, todayDateString());
      } else {
        await setFeedbackNote(familyId, helperUid, {
          sentiment, note: noteDraft.trim() || undefined, byUid: profile.uid,
        });
      }
      await reload();
    } finally { setSaving(false); }
  };

  const saveNote = async () => {
    if (!profile?.uid || !today) return;
    setSaving(true);
    try {
      await setFeedbackNote(familyId, helperUid, {
        sentiment: today.sentiment,
        note: noteDraft.trim() || undefined,
        byUid: profile.uid,
      });
      setNoteOpen(false);
      await reload();
    } finally { setSaving(false); }
  };

  if (!loaded) return null;

  const OPTS: { id: FeedbackSentiment; emoji: string; label: string; bg: string }[] = [
    { id: 'positive', emoji: '👍', label: 'Going well',  bg: 'bg-green-100 text-green-800 border-green-400' },
    { id: 'neutral',  emoji: '😐', label: 'Okay',        bg: 'bg-kaya-cream text-kaya-chocolate border-kaya-warm-dark' },
    { id: 'negative', emoji: '👎', label: 'Concern',     bg: 'bg-red-50 text-red-700 border-red-300' },
  ];

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
      <p className="text-[10px] uppercase tracking-wider text-hive-muted font-bold inline-flex items-center gap-1.5">
        👍 Today's feedback
        {today && <span className="text-[9px] text-hive-muted normal-case font-normal">(tap again to change · ✕ to clear)</span>}
      </p>
      <div className="mt-2 flex gap-1.5 flex-wrap">
        {OPTS.map((o) => {
          const active = today?.sentiment === o.id;
          return (
            <button
              key={o.id}
              type="button"
              disabled={saving}
              onClick={() => setSentiment(active ? null : o.id)}
              className={`text-[12px] font-nunito font-extrabold px-3 py-1.5 rounded-full border-2 ${
                active ? o.bg + ' shadow-sm' : 'bg-hive-cream border-hive-line text-hive-muted'
              } disabled:opacity-50`}
            >
              {o.emoji} {o.label}
            </button>
          );
        })}
        {today && (
          <button
            type="button"
            disabled={saving}
            onClick={() => setSentiment(null)}
            className="text-[11px] text-hive-rose font-nunito font-bold px-2 py-1 disabled:opacity-50"
            aria-label="Clear today's feedback"
          >
            ✕ Clear
          </button>
        )}
      </div>
      {today && (
        noteOpen ? (
          <div className="mt-2">
            <input
              type="text"
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Optional note · e.g. 'Did the extra chicken run without being asked'"
              maxLength={140}
              className="w-full border border-hive-line rounded-lg px-2 py-1.5 text-[12px] font-nunito font-bold"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setNoteOpen(false); setNoteDraft(today.note ?? ''); }}
                className="text-[11px] text-hive-muted font-bold"
              >Cancel</button>
              <button
                type="button"
                onClick={saveNote}
                disabled={saving}
                className="text-[11px] text-pantry-leaf-dk font-extrabold underline disabled:opacity-50"
              >{saving ? 'Saving…' : 'Save note'}</button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="mt-2 text-[11px] font-nunito font-bold text-pantry-leaf-dk underline"
          >
            {today.note ? `✏️ "${today.note}"` : '＋ Add a note'}
          </button>
        )
      )}
    </div>
  );
}
