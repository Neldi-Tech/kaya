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
import { updateFamily, ReflectionMode } from '@/lib/firestore';
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

  // ── Local state, seeded from family doc once family loads ────────
  const [agendaSteps, setAgendaSteps] = useState<string[]>(AGENDA_STEPS.map((s) => s.id));
  const [closingEnabled, setClosingEnabled] = useState<ReflectionMode[]>(['story', 'songs', 'prayer']);
  const [prayers, setPrayers] = useState<SavedPrayer[]>([]);
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
    if (s?.prayers && s.prayers.length > 0) setPrayers(s.prayers);
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
  const deletePrayer = (id: string) => {
    if (!confirm('Delete this prayer? This can\'t be undone.')) return;
    setPrayers((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  };

  // ── Persist to Firestore ─────────────────────────────────────────
  const handleSave = async () => {
    if (!profile?.familyId) return;
    setSaving(true);
    await updateFamily(profile.familyId, {
      meetingSetup: {
        agendaSteps,
        closingModesEnabled: closingEnabled,
        prayers,
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
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => toggleAgendaStep(s.id)}
                aria-pressed={on}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-kaya border transition-colors text-left ${
                  on
                    ? 'bg-kaya-gold/10 border-kaya-gold/50'
                    : 'bg-kaya-warm/40 border-kaya-warm-dark hover:bg-kaya-warm'
                }`}
              >
                <span className="text-xl shrink-0">{s.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block font-display font-extrabold text-[14px] lg:text-base ${on ? 'text-kaya-chocolate' : 'text-kaya-sand'}`}>
                    {s.title}
                  </span>
                  <span className={`block text-[12px] mt-0.5 ${on ? 'text-kaya-chocolate/70' : 'text-kaya-sand'}`}>
                    {s.desc}
                  </span>
                </span>
                <span
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-sm font-black ${
                    on ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-kaya-warm-dark text-kaya-sand'
                  }`}
                >
                  {on ? '✓' : ' '}
                </span>
              </button>
            );
          })}
        </div>
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
