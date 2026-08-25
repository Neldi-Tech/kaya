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
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { ChevronDown, ChevronUp, Settings as SettingsIcon } from 'lucide-react';
import BackButton from '@/components/ui/BackButton';
import WorkplanEditor from '@/components/helpers/WorkplanEditor';
import PerformanceCard from '@/components/helpers/PerformanceCard';
import TodaysWorkplanCard from '@/components/helpers/TodaysWorkplanCard';
import RoutineFillTab from '@/components/helpers/RoutineFillTab';
import ScoreTab from '@/components/helpers/ScoreTab';
import KidReviewsTab from '@/components/helpers/KidReviewsTab';
import HelperRecognitionTab from '@/components/helpers/HelperRecognitionTab';
import CompareHelpersView from '@/components/helpers/CompareHelpersView';
import DayStepper from '@/components/helpers/DayStepper';
import { listHelpers, getHelperLink } from '@/lib/helpers';
import { getHelperPerformance, perfFace, type HelperPerformanceWindow } from '@/lib/helperPerformance';
import {
  listPendingCheckIns, approveCheckIn, approveAllPending, deleteCheckIn,
} from '@/lib/payCheckIns';
import type { PayCheckIn, PayBasis } from '@/lib/firestore';
import { toDisplayDate } from '@/lib/dates';
import {
  getTodaysFeedback, setFeedbackNote, deleteFeedbackNote,
  type HelperFeedbackNote, type FeedbackSentiment,
} from '@/lib/helperFeedback';
import { todayDateString } from '@/lib/workplan';
import { subscribeToPerformancePolicy, isHelperTracked } from '@/lib/performancePolicy';
import { fetchRatingsLite, helperToFillLite } from '@/lib/routineFill';
import { computeRoutineFill, fillCodes, mondayOf, addDays, ymdLocal } from '@/lib/routineFillCore';
import type { HelperLink, PerformancePolicy } from '@/lib/firestore';
import { Page } from '@/components/layout/Page';

// Emoji map per preset — same vocabulary as the role chips in
// Settings → Helpers add form. Used as the avatar on each row.
const PRESET_EMOJI: Record<HelperLink['preset'], string> = {
  nanny:       '🤱',
  tutor:       '📚',
  driver:      '🚗',
  gardener:    '🌿',
  security:    '🛡️',
  cleaner:     '🧽',
  cook:        '🍳',
  handyman:    '🛠️',
  grandparent: '👵',
  custom:      '🤝',
};

const PRESET_LABEL: Record<HelperLink['preset'], string> = {
  nanny:       'Nanny',
  tutor:       'Tutor',
  driver:      'Driver',
  gardener:    'Gardener',
  security:    'Security',
  cleaner:     'Cleaner',
  cook:        'Cook',
  handyman:    'Handyman',
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
  // HP2 — deep link from the weekly email: ?helper=<uid>&tab=score|fill|reviews
  // opens that helper on that tab (initial render only).
  const searchParams = useSearchParams();
  const deepHelper = searchParams.get('helper');
  const deepTabRaw = searchParams.get('tab');
  const deepTab: HelperTab | null = deepTabRaw === 'score' || deepTabRaw === 'fill' || deepTabRaw === 'reviews' || deepTabRaw === 'today' || deepTabRaw === 'recognition' ? deepTabRaw : null;
  // HP2 D1/D2 (2026-08-23) — the family's performance policy drives
  // which helpers show performance surfaces at all (tracked) and
  // whether a helper may see their own (helpersSeeOwnScore).
  const [policy, setPolicy] = useState<PerformancePolicy | null>(null);
  useEffect(() => {
    if (!family) return;
    return subscribeToPerformancePolicy(family.id, setPolicy);
  }, [family]);
  // Day-stepper (2026-05-21) — which calendar day the page is showing.
  // Defaults to today at local midnight; drives the workplan / feedback /
  // completion views inside each helper card. Local time → correct in
  // every timezone (Kaya helpers span the globe).
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  });

  const reload = useCallback(async () => {
    if (!family) return;
    // 2026-05-19 — Helpers can ONLY read their own /helpers/{uid} doc
    // (rule: `request.auth.uid == helperUid`). The original
    // listHelpers() call here did a getDocs over every helper doc in
    // the family; for a helper viewer the rule rejects all docs except
    // their own, which fails the whole query with permission_denied
    // and hangs the page in "Loading…". Fix: take the cheap path for
    // helpers and fetch a single doc; parents still need the full list.
    if (profile?.role === 'helper' && profile.uid) {
      try {
        const own = await getHelperLink(family.id, profile.uid);
        setHelpers(own && own.status !== 'removed' ? [own] : []);
      } catch {
        setHelpers([]);
      }
      return;
    }
    const list = await listHelpers(family.id);
    setHelpers(list.filter((h) => h.status !== 'removed'));
  }, [family, profile?.role, profile?.uid]);
  useEffect(() => { reload(); }, [reload]);

  // Helpers reaching this page can only see their own row in detail
  // (rules already enforce workplan read-access); we hide other rows
  // entirely so the page makes sense to them too.
  //
  // 2026-08-25 (Elia): for a PARENT, an UNTRACKED helper has nothing to
  // show on this page — no score, no dots, no Score / Kid reviews /
  // Recognition tabs — so they rendered as dead "not tracked" rows and
  // padded the rail. They are hidden here now. Nothing is stranded:
  // their workplan stays fully editable on Settings → Helpers (same
  // WorkplanEditor), and ＋ Assign one-off work still lists everyone.
  //
  // Two rows always survive the filter:
  //   · the viewer's own row (a helper is never hidden from themselves)
  //   · an explicitly deep-linked ?helper=<uid> (so an old link from an
  //     email or the Score tab still resolves instead of silently
  //     landing on somebody else)
  const untrackedHidden = helpers && profile?.role === 'parent'
    ? helpers.filter((h) => !isHelperTracked(policy, h.uid)
        && h.uid !== profile?.uid && h.uid !== deepHelper).length
    : 0;
  const visibleHelpers = helpers
    ? (profile?.role === 'helper'
        ? helpers.filter((h) => h.uid === profile.uid)
        : helpers.filter((h) => isHelperTracked(policy, h.uid)
            || h.uid === profile?.uid || h.uid === deepHelper))
    : null;

  // HP2 D16 — this week's routine-fill dots for every row: ONE ratings
  // range query for the week, then the shared pure compute per helper.
  const [weekCodes, setWeekCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!family || !visibleHelpers || visibleHelpers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const today = ymdLocal(new Date());
        const from = mondayOf(today); const to = addDays(from, 6);
        const ratings = await fetchRatingsLite(family.id, from, to);
        if (cancelled) return;
        const out: Record<string, string> = {};
        for (const h of visibleHelpers) {
          out[h.uid] = fillCodes(computeRoutineFill(helperToFillLite(h), ratings, from, to, today).days);
        }
        setWeekCodes(out);
      } catch { /* dots are decoration — fail quiet */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family?.id, helpers?.length]);

  // HP2 D16 — mount ONE layout (phone accordion OR desktop panes) so the
  // per-row performance reads don't run twice. SSR defaults to phone.
  const [isLg, setIsLg] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsLg(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  // HP2 D16 — desktop: which helper the detail pane shows + its tab.
  const [selectedUid, setSelectedUid] = useState<string | null>(deepHelper);
  const [desktopTab, setDesktopTab] = useState<HelperTab>(deepTab ?? 'today');
  // 🤝 HR PR-1 — fold the rail to a slim avatar strip once a helper is
  // picked (remembered), and ⚖️ compare mode for 2–3 helpers.
  const [railFolded, setRailFoldedState] = useState(() => {
    try { return localStorage.getItem('kayaHelperRailFolded') === '1'; } catch { return false; }
  });
  const setRailFolded = (v: boolean) => {
    setRailFoldedState(v);
    try { localStorage.setItem('kayaHelperRailFolded', v ? '1' : '0'); } catch { /* ignore */ }
  };
  const [compareOn, setCompareOn] = useState(false);
  const [compareUids, setCompareUids] = useState<string[]>([]);
  const toggleCompareUid = (uid: string) =>
    setCompareUids((p) => p.includes(uid) ? p.filter((x) => x !== uid) : p.length >= 3 ? p : [...p, uid]);
  const selectedHelper = visibleHelpers?.find((h) => h.uid === selectedUid) ?? visibleHelpers?.[0] ?? null;
  const showPerfFor = (h: HelperLink) =>
    isHelperTracked(policy, h.uid) && (profile?.role === 'parent' || policy?.helpersSeeOwnScore !== false);

  if (!family) return null;

  // Web-Fit (2026-08-23): wide tier container (was lg:max-w-6xl). The
  // two-pane desktop layout (HP2 D16) already exists below; mobile
  // accordion unchanged.
  return (
    <Page width="wide" className="pb-32 lg:pb-12">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Household · Workplan</p>
        {profile?.role === 'parent' && (
          <Link
            href="/settings/helpers"
            className="h-10 px-4 rounded-hive-pill bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[12px] inline-flex items-center gap-1.5 no-underline hover:bg-hive-cream"
          >
            <SettingsIcon size={14} /> Settings
          </Link>
        )}
      </div>

      {/* Day navigator — step back to Yesterday / ahead to Tomorrow.
          Drives every helper card's workplan / feedback / completion. */}
      <div className="lg:hidden">
        <DayStepper
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          helperCount={visibleHelpers === null ? null : visibleHelpers.length}
        />
      </div>

      <p className="text-[12px] text-hive-muted mb-4 lg:hidden">
        {profile?.role === 'parent'
          ? <>Tap a helper to see / edit their plan. Use <strong>＋ Assign one-off work</strong> below for ad-hoc tasks outside their regular schedule.</>
          : <>Your duties for today + this week. Tap your row to expand the full plan.</>}
      </p>

      {visibleHelpers === null && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-6 text-center">
          <p className="font-nunito text-[13px] text-hive-muted">Loading…</p>
        </div>
      )}

      {/* Empty state — two different empties. A family with 6 helpers and
          none tracked must NOT be told "No helpers yet"; they need the
          tracking switch, not the add-helper form. */}
      {visibleHelpers && visibleHelpers.length === 0 && untrackedHidden > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
          <div className="text-4xl mb-2">⚖️</div>
          <p className="font-nunito font-extrabold text-[14px]">No one is tracked yet</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-4">
            You have {untrackedHidden} {untrackedHidden === 1 ? 'helper' : 'helpers'}, but performance tracking is off for {untrackedHidden === 1 ? 'them' : 'all of them'} — so there is nothing to show here. Turn tracking on for anyone whose work you want scored.
          </p>
          <Link
            href="/settings/performance"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-hive-pill bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-extrabold text-[12px] no-underline"
          >
            ⚖️ Choose who&apos;s tracked
          </Link>
        </div>
      )}

      {visibleHelpers && visibleHelpers.length === 0 && untrackedHidden === 0 && (
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

      {/* ── Phone: the accordion (unchanged) ── */}
      {!isLg && <div className="space-y-3 lg:hidden">
        {(visibleHelpers ?? []).map((h) => (
          <PersonCard
            key={h.uid}
            helper={h}
            familyId={family.id}
            isParent={profile?.role === 'parent'}
            showPerf={showPerfFor(h)}
            initialTab={deepHelper === h.uid && deepTab ? deepTab : undefined}
            weekCodes={weekCodes[h.uid]}
            selectedDate={selectedDate}
            expanded={!collapsedIds.has(h.uid)}
            onToggle={() => setCollapsedIds((prev) => {
              const next = new Set(prev);
              if (next.has(h.uid)) next.delete(h.uid);
              else next.add(h.uid);
              return next;
            })}
          />
        ))}
      </div>}

      {/* ── Desktop (≥1024px): two panes — helper rail + detail (HP2 D16) ── */}
      {isLg && visibleHelpers && visibleHelpers.length > 0 && (
        <div className={`hidden lg:grid lg:gap-6 lg:items-start ${railFolded ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
          <aside className="lg:sticky lg:top-6 bg-hive-paper border border-hive-line rounded-hive-lg p-2">
            {railFolded ? (
              /* 🤝 HR PR-1 — slim avatar strip: results get the room. */
              <div className="flex flex-col items-center gap-1.5 py-1">
                <button type="button" onClick={() => setRailFolded(false)}
                  title="Open the helper list"
                  className="w-10 h-8 rounded-hive text-[13px] font-nunito font-black text-hive-muted hover:bg-hive-cream">›</button>
                {visibleHelpers.map((h) => (
                  <button
                    key={h.uid}
                    type="button"
                    onClick={() => { setSelectedUid(h.uid); if (compareOn) toggleCompareUid(h.uid); }}
                    title={h.displayName}
                    className={`w-10 h-10 rounded-hive text-xl flex items-center justify-center transition-colors ${
                      (compareOn ? compareUids.includes(h.uid) : selectedHelper?.uid === h.uid)
                        ? 'bg-hive-honey border-2 border-hive-honey-dk' : 'hover:bg-hive-cream'
                    }`}
                  >{PRESET_EMOJI[h.preset]}</button>
                ))}
              </div>
            ) : (
            <>
            <div className="flex items-center gap-1 px-2 pt-1 pb-2">
              <p className="flex-1 text-[10px] uppercase tracking-[1.5px] font-nunito font-black text-hive-muted">
                Helpers · {visibleHelpers.length}{untrackedHidden > 0 ? ` · ${untrackedHidden} not tracked` : ''}
              </p>
              {profile?.role === 'parent' && visibleHelpers.length >= 2 && (
                <button type="button"
                  onClick={() => {
                    const next = !compareOn;
                    setCompareOn(next);
                    if (next) setCompareUids(selectedHelper ? [selectedHelper.uid] : []);
                  }}
                  className={`px-2 py-1 rounded-full text-[10px] font-nunito font-black border ${compareOn ? 'bg-hive-ink text-white border-transparent' : 'bg-white text-hive-muted border-hive-line'}`}>
                  ⚖️ Compare
                </button>
              )}
              <button type="button" onClick={() => setRailFolded(true)} title="Fold the list"
                className="px-1.5 py-1 rounded-full text-[11px] font-nunito font-black text-hive-muted hover:bg-hive-cream">‹</button>
            </div>
            {compareOn && (
              <p className="px-2 pb-1.5 text-[10px] text-hive-muted font-bold">Pick 2–3 to compare · {compareUids.length} chosen</p>
            )}
            <div className="space-y-0.5">
              {visibleHelpers.map((h) => (
                <div key={h.uid} className={compareOn && compareUids.includes(h.uid) ? 'rounded-hive ring-2 ring-hive-honey-dk' : ''}>
                  <RailRow
                    helper={h}
                    familyId={family.id}
                    selected={compareOn ? compareUids.includes(h.uid) : selectedHelper?.uid === h.uid}
                    onSelect={() => (compareOn ? toggleCompareUid(h.uid) : setSelectedUid(h.uid))}
                    showPerf={showPerfFor(h)}
                    isParent={profile?.role === 'parent'}
                    weekCodes={weekCodes[h.uid]}
                  />
                </div>
              ))}
            </div>
            </>
            )}
            {/* Why the count shrank — untracked helpers are hidden here,
                not gone. One muted line keeps them one tap away. */}
            {!railFolded && untrackedHidden > 0 && (
              <Link
                href="/settings/performance"
                className="mt-2 flex items-center justify-between gap-2 px-2.5 py-2 rounded-hive bg-hive-paper border border-hive-line no-underline"
              >
                <span className="text-[10.5px] text-hive-muted">
                  ⚖️ {untrackedHidden} not tracked — hidden here
                </span>
                <span className="text-[10.5px] font-nunito font-black text-pantry-leaf-dk shrink-0">Change →</span>
              </Link>
            )}
            {!railFolded && profile?.role === 'parent' && (
              <Link
                href="/pantry/workplan/assign"
                className="mt-3 block w-full text-center bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-[13px] py-3 rounded-hive border-2 border-hive-honey-dk no-underline"
              >
                ＋ Assign one-off work
              </Link>
            )}
          </aside>
          <section className="min-w-0">
            {compareOn && compareUids.length >= 2 && profile?.role === 'parent' ? (
              <CompareHelpersView
                familyId={family.id}
                helpers={visibleHelpers.filter((h) => compareUids.includes(h.uid))}
              />
            ) : compareOn ? (
              <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
                <p className="text-3xl mb-2">⚖️</p>
                <p className="font-nunito font-extrabold text-[14px]">Pick {compareUids.length === 1 ? 'one more helper' : '2–3 helpers'} on the left to compare.</p>
              </div>
            ) : null}
            {!(compareOn) && selectedHelper && (
              <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-5xl flex-shrink-0" aria-hidden>{PRESET_EMOJI[selectedHelper.preset]}</span>
                    <div className="min-w-0">
                      <h2 className="font-nunito font-black text-2xl leading-tight truncate">
                        {selectedHelper.displayName}
                        {selectedHelper.status === 'paused' && <span className="ml-2 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold align-middle">Paused</span>}
                      </h2>
                      <p className="text-[12px] text-hive-muted truncate">
                        {PRESET_LABEL[selectedHelper.preset]} · code <span className="font-mono font-bold">{selectedHelper.helperCode}</span>
                        {selectedHelper.workDays && selectedHelper.workDays.length > 0 && selectedHelper.workDays.length < 7 ? ` · ${selectedHelper.workDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(' ')}` : ''}
                        {!showPerfFor(selectedHelper) && profile?.role === 'parent' ? ' · not tracked' : ''}
                      </p>
                    </div>
                  </div>
                  {showPerfFor(selectedHelper) && (
                    <div className="text-right flex-shrink-0">
                      <PerfInline familyId={family.id} helperUid={selectedHelper.uid} weekCodes={weekCodes[selectedHelper.uid]} compact />
                    </div>
                  )}
                </div>
                <HelperPanel
                  key={selectedHelper.uid}
                  helper={selectedHelper}
                  familyId={family.id}
                  isParent={profile?.role === 'parent'}
                  showPerf={showPerfFor(selectedHelper)}
                  selectedDate={selectedDate}
                  tab={desktopTab}
                  onTab={setDesktopTab}
                  dayStepper={
                    <DayStepper
                      selectedDate={selectedDate}
                      onChange={setSelectedDate}
                      helperCount={null}
                      compact
                    />
                  }
                />
              </div>
            )}
          </section>
        </div>
      )}

      {/* Big "＋ Assign one-off work" CTA — parent only. v4-final §04
          Phone 1 mock anchors this as the page's primary action: most
          recurring duties live on each helper's WorkplanEditor above,
          but ad-hoc one-offs ("buy extra chicken", "pick up cake") get
          assigned from here. Step 6 routes to a coming-soon stub;
          Step 7 ships the actual form + ad-hoc schema + push-notify. */}
      {profile?.role === 'parent' && visibleHelpers && visibleHelpers.length > 0 && (
        <div className="mt-6 lg:hidden">
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
    </Page>
  );
}

// ── Single person row (phone accordion) ─────────────────
function PersonCard({ helper, familyId, expanded, onToggle, isParent, showPerf, initialTab, selectedDate, weekCodes }: {
  helper: HelperLink;
  familyId: string;
  expanded: boolean;
  onToggle: () => void;
  /** Parent-only affordances inside the expanded card (e.g. the
   *  quick feedback strip — helpers can't write feedback on themselves). */
  isParent: boolean;
  /** HP2 D1/D2 — false hides every performance surface (face, %,
   *  feedback strip, performance card); the workplan stays. */
  showPerf: boolean;
  /** HP2 — open on this tab (deep link from emails). */
  initialTab?: HelperTab;
  /** Calendar day chosen in the page's day-stepper. */
  selectedDate: Date;
  /** HP2 — this week's routine-fill codes (7 chars) for the row dots. */
  weekCodes?: string;
}) {
  // HP2 D15 — four tabs inside the card. Today = the screen that was
  // here before (unchanged); the others are the long views. Tabs only
  // exist when performance is shown for this helper.
  const [tab, setTab] = useState<HelperTab>(initialTab ?? 'today');
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
            {!showPerf && isParent && <span className="ml-1.5 text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted/80">· not tracked</span>}
          </p>
          {/* Always-visible perf strip — face + headline % + this week's
              dots. Loads independently per row; falls back gracefully if
              no data. Hidden for untracked helpers (HP2 D1). */}
          {showPerf && <PerfInline familyId={familyId} helperUid={helper.uid} weekCodes={weekCodes} />}
        </div>
        {expanded ? <ChevronUp size={18} className="text-hive-muted flex-shrink-0" /> : <ChevronDown size={18} className="text-hive-muted flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-hive-line p-4 space-y-3 bg-hive-cream/30">
          <HelperPanel
            helper={helper}
            familyId={familyId}
            isParent={isParent}
            showPerf={showPerf}
            selectedDate={selectedDate}
            tab={tab}
            onTab={setTab}
          />
        </div>
      )}
    </div>
  );
}

// ── The helper's four tabs + content — shared by the phone accordion
//    body and the desktop detail pane (HP2 D15/D16). Today = the
//    original screen, unchanged. ─────────────────────────────────
function HelperPanel({ helper, familyId, isParent, showPerf, selectedDate, tab, onTab, dayStepper }: {
  helper: HelperLink;
  familyId: string;
  isParent: boolean;
  showPerf: boolean;
  selectedDate: Date;
  tab: HelperTab;
  onTab: (t: HelperTab) => void;
  /** Desktop: the compact day chips render inside the Today tab. */
  dayStepper?: React.ReactNode;
}) {
  // past / today / future drives which surfaces show + whether they're
  // editable. String compare on local YYYY-MM-DD keys (timezone-safe).
  const selStr = todayDateString(selectedDate);
  const todayStr = todayDateString();
  const dayKind: 'past' | 'today' | 'future' =
    selStr < todayStr ? 'past' : selStr > todayStr ? 'future' : 'today';
  const activeTab: HelperTab = showPerf ? tab : 'today';
  return (
    <>
      {showPerf && (
        <HelperTabs tab={activeTab} onChange={onTab} isParent={isParent} />
      )}

      {activeTab === 'fill' && (
        <RoutineFillTab familyId={familyId} helper={helper} isParent={isParent} />
      )}
      {activeTab === 'score' && (
        <ScoreTab familyId={familyId} helper={helper} isParent={isParent} />
      )}
      {activeTab === 'reviews' && isParent && (
        <KidReviewsTab helper={helper} />
      )}
      {activeTab === 'recognition' && isParent && (
        <HelperRecognitionTab helper={helper} familyId={familyId} />
      )}

      {activeTab === 'today' && <>
      {dayStepper}
      {/* Future preview banner — nothing's happened yet (2026-05-21). */}
      {dayKind === 'future' && (
        <div className="rounded-hive border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] leading-snug text-blue-800">
          <span className="font-nunito font-black">📅 Coming up.</span> The plan for this day. Nothing&apos;s been done yet — performance &amp; feedback appear once the day arrives.
        </div>
      )}

      {/* Quick feedback strip — parent-only.
          · today → live, one tap sets 👍 / 😐 / 👎 (feeds the
            parentFeedback metric in PerformanceCard).
          · past  → that day's feedback, read-only.
          · future → hidden (handled by the banner above). */}
      {isParent && showPerf && dayKind === 'today' && (
        <FeedbackStrip familyId={familyId} helperUid={helper.uid} />
      )}
      {isParent && showPerf && dayKind === 'past' && (
        <FeedbackStrip familyId={familyId} helperUid={helper.uid} date={selectedDate} readOnly />
      )}

      {/* Pay check-in approvals — today-only: it's a live to-approve
          queue, not a per-day record. v3 2026-05-19. */}
      {isParent && dayKind === 'today' && (helper.payrollConfig?.basis === 'hourly' || helper.payrollConfig?.basis === 'daily') && (
        <CheckInApprovals
          familyId={familyId}
          helperUid={helper.uid}
          basis={helper.payrollConfig.basis}
        />
      )}

      {/* Performance card — full rolling card on today. Off-today the
          slim per-day result lives in the workplan card header
          instead (Decision B, 2026-05-21). On desktop the card and the
          workplan sit side by side (two columns) — same components. */}
      <div className={dayKind === 'today' && showPerf ? 'lg:grid lg:grid-cols-2 lg:gap-3 space-y-3 lg:space-y-0' : ''}>
        {showPerf && dayKind === 'today' && (
          <PerformanceCard
            familyId={familyId}
            helperUid={helper.uid}
            name={helper.displayName}
          />
        )}

        {/* Workplan view.
            · today → parent gets the full editor; helper gets the
              tap-to-tick daily card.
            · off-today → read-only per-day view for BOTH roles
              (a settled record for past, a preview for future). */}
        <div>
          {dayKind === 'today' ? (
            isParent ? (
              <WorkplanEditor
                familyId={familyId}
                helperUid={helper.uid}
                helperName={helper.displayName}
                presetHint={helper.preset}
                defaultOpen={true}
              />
            ) : (
              <TodaysWorkplanCard
                familyId={familyId}
                helperUid={helper.uid}
              />
            )
          ) : (
            <TodaysWorkplanCard
              familyId={familyId}
              helperUid={helper.uid}
              date={selectedDate}
              readOnly
            />
          )}
        </div>
      </div>
      </>}
    </>
  );
}

// ── HP2 D16 · desktop rail row ──────────────────────────────────
function RailRow({ helper, familyId, selected, onSelect, showPerf, isParent, weekCodes }: {
  helper: HelperLink; familyId: string; selected: boolean; onSelect: () => void; showPerf: boolean; isParent: boolean; weekCodes?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left flex items-center gap-3 p-3 rounded-hive-lg border transition ${selected ? 'bg-pantry-leaf-soft border-pantry-leaf' : 'border-transparent hover:bg-hive-cream/60'}`}
    >
      <span className="text-3xl flex-shrink-0" aria-hidden>{PRESET_EMOJI[helper.preset]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-nunito font-extrabold text-[14px] truncate">
          {helper.displayName}
          {helper.status === 'paused' && <span className="ml-2 text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-bold align-middle">Paused</span>}
        </p>
        <p className="text-[11px] text-hive-muted truncate">
          {PRESET_LABEL[helper.preset]}{!showPerf && isParent ? ' · not tracked' : ''}
        </p>
        {showPerf && <PerfInline familyId={familyId} helperUid={helper.uid} weekCodes={weekCodes} compact />}
      </div>
    </button>
  );
}

function WeekDots({ codes }: { codes?: string }) {
  if (!codes) return null;
  const cls = (c: string) =>
    c === 'G' ? 'bg-green-500' : c === 'A' ? 'bg-amber-400' : c === 'R' ? 'bg-red-500' :
    c === 'T' ? 'bg-white border border-dashed border-amber-400' : c === 'F' ? 'bg-gray-100' : 'bg-gray-200';
  return (
    <span className="inline-flex gap-[3px] align-middle" title="This week · Mon→Sun · 🟢 all slots · 🟡 some · 🔴 none · ⚪ off">
      {codes.split('').map((c, i) => <i key={i} className={`inline-block w-2 h-2 rounded-full ${cls(c)}`} />)}
    </span>
  );
}

// ── HP2 · tabs inside a helper card (D15) ───────────────────────
type HelperTab = 'today' | 'fill' | 'score' | 'reviews' | 'recognition';
const HELPER_TABS: { id: HelperTab; label: string; parentOnly?: boolean; soon?: boolean }[] = [
  { id: 'today',   label: 'Today' },
  { id: 'fill',    label: 'Routine fill' },
  { id: 'score',   label: 'Score' },
  { id: 'reviews', label: 'Kid reviews', parentOnly: true },
  // 🤝 HR PR-1 — the recognition scorecard (5 dials), parent-only.
  { id: 'recognition', label: '🤝 Recognition', parentOnly: true },
];
function HelperTabs({ tab, onChange, isParent }: { tab: HelperTab; onChange: (t: HelperTab) => void; isParent: boolean }) {
  const tabs = HELPER_TABS.filter((t) => !t.parentOnly || isParent);
  return (
    <div className="grid gap-1 p-1 rounded-hive bg-hive-line/60" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          disabled={t.soon}
          onClick={() => onChange(t.id)}
          title={t.soon ? 'Coming in the next update' : undefined}
          className={`h-8 rounded-[10px] text-[11px] font-nunito font-extrabold truncate px-1 ${tab === t.id ? 'bg-hive-paper text-hive-navy shadow-sm' : 'text-hive-muted'} disabled:opacity-40`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Inline perf indicator ────────────────────────────
// Tiny always-visible perf strip on the collapsed PersonCard row.
// Same data shape as PerformanceCard but renders as a one-liner so
// parents can scan the team without expanding every row.
// Color-coded face from `perfFace` keeps the visual fast to parse.
function PerfInline({ familyId, helperUid, weekCodes, compact = false }: { familyId: string; helperUid: string; weekCodes?: string; compact?: boolean }) {
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

  if (!perf) return weekCodes ? <p className="mt-1 text-[11px]"><WeekDots codes={weekCodes} /></p> : null;
  const headlinePct = perf.consolidatedPct ?? perf.todayPct;
  const face = perfFace(headlinePct, perf.policy.thresholds);
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
      {weekCodes && <>· <WeekDots codes={weekCodes} /></>}
      {!compact && inputs.length > 0 && (
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
function FeedbackStrip({ familyId, helperUid, date, readOnly = false }: {
  familyId: string;
  helperUid: string;
  /** Day to show; defaults to today. */
  date?: Date;
  /** Read-only display of a past day's feedback (no editing). */
  readOnly?: boolean;
}) {
  const { profile } = useAuth();
  const [today, setToday] = useState<HelperFeedbackNote | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const t = await getTodaysFeedback(familyId, helperUid, todayDateString(date));
      setToday(t);
      setNoteDraft(t?.note ?? '');
    } catch { /* swallow */ } finally { setLoaded(true); }
  }, [familyId, helperUid, date]);
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

  // Read-only variant (a past day via the day-stepper) — show the
  // recorded sentiment + note, no editing controls. Decision A
  // (2026-05-21): only today is editable.
  if (readOnly) {
    const picked = today ? OPTS.find((o) => o.id === today.sentiment) : null;
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
        <p className="text-[10px] uppercase tracking-wider text-hive-muted font-bold inline-flex items-center gap-1.5">
          👍 Feedback{date ? ` · ${toDisplayDate(todayDateString(date))}` : ''}
        </p>
        {picked ? (
          <div className="mt-2">
            <span className={`inline-block text-[12px] font-nunito font-extrabold px-3 py-1.5 rounded-full border-2 ${picked.bg}`}>
              {picked.emoji} {picked.label}
            </span>
            {today?.note && (
              <p className="mt-2 text-[11px] text-hive-muted italic">&ldquo;{today.note}&rdquo;</p>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-hive-muted italic">No feedback logged that day.</p>
        )}
      </div>
    );
  }

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

// ── Pay check-in approvals (v3 — 2026-05-19) ────────────────────
// Parent-only strip inside each expanded helper card. Lists unapproved
// pay check-ins (hourly hours / daily-flag rows) for this helper +
// one-tap per-row Approve + Approve-all button.
function CheckInApprovals({
  familyId, helperUid, basis,
}: { familyId: string; helperUid: string; basis: PayBasis }) {
  const { profile } = useAuth();
  const [pending, setPending] = useState<PayCheckIn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await listPendingCheckIns(familyId, helperUid);
      setPending(list);
    } catch { /* swallow */ } finally { setLoaded(true); }
  }, [familyId, helperUid]);
  useEffect(() => { reload(); }, [reload]);

  if (!loaded) return null;

  const total = pending.length;
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <p className="text-[10px] uppercase tracking-wider text-hive-muted font-bold inline-flex items-center gap-1.5">
          🕒 Pay check-ins · {basis === 'hourly' ? 'hours' : 'days'}
          {total > 0 && (
            <span className="text-[10px] normal-case font-bold tracking-normal text-hive-honey-dk">
              · {total} waiting for your nod
            </span>
          )}
        </p>
        {total > 0 && (
          <button
            type="button"
            disabled={busy || !profile?.uid}
            onClick={async () => {
              if (!profile?.uid) return;
              setBusy(true);
              try { await approveAllPending(familyId, helperUid, profile.uid); await reload(); }
              finally { setBusy(false); }
            }}
            className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk underline disabled:opacity-50"
          >
            ✓ Approve all
          </button>
        )}
      </div>
      {total === 0 ? (
        <p className="text-[11px] text-hive-muted italic">All caught up — no check-ins waiting.</p>
      ) : (
        <ul className="space-y-1">
          {pending.map((c) => (
            <li key={c.date} className="flex items-center gap-2 text-[12px]">
              <span className="text-hive-muted font-bold w-24 flex-shrink-0">{toDisplayDate(c.date)}</span>
              <span className="flex-1 font-bold">
                {c.hours} {basis === 'hourly' ? 'h' : (c.hours === 1 ? 'day' : 'days')}
                {c.note && <span className="text-hive-muted font-normal italic ml-1.5">· {c.note}</span>}
              </span>
              <button
                type="button"
                disabled={busy || !profile?.uid}
                onClick={async () => {
                  if (!profile?.uid) return;
                  setBusy(true);
                  try { await approveCheckIn(familyId, helperUid, c.date, profile.uid); await reload(); }
                  finally { setBusy(false); }
                }}
                className="text-[11px] font-extrabold text-green-700 px-1.5 disabled:opacity-50"
              >✓ Approve</button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await deleteCheckIn(familyId, helperUid, c.date); await reload(); }
                  finally { setBusy(false); }
                }}
                className="text-[11px] font-bold text-hive-rose px-1 disabled:opacity-50"
                aria-label="Reject + remove"
              >×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
