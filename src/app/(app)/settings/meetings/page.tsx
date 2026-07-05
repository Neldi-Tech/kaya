'use client';

// /settings/meetings — Family Meeting setup.
//
// Parent-only page for configuring how the Presenter Mode meeting
// runs each week. Three sections:
//
//   1. Agenda flow         — pick which of the 6 standard steps to
//                            include tonight (defaults: all on).
//   2. Closing reflection  — pick which of the three closings the
//                            presenter offers (Story / Songs / Prayer).
//                            Useful for families that always close with
//                            the same one (e.g. only Prayer).
//   3. Prayer library      — add/edit/delete multiple saved prayers.
//                            On meeting night, the Prayer closing
//                            preloads a random one from the library;
//                            parents can still type or paste a fresh
//                            prayer instead.
//
// All settings persist on the Family document under `meetingSetup`.
// Empty / undefined = default behaviour (everything on, no prayers).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { updateFamily, ReflectionMode } from '@/lib/firestore';
import { SURPRISE_REGISTRY } from '@/lib/meetingSurprises';
import BackButton from '@/components/ui/BackButton';

// Canonical agenda steps — kept in lockstep with `STEPS` in
// /meetings/present/page.tsx. Order here is the default presentation
// order; the saved `agendaSteps` array preserves whatever order the
// parent picked (so future drag-to-reorder is a small follow-up).
const AGENDA_STEPS: Array<{ id: string; emoji: string; title: string; desc: string }> = [
  { id: 'attendance',    emoji: '👋', title: 'Attendance',         desc: 'Who is here + anyone presenting' },
  { id: 'gratitude',     emoji: '🙏', title: 'Gratitude Circle',   desc: 'What everyone is thankful for' },
  { id: 'celebrate',     emoji: '🎉', title: 'Celebrate the Wins', desc: 'Cast the Points Review and walk the week' },
  { id: 'appreciations', emoji: '💛', title: 'Appreciations',      desc: 'What we appreciated about each other' },
  { id: 'goals',         emoji: '🎯', title: 'Goals Review',       desc: 'Review last weeks + commit for next week' },
  { id: 'reflection',    emoji: '✨', title: 'Closing Reflection', desc: 'Story, songs, or family prayer' },
];

const CLOSING_MODES: Array<{ id: ReflectionMode; emoji: string; title: string; sub: string }> = [
  { id: 'story',  emoji: '📖', title: 'Inspiring Story', sub: 'Paste a story or a link to read together.' },
  { id: 'songs',  emoji: '🎵', title: 'Songs',            sub: 'Gospel, family favorites, anything that lifts the room.' },
  { id: 'prayer', emoji: '🙏', title: 'Family Prayer',    sub: 'A short prayer to close the night.' },
];

type SavedPrayer = { id: string; title: string; body: string; createdAt: number };

function makeId() {
  return `prayer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function MeetingSetupPage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const confirmAction = useConfirm();

  // ── Local state, seeded from family doc once family loads ────────
  const [agendaSteps, setAgendaSteps] = useState<string[]>(AGENDA_STEPS.map((s) => s.id));
  const [closingEnabled, setClosingEnabled] = useState<ReflectionMode[]>(['story', 'songs', 'prayer']);
  // Sunday-Meeting v2 (b5): when ON, a kid-attached song link in the
  // closing reflection needs a parent OK before the play button works.
  // Default ON (conservative).
  const [kidSongLinkRequiresApproval, setKidSongLinkRequiresApproval] = useState<boolean>(true);
  // Sunday-Meeting v2 (b6): email a one-page "Meeting Recap Book" to
  // parents + Family contacts after the meeting submits. Defaults ON.
  const [recapBookIncludeSong, setRecapBookIncludeSong] = useState<boolean>(true);
  // Meeting Notes (2026-06-21): WHO gets the auto-sent notes. Replaces the
  // old on/off toggle (saved boolean kept in sync for older readers).
  const [recapBookRecipients, setRecapBookRecipients] = useState<'off' | 'parents' | 'all'>('parents');
  // Sunday-Meeting v2 (b7): how long a Time Capsule stays sealed.
  const [timeCapsuleLockYears, setTimeCapsuleLockYears] = useState<0.5 | 1 | 3>(1);
  // SM3.1 (#2): 🙏 Opening Word — step on/off (default ON), required-to-
  // continue gate (default OFF), and whether the saved prayers library
  // surfaces during the step (default OFF — prayer comes from the heart).
  const [openingWordEnabled, setOpeningWordEnabled] = useState<boolean>(true);
  const [openingWordRequired, setOpeningWordRequired] = useState<boolean>(false);
  const [openingWordShowLibrary, setOpeningWordShowLibrary] = useState<boolean>(false);
  // SM3.1 (#7): 🎁 Sunday Surprise — master step toggle + per-type overrides
  // (absent = registry defaults) + the parent-stocked Golden Ticket list.
  const [sundaySurpriseEnabled, setSundaySurpriseEnabled] = useState<boolean>(true);
  const [surpriseToggles, setSurpriseToggles] = useState<Record<string, boolean>>({});
  const [goldenTickets, setGoldenTickets] = useState<string[]>([]);
  const [ticketDraft, setTicketDraft] = useState('');
  const [prayers, setPrayers] = useState<SavedPrayer[]>([]);
  // Per-step display-name override. Empty / missing entry = use the
  // canonical default title from AGENDA_STEPS.
  const [stepLabels, setStepLabels] = useState<Record<string, string>>({});
  // Recurring meeting schedule (day-of-week + 24h time). null = no
  // schedule set yet — the meetings hub shows no reminder banner.
  const [scheduleDay, setScheduleDay] = useState<number | null>(null);
  const [scheduleTime, setScheduleTime] = useState<string>('');
  const [seeded, setSeeded] = useState(false);

  // Prayer composer state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  // Save UX
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Seed local state from family doc on first load.
  useEffect(() => {
    if (seeded || !family) return;
    const s = family.meetingSetup;
    if (s?.agendaSteps && s.agendaSteps.length > 0) setAgendaSteps(s.agendaSteps);
    if (s?.closingModesEnabled && s.closingModesEnabled.length > 0) setClosingEnabled(s.closingModesEnabled);
    if (typeof s?.kidSongLinkRequiresApproval === 'boolean') setKidSongLinkRequiresApproval(s.kidSongLinkRequiresApproval);
    if (typeof s?.recapBookIncludeSong === 'boolean') setRecapBookIncludeSong(s.recapBookIncludeSong);
    setRecapBookRecipients(s?.recapBookRecipients ?? ((s?.recapBookEmailEnabled ?? true) ? 'parents' : 'off'));
    if (s?.timeCapsuleLockYears === 0.5 || s?.timeCapsuleLockYears === 1 || s?.timeCapsuleLockYears === 3) {
      setTimeCapsuleLockYears(s.timeCapsuleLockYears);
    }
    if (typeof s?.openingWordEnabled === 'boolean') setOpeningWordEnabled(s.openingWordEnabled);
    if (typeof s?.openingWordRequired === 'boolean') setOpeningWordRequired(s.openingWordRequired);
    if (typeof s?.openingWordShowLibrary === 'boolean') setOpeningWordShowLibrary(s.openingWordShowLibrary);
    if (typeof s?.sundaySurpriseEnabled === 'boolean') setSundaySurpriseEnabled(s.sundaySurpriseEnabled);
    if (s?.surprises) setSurpriseToggles(s.surprises);
    if (Array.isArray(s?.goldenTickets)) setGoldenTickets(s.goldenTickets);
    if (s?.prayers && s.prayers.length > 0) setPrayers(s.prayers);
    if (s?.stepLabels) setStepLabels(s.stepLabels);
    if (s?.schedule) {
      setScheduleDay(typeof s.schedule.dayOfWeek === 'number' ? s.schedule.dayOfWeek : null);
      setScheduleTime(s.schedule.time || '');
    }
    setSeeded(true);
  }, [family, seeded]);

  // ── Mutators ─────────────────────────────────────────────────────
  const toggleAgendaStep = (id: string) => {
    setAgendaSteps((prev) => {
      if (prev.includes(id)) {
        // Keep at least one step so the presenter has something to show.
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== id);
      }
      // Preserve canonical order when re-adding.
      const next = [...prev, id];
      return AGENDA_STEPS.map((s) => s.id).filter((s) => next.includes(s));
    });
  };

  const toggleClosingMode = (id: ReflectionMode) => {
    setClosingEnabled((prev) => {
      if (prev.includes(id)) {
        // Keep at least one — disabling all would leave the presenter
        // with no closing options.
        if (prev.length <= 1) return prev;
        return prev.filter((m) => m !== id);
      }
      return [...prev, id];
    });
  };

  const startNewPrayer = () => {
    setEditingId('__new__');
    setDraftTitle('');
    setDraftBody('');
  };
  const startEditPrayer = (p: SavedPrayer) => {
    setEditingId(p.id);
    setDraftTitle(p.title);
    setDraftBody(p.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraftTitle('');
    setDraftBody('');
  };
  const savePrayer = () => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title || !body) return;
    setPrayers((prev) => {
      if (editingId && editingId !== '__new__') {
        return prev.map((p) => p.id === editingId ? { ...p, title, body } : p);
      }
      return [...prev, { id: makeId(), title, body, createdAt: Date.now() }];
    });
    cancelEdit();
  };
  const deletePrayer = async (id: string) => {
    const ok = await confirmAction({
      title: 'Delete this prayer?',
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setPrayers((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  };

  // ── Persist to Firestore ─────────────────────────────────────────
  const handleSave = async () => {
    if (!profile?.familyId) return;
    setSaving(true);
    // Trim + drop empty entries so a parent who clears a custom label
    // falls back to the canonical default cleanly.
    const cleanedLabels: Record<string, string> = {};
    for (const [id, v] of Object.entries(stepLabels)) {
      const t = (v || '').trim();
      if (t) cleanedLabels[id] = t;
    }
    const schedule = (scheduleDay !== null && /^\d{2}:\d{2}$/.test(scheduleTime))
      ? { dayOfWeek: scheduleDay, time: scheduleTime }
      : undefined;
    await updateFamily(profile.familyId, {
      meetingSetup: {
        agendaSteps,
        closingModesEnabled: closingEnabled,
        prayers,
        stepLabels: cleanedLabels,
        schedule,
        kidSongLinkRequiresApproval,
        recapBookEmailEnabled: recapBookRecipients !== 'off',
        recapBookRecipients,
        recapBookIncludeSong,
        timeCapsuleLockYears,
        openingWordEnabled,
        openingWordRequired,
        openingWordShowLibrary,
        sundaySurpriseEnabled,
        surprises: surpriseToggles,
        goldenTickets,
      },
    });
    setSaving(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2200);
  };

  const allAgendaStepsOn = agendaSteps.length === AGENDA_STEPS.length;
  const allClosingsOn = closingEnabled.length === CLOSING_MODES.length;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      {/* Hero */}
      <div className="mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Settings · Family meetings</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Meeting setup ⚙️</h1>
        <p className="text-sm text-kaya-sand mt-1">
          Configure what Presenter Mode shows each week — your agenda, your closing, your prayer library.
        </p>
      </div>

      {/* ── Agenda flow ─────────────────────────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">Agenda flow</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {agendaSteps.length} of {AGENDA_STEPS.length} on
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          Pick which steps run during the meeting. {allAgendaStepsOn ? 'All steps on — the standard rhythm.' : 'A trimmed-down meeting.'}
        </p>
        <div className="space-y-2">
          {AGENDA_STEPS.map((s) => {
            const on = agendaSteps.includes(s.id);
            const customLabel = stepLabels[s.id] || '';
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-kaya border transition-colors ${
                  on
                    ? 'bg-kaya-gold/10 border-kaya-gold/50'
                    : 'bg-kaya-warm/40 border-kaya-warm-dark'
                }`}
              >
                <span className="text-xl shrink-0">{s.emoji}</span>
                <div className="flex-1 min-w-0">
                  {/* Inline editable label — placeholder shows the canonical
                      default so parents see what they'd revert to by clearing. */}
                  <input
                    value={customLabel}
                    onChange={(e) => setStepLabels({ ...stepLabels, [s.id]: e.target.value })}
                    placeholder={s.title}
                    aria-label={`Custom label for ${s.title}`}
                    className={`w-full bg-transparent border-0 outline-none px-0 py-0 font-display font-extrabold text-[14px] lg:text-base focus:ring-0 ${
                      on ? 'text-kaya-chocolate placeholder-kaya-chocolate/60' : 'text-kaya-sand placeholder-kaya-sand/60'
                    }`}
                  />
                  <span className={`block text-[12px] mt-0.5 ${on ? 'text-kaya-chocolate/70' : 'text-kaya-sand'}`}>
                    {s.desc}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAgendaStep(s.id)}
                  aria-pressed={on}
                  aria-label={on ? `Turn ${s.title} off` : `Turn ${s.title} on`}
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black transition-colors ${
                    on ? 'bg-kaya-gold text-kaya-chocolate hover:bg-kaya-gold-dark' : 'bg-kaya-warm-dark text-kaya-sand hover:bg-kaya-sand/30'
                  }`}
                >
                  {on ? '✓' : ' '}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] lg:text-[12px] text-kaya-sand mt-3 px-1">
          Tap the step name to rename it (e.g. "Sunday Circle" instead of "Gratitude Circle"). Leave blank to use the default.
        </p>
      </section>

      {/* ── Closing reflection ──────────────────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">Closing reflection</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {closingEnabled.length} of {CLOSING_MODES.length} on
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          Which closings the parent can pick during the meeting. Turn off the ones your family doesn't use.
          {allClosingsOn && ' All three on — parents pick on the night.'}
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {CLOSING_MODES.map((c) => {
            const on = closingEnabled.includes(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => toggleClosingMode(c.id)}
                aria-pressed={on}
                className={`relative rounded-kaya-lg p-5 text-left transition-all border-2 ${
                  on
                    ? 'bg-kaya-gold/10 border-kaya-gold'
                    : 'bg-kaya-warm/40 border-kaya-warm-dark hover:bg-kaya-warm'
                }`}
              >
                <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-sm font-black bg-kaya-warm-dark text-kaya-sand">
                  {on && <span className="w-7 h-7 rounded-full flex items-center justify-center bg-kaya-gold text-kaya-chocolate">✓</span>}
                </div>
                <div className="text-3xl lg:text-4xl mb-2" aria-hidden>{c.emoji}</div>
                <div className={`font-display font-black text-base lg:text-lg mb-1 ${on ? 'text-kaya-chocolate' : 'text-kaya-sand'}`}>
                  {c.title}
                </div>
                <p className={`text-[12px] lg:text-[13px] leading-relaxed ${on ? 'text-kaya-chocolate/65' : 'text-kaya-sand'}`}>{c.sub}</p>
              </button>
            );
          })}
        </div>

        {/* Sunday-Meeting v2 (b5) — kid song approval toggle */}
        <div className="mt-5 rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={kidSongLinkRequiresApproval}
              onChange={(e) => setKidSongLinkRequiresApproval(e.target.checked)}
              className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-sm text-kaya-chocolate">
                🛡️ Kid-attached songs need a parent OK
              </p>
              <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">
                When a kid pastes a YouTube/Spotify link in the closing reflection,
                Kaya asks a parent to tap &ldquo;approve&rdquo; before the play button works.
                Parent-pasted links are always cleared. Default: on.
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* ── 🙏 Opening Word (SM3.1 · #2) ─────────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">🙏 Opening Word</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {openingWordEnabled ? (openingWordRequired ? 'Required' : 'On') : 'Off'}
          </span>
        </div>
        <p className="text-[12.5px] lg:text-sm text-kaya-sand leading-snug mb-4">
          The leader opens the night with a prayer, a word of wisdom, or a verse —
          spoken from the heart. Marking it done stamps the meeting record.
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4">
            <input
              type="checkbox"
              checked={openingWordEnabled}
              onChange={(e) => setOpeningWordEnabled(e.target.checked)}
              className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-sm text-kaya-chocolate">Include the Opening Word step</p>
              <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">
                Shows right after Attendance. Default: on.
              </p>
            </div>
          </label>
          <label className={`flex items-start gap-3 rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4 ${openingWordEnabled ? 'cursor-pointer' : 'opacity-50'}`}>
            <input
              type="checkbox"
              checked={openingWordRequired}
              disabled={!openingWordEnabled}
              onChange={(e) => setOpeningWordRequired(e.target.checked)}
              className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-sm text-kaya-chocolate">Must be completed to continue</p>
              <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">
                When on, the meeting can&rsquo;t move past this step until the leader marks the opening done.
                When off, a &ldquo;Skip for tonight&rdquo; link appears. Default: off.
              </p>
            </div>
          </label>
          <label className={`flex items-start gap-3 rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4 ${openingWordEnabled ? 'cursor-pointer' : 'opacity-50'}`}>
            <input
              type="checkbox"
              checked={openingWordShowLibrary}
              disabled={!openingWordEnabled}
              onChange={(e) => setOpeningWordShowLibrary(e.target.checked)}
              className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-sm text-kaya-chocolate">📖 Show the prayer library during the step</p>
              <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">
                Prayer comes from the heart by default — nothing to read. Switch this on if your
                family likes reading a saved prayer out loud. Default: off.
              </p>
            </div>
          </label>
        </div>
      </section>

      {/* ── 🎁 Sunday Surprise (SM3.1 · #7) ──────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">🎁 Sunday Surprise</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {sundaySurpriseEnabled ? 'On' : 'Off'}
          </span>
        </div>
        <p className="text-[12.5px] lg:text-sm text-kaya-sand leading-snug mb-4">
          One shared moment to end the meeting — Kaya picks a surprise from the ones you enable
          (the leader can swap on the night). Photos &amp; videos post to Moments automatically.
        </p>
        <label className="flex items-start gap-3 cursor-pointer rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4 mb-3">
          <input type="checkbox" checked={sundaySurpriseEnabled}
            onChange={(e) => setSundaySurpriseEnabled(e.target.checked)}
            className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer" />
          <div className="flex-1 min-w-0">
            <p className="font-display font-extrabold text-sm text-kaya-chocolate">Include the Sunday Surprise step</p>
            <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">The final step of the meeting. Default: on.</p>
          </div>
        </label>
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-2 ${sundaySurpriseEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
          {SURPRISE_REGISTRY.map((sd) => {
            const on = typeof surpriseToggles[sd.id] === 'boolean' ? surpriseToggles[sd.id] : sd.defaultEnabled;
            return (
              <label key={sd.id} className="flex items-start gap-3 cursor-pointer rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-3.5">
                <input type="checkbox" checked={on}
                  onChange={(e) => setSurpriseToggles((prev) => ({ ...prev, [sd.id]: e.target.checked }))}
                  className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer" />
                <div className="flex-1 min-w-0">
                  <p className="font-display font-extrabold text-[13px] text-kaya-chocolate">{sd.emoji} {sd.name}</p>
                  <p className="text-[12px] text-kaya-chocolate/70 leading-snug mt-0.5">{sd.blurb}</p>
                </div>
              </label>
            );
          })}
        </div>
        <div className={`mt-4 ${sundaySurpriseEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <p className="font-display font-extrabold text-sm text-kaya-chocolate mb-1">🍬 Golden Ticket jar</p>
          <p className="text-[12px] text-kaya-sand mb-2">Small real-world treats the ticket can land on — e.g. &ldquo;choose Sunday dessert&rdquo;, &ldquo;car music for a week&rdquo;.</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {goldenTickets.map((t, i) => (
              <span key={`${t}-${i}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-kaya-warm text-[12px] font-bold text-kaya-chocolate">
                {t}
                <button type="button" aria-label={`Remove ${t}`}
                  onClick={() => setGoldenTickets((prev) => prev.filter((_, j) => j !== i))}
                  className="text-kaya-chocolate/50 hover:text-rose-600 font-black">✕</button>
              </span>
            ))}
            {goldenTickets.length === 0 && <span className="text-[12px] text-kaya-sand italic">The jar is empty.</span>}
          </div>
          <div className="flex gap-2">
            <input value={ticketDraft} onChange={(e) => setTicketDraft(e.target.value)}
              placeholder="Add a treat…" maxLength={60}
              className="flex-1 h-10 border border-kaya-warm-dark rounded-kaya-sm px-3 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-kaya-gold/60" />
            <button type="button"
              onClick={() => { const t = ticketDraft.trim(); if (t) { setGoldenTickets((prev) => [...prev, t]); setTicketDraft(''); } }}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-chocolate text-white text-[13px] font-display font-extrabold">
              Add
            </button>
          </div>
        </div>
      </section>

      {/* ── Recap Book email (Sunday-Meeting v2 · b6) ────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">📨 Meeting Recap Book</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {recapBookRecipients === 'off' ? 'Off' : recapBookRecipients === 'all' ? 'All participants' : 'Parents'}
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          After every meeting, Kaya emails parents a one-page recap book — attendance,
          gratitudes, appreciations, points, goals, and the closing. Grandparents and
          aunties stay close to your weekly ritual without needing to be in the room.
        </p>
        <div className="rounded-kaya border border-kaya-warm-dark/70 bg-kaya-cream/50 p-4 space-y-3">
          <div>
            <p className="font-display font-extrabold text-sm text-kaya-chocolate">
              📨 Auto-send the meeting notes to…
            </p>
            <div className="flex gap-2 mt-2">
              {([
                ['off', 'Off'],
                ['parents', 'Parents only'],
                ['all', 'All participants'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRecapBookRecipients(key)}
                  className={`flex-1 h-10 rounded-kaya-sm font-display font-extrabold text-[12px] border-2 transition-colors ${
                    recapBookRecipients === key
                      ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate'
                      : 'bg-white text-kaya-chocolate border-kaya-warm-dark hover:bg-kaya-warm'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-kaya-chocolate/60 leading-snug mt-2">
              {recapBookRecipients === 'off'
                ? 'No automatic email — share manually from any meeting\u2019s notes.'
                : recapBookRecipients === 'parents'
                  ? '\ud83d\udce8 Parents get the notes after each meeting.'
                  : '\ud83d\udce8 Everyone who attended (with an email on file) gets the notes \u2014 kids included.'}
            </p>
          </div>
          <label className={`flex items-start gap-3 cursor-pointer ${recapBookRecipients === 'off' ? 'opacity-50' : ''}`}>
            <input
              type="checkbox"
              checked={recapBookIncludeSong}
              disabled={recapBookRecipients === 'off'}
              onChange={(e) => setRecapBookIncludeSong(e.target.checked)}
              className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <p className="font-display font-extrabold text-sm text-kaya-chocolate">
                🎵 Include the closing song link
              </p>
              <p className="text-[12.5px] text-kaya-chocolate/70 leading-snug mt-0.5">
                Embeds a tap-to-open link to whatever song the leader picked.
              </p>
            </div>
          </label>
          <div className="text-[11.5px] text-kaya-chocolate/55 italic pl-8">
            📸 Week-in-Moments thumbnails + 📎 PDF attach — coming soon (the recap email
            already covers the rest of the design).
          </div>
        </div>
      </section>

      {/* ── Family Time Capsule (Sunday-Meeting v2 · b7) ──────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">💌 Family Time Capsule</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {timeCapsuleLockYears === 0.5 ? '6 months' : timeCapsuleLockYears === 3 ? '3 years' : '1 year'}
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          At the end of each meeting one person can leave a single line — a hope, a quote,
          a tiny prediction. Kaya seals it for the lock window and surfaces it on the meeting
          closest to that anniversary (snapped to your scheduled meeting day · ±3 days).
        </p>
        <div className="flex gap-2 flex-wrap">
          {[0.5, 1, 3].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTimeCapsuleLockYears(n as 0.5 | 1 | 3)}
              className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-sm font-extrabold transition-colors ${
                timeCapsuleLockYears === n
                  ? 'bg-kaya-gold text-kaya-chocolate border-2 border-kaya-gold-dark'
                  : 'bg-kaya-cream text-kaya-chocolate border-2 border-kaya-warm-dark/40 hover:bg-kaya-warm'
              }`}
            >
              {n === 0.5 ? '6 months' : n === 3 ? '3 years' : '1 year'}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-kaya-chocolate/55 italic">
          The sealer field is always optional — if nobody writes anything, no capsule is created.
          Sealed notes can never be edited or deleted (a sealed note is a sealed note).
        </p>
      </section>

      {/* ── Schedule ─────────────────────────────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">Meeting day &amp; time ⏰</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {scheduleDay !== null && scheduleTime ? 'Reminder on' : 'Not set'}
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          Pick the regular day and time you run the meeting. On that day, the Meetings hub shows a "Meeting tonight at HH:mm" banner so no one forgets.
        </p>

        <div className="space-y-4">
          {/* Day chips */}
          <div>
            <label className="block text-[12px] lg:text-[13px] font-bold text-kaya-chocolate mb-2">
              Day of the week
            </label>
            <div className="flex flex-wrap gap-1.5">
              {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label, idx) => {
                const picked = scheduleDay === idx;
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => setScheduleDay(picked ? null : idx)}
                    aria-pressed={picked}
                    className={`h-10 lg:h-11 min-w-[52px] lg:min-w-[60px] px-3 rounded-kaya-sm font-display font-extrabold text-[13px] lg:text-sm transition-colors ${
                      picked
                        ? 'bg-kaya-chocolate text-kaya-gold-light'
                        : 'bg-kaya-warm/60 text-kaya-sand border border-kaya-warm-dark hover:bg-kaya-warm'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time picker */}
          <div>
            <label
              htmlFor="meeting-time"
              className="block text-[12px] lg:text-[13px] font-bold text-kaya-chocolate mb-2"
            >
              Start time
            </label>
            <input
              id="meeting-time"
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="h-11 lg:h-12 w-44 bg-kaya-warm/60 border border-kaya-warm-dark rounded-kaya-sm px-3.5 text-[14px] lg:text-base font-display font-extrabold text-kaya-chocolate focus:outline-none focus:ring-2 focus:ring-kaya-gold/50"
            />
          </div>

          {scheduleDay !== null && scheduleTime && (
            <div className="bg-kaya-gold/10 border border-kaya-gold/40 rounded-kaya p-3 text-[12px] lg:text-[13px] text-kaya-chocolate">
              ⏰ Reminder will show every <strong>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][scheduleDay]}</strong> at <strong>{scheduleTime}</strong>.
            </div>
          )}
          {(scheduleDay === null || !scheduleTime) && (scheduleDay !== null || scheduleTime) && (
            <p className="text-[11px] text-kaya-sand">
              Pick both a day and a time — partial selections won't save.
            </p>
          )}
        </div>
      </section>

      {/* ── Prayer library ─────────────────────────────────────── */}
      <section className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="font-display text-lg lg:text-xl font-black">Prayer library 🙏</h2>
          <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">
            {prayers.length} saved
          </span>
        </div>
        <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-4">
          Save multiple prayers — Presenter Mode picks one at random when you choose the Prayer closing.
          You can always type or paste a different one on the night.
        </p>

        {/* List */}
        {prayers.length > 0 && (
          <div className="space-y-2 mb-4">
            {prayers.map((p) => (
              <div
                key={p.id}
                className="bg-kaya-warm/40 border border-kaya-warm-dark rounded-kaya p-3.5 lg:p-4"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="font-display font-extrabold text-[14px] lg:text-base text-kaya-chocolate truncate">
                    {p.title}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEditPrayer(p)}
                      className="text-[11px] lg:text-[12px] font-bold text-kaya-chocolate/70 hover:text-kaya-chocolate"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePrayer(p.id)}
                      className="text-[11px] lg:text-[12px] font-bold text-kaya-sand hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-[12px] lg:text-[13px] text-kaya-chocolate/70 leading-snug whitespace-pre-line line-clamp-3">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Composer */}
        {editingId !== null ? (
          <div className="bg-kaya-cream border border-kaya-gold/40 rounded-kaya p-4 lg:p-5">
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-kaya-gold-dark mb-2">
              {editingId === '__new__' ? 'New prayer' : 'Edit prayer'}
            </p>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Title — e.g. 'Sunday evening prayer'"
              className="w-full h-11 lg:h-12 bg-white border border-kaya-warm-dark rounded-kaya-sm px-3.5 text-[14px] lg:text-base font-display font-extrabold text-kaya-chocolate placeholder-kaya-sand mb-3 focus:outline-none focus:ring-2 focus:ring-kaya-gold/50"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Paste or type the prayer. Stanzas separated by a blank line render as paragraphs in Presenter Mode."
              rows={8}
              className="w-full bg-white border border-kaya-warm-dark rounded-kaya-sm px-3.5 py-3 text-[13px] lg:text-[14px] text-kaya-chocolate placeholder-kaya-sand resize-none leading-relaxed focus:outline-none focus:ring-2 focus:ring-kaya-gold/50"
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={savePrayer}
                disabled={!draftTitle.trim() || !draftBody.trim()}
                className="flex-1 h-11 rounded-kaya-sm bg-kaya-chocolate text-kaya-gold-light font-display font-extrabold text-[13px] lg:text-sm transition-colors hover:bg-kaya-chocolate-light disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingId === '__new__' ? '+ Save prayer' : '✓ Save changes'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="h-11 px-5 rounded-kaya-sm bg-white border border-kaya-warm-dark text-kaya-sand font-display font-extrabold text-[13px] lg:text-sm hover:bg-kaya-warm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startNewPrayer}
            className="w-full h-12 lg:h-14 rounded-kaya border-2 border-dashed border-kaya-warm-dark text-kaya-sand font-display font-extrabold text-[13px] lg:text-sm hover:bg-kaya-warm hover:border-kaya-chocolate/40 hover:text-kaya-chocolate transition-colors"
          >
            + Add a prayer
          </button>
        )}
      </section>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 lg:bottom-8 z-10">
        <div className="bg-kaya-chocolate text-kaya-gold-light rounded-kaya-lg shadow-2xl p-4 lg:p-5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-display font-extrabold text-[13px] lg:text-sm">
              {savedFlash ? '✅ Saved' : 'Save your meeting setup'}
            </div>
            <div className="text-[11px] lg:text-[12px] opacity-70">
              {savedFlash ? 'Presenter mode will use these settings next time you start a meeting.' : 'Your changes apply the next time you open Presenter Mode.'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="shrink-0 h-11 lg:h-12 px-5 lg:px-6 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13px] lg:text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="mt-3 text-center">
          <Link
            href="/meetings/present"
            className="text-[12px] lg:text-[13px] font-bold text-kaya-sand hover:text-kaya-chocolate"
          >
            Try it in Presenter Mode →
          </Link>
        </div>
      </div>
    </div>
  );
}
