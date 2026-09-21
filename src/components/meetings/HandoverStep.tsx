'use client';

// 🤝 Passing the Crown — the hand-over ceremony step (approved design v2,
// 21-Sep-2026 · S18–S23 · R21–R31).
//
// Order of service, ~3 minutes, at the CLOSE of the meeting (the crown
// really moves one tap later, at Finish):
//   ① Outgoing leader's speech — their real week + three sentence-starters
//      + the advice line for the next leader (captured, optional).
//   ② Incoming leader's speech — the Leader's Pledge (five principles = the
//      five leadership traits, read aloud, tap → gold) + their own words.
//   ③ The crown passes — the advice card, a parent's blessing, a first job.
//
// "Must be said": the page locks Next until both speeches are marked said;
// the only way round is "Skip tonight…" with a reason that lands on the
// Meeting Report. State is LIFTED to the presenter page (it must survive
// the Points-Review remount, like the roster).

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth as fbAuth } from '@/lib/firebase';
import RichNote from '@/components/ui/RichNote';
import {
  LEADER_PLEDGE, PLEDGE_RESPONSE, TRAIT_META, BLESSING_PROMPT, HANDOVER_SKIP_REASONS,
  RENEWAL_STARTERS, LITTLE_STARTER, outgoingStarters, incomingStarters,
  type LeaderConfig, type MeetingHandover,
} from '@/lib/leaderWeek.shared';
import type { HandoverBrief } from '@/lib/leaderWeek';

export type HandoverPhase = 'intro' | 'out' | 'pledge' | 'words' | 'crown';
export type HandoverVariant = MeetingHandover['variant'];

export interface HandoverState {
  phase: HandoverPhase;
  outSaid: boolean;
  inSaid: boolean;
  /** Indices of pledge lines said aloud (5 principles, then the family's adds). */
  pledged: number[];
  advice: string;
  blessingBy: string;
  skipped: { reason: string; label: string } | null;
}

export const EMPTY_HANDOVER: HandoverState = {
  phase: 'intro', outSaid: false, inSaid: false, pledged: [], advice: '', blessingBy: '', skipped: null,
};

export interface HandoverPerson { id: string; name: string; emoji: string; kind: 'kid' | 'parent' | 'helper' }

/** Which shape tonight's hand-over takes (F12, F15, F16). */
export function handoverVariant(o: {
  crown: HandoverPerson | null; incoming: HandoverPerson | null; incomingPresent: boolean; little: boolean;
}): HandoverVariant {
  if (!o.incoming) return 'standard';
  if (o.incoming.kind !== 'kid') return 'adult';
  if (o.crown && o.crown.id === o.incoming.id) return 'renewal';
  if (!o.incomingPresent) return 'absent';
  if (o.little) return 'little';
  if (!o.crown) return 'no-crown';
  return 'standard';
}

const needsOut = (v: HandoverVariant, hasSpeaker: boolean) => v !== 'renewal' && hasSpeaker;
const needsIn = (v: HandoverVariant) => v !== 'absent';

/** Both speeches said (or honestly skipped) — what unlocks Next. */
export function handoverComplete(s: HandoverState, v: HandoverVariant, hasOutSpeaker: boolean, hasIncoming: boolean): boolean {
  if (s.skipped) return true;
  if (!hasIncoming) return false;
  return (needsOut(v, hasOutSpeaker) ? s.outSaid : true) && (needsIn(v) ? s.inSaid : true);
}

/** The record stamped on tonight's meeting doc (S26). */
export function buildMeetingHandover(o: {
  state: HandoverState; variant: HandoverVariant; speaker: HandoverPerson | null; incoming: HandoverPerson | null; pledgeOf: number;
}): MeetingHandover | null {
  const { state: s, variant, speaker, incoming, pledgeOf } = o;
  if (!incoming && !s.skipped) return null;
  return {
    variant,
    ...(speaker ? { outgoing: { id: speaker.id, name: speaker.name, emoji: speaker.emoji, said: s.outSaid } } : {}),
    ...(incoming ? { incoming: { id: incoming.id, name: incoming.name, emoji: incoming.emoji, kind: incoming.kind, said: s.inSaid, pledged: s.pledged.length, pledgeOf } } : {}),
    ...(s.advice.trim() ? { advice: s.advice.trim().slice(0, 200) } : {}),
    ...(s.blessingBy ? { blessingBy: s.blessingBy } : {}),
    ...(s.skipped ? { skipped: s.skipped } : {}),
  };
}

// Soft 60-second ring — a guide, never a cut-off.
function SoftRing({ runKey }: { runKey: string }) {
  const [left, setLeft] = useState(60);
  useEffect(() => {
    setLeft(60);
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [runKey]);
  const pct = (left / 60) * 100;
  return (
    <div
      className="ml-auto shrink-0 w-10 h-10 rounded-full grid place-items-center text-[10px] font-black text-white"
      style={{ background: `conic-gradient(#D4A017 ${pct}%, rgba(255,255,255,0.15) 0)` }}
      aria-label={`${left} seconds left — a guide only`}
      title="A guide — take the time you need"
    >
      <span className="w-[30px] h-[30px] rounded-full grid place-items-center bg-kaya-chocolate">0:{String(left).padStart(2, '0')}</span>
    </div>
  );
}

const LBL = 'text-[10px] uppercase tracking-[0.16em] font-extrabold text-kaya-gold-light mt-4 mb-2';
const CARD = 'rounded-kaya-lg border border-white/15 bg-white/[0.04] p-4 lg:p-5';

export default function HandoverStep({
  familyId, crown, tonightLeader, incoming, incomingPresent, cfg, brief, parents,
  state, onChange, hasSurprise, onContinue, pickSlot,
}: {
  familyId: string;
  /** Who wears the 👑 now — the outgoing speaker (F12). */
  crown: HandoverPerson | null;
  /** Tonight's meeting leader — gives the closing word when nobody wears the crown. */
  tonightLeader: HandoverPerson | null;
  /** The next leader, picked TONIGHT (wheel or a parent's tap). */
  incoming: HandoverPerson | null;
  incomingPresent: boolean;
  cfg: LeaderConfig;
  brief: HandoverBrief | null;
  parents: Array<{ uid: string; name: string }>;
  state: HandoverState;
  onChange: (next: HandoverState) => void;
  hasSurprise: boolean;
  onContinue: () => void;
  /** The wheel — rendered first when no next leader has been picked yet (R22). */
  pickSlot: ReactNode;
}) {
  const [skipOpen, setSkipOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  void familyId;

  const little = !!brief?.incoming && brief.incoming.childId === incoming?.id && brief.incoming.little;
  const variant = handoverVariant({ crown, incoming, incomingPresent, little });
  const speaker = variant === 'renewal' ? null : (crown || tonightLeader);
  const pledgeLines = useMemo(
    () => [...LEADER_PLEDGE.map((l) => ({ ...l, family: false })), ...cfg.customDuties.map((d) => ({ emoji: '🏠', text: d, trait: null, family: true }))],
    [cfg.customDuties],
  );
  const set = (patch: Partial<HandoverState>) => onChange({ ...state, ...patch });
  const first = (n?: string) => (n || '').split(' ')[0];

  // Which phases tonight's variant walks through.
  const phases: HandoverPhase[] = useMemo(() => {
    switch (variant) {
      case 'absent': return ['intro', 'out', 'crown'];
      case 'adult': return ['intro', ...(speaker ? ['out' as const] : []), 'words', 'crown'];
      case 'renewal': return ['intro', 'pledge', 'words', 'crown'];
      default: return ['intro', ...(speaker ? ['out' as const] : []), 'pledge', 'words', 'crown'];
    }
  }, [variant, speaker]);
  const phase: HandoverPhase = phases.includes(state.phase) ? state.phase : 'intro';
  const go = (dir: 1 | -1) => {
    const i = phases.indexOf(phase);
    const next = phases[Math.max(0, Math.min(phases.length - 1, i + dir))];
    set({ phase: next });
  };

  const tidy = async () => {
    if (aiBusy) return;
    setAiBusy(true); setAiNote('');
    try {
      const token = await fbAuth.currentUser?.getIdToken();
      const res = await fetch('/api/meetings/note-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mode: 'tidy', text: state.advice, to: first(incoming?.name) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.skipped) { setAiNote('Kaya’s writing help isn’t switched on here — your own words are perfect.'); return; }
      if (!res.ok || typeof data?.text !== 'string') { setAiNote(typeof data?.error === 'string' ? data.error : 'Kaya couldn’t tidy it just now.'); return; }
      set({ advice: data.text });
    } catch { setAiNote('No connection — your own words are perfect as they are.'); }
    finally { setAiBusy(false); }
  };

  // ── No next leader yet → the wheel first (R22) ─────────────────────
  if (!incoming && !state.skipped) {
    return (
      <div className="space-y-4">
        <div className={`${CARD} text-center`}>
          <p className="text-[13px] text-white/80 leading-relaxed">
            <b className="text-white">First, pick who leads next.</b> The hand-over begins the moment a new leader is chosen.
          </p>
        </div>
        {pickSlot}
        {cfg.handoverRequired && (
          <button type="button" onClick={() => setSkipOpen(true)} className="block mx-auto text-[11px] font-bold text-white/50 underline">Skip tonight…</button>
        )}
        {skipOpen && <SkipSheet onClose={() => setSkipOpen(false)} onPick={(r) => { set({ skipped: r }); setSkipOpen(false); }} />}
      </div>
    );
  }

  // ── Skipped — honest, visible, undoable ────────────────────────────
  if (state.skipped) {
    return (
      <div className={`${CARD} text-center`}>
        <p className="text-3xl mb-2" aria-hidden>⏭</p>
        <p className="font-display font-black text-lg">Hand-over skipped tonight</p>
        <p className="text-[13px] text-white/70 mt-1">{state.skipped.label} — it goes on the Meeting Report.</p>
        {incoming?.kind === 'kid' && (
          <p className="text-[12px] text-kaya-gold-light mt-2">📜 The pledge will be waiting on {first(incoming.name)}&apos;s Home screen.</p>
        )}
        <button type="button" onClick={() => set({ skipped: null })} className="mt-3 h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 text-white text-[12px] font-bold">↩︎ Undo — let&apos;s do it</button>
      </div>
    );
  }

  const inc = incoming!;
  const b = brief?.outgoing && speaker && brief.outgoing.childId === speaker.id ? brief.outgoing : null;
  const led = brief?.incoming && brief.incoming.childId === inc.id ? brief.incoming : null;

  return (
    <div className="space-y-4">
      {/* ── S18 · the order of service ─────────────────────────────── */}
      {phase === 'intro' && (
        <div className={CARD}>
          <div className="flex items-center justify-center gap-4 my-1">
            {variant !== 'renewal' && speaker && (
              <>
                <div className="text-center">
                  <div className="text-4xl leading-none">{speaker.emoji}</div>
                  <p className="text-[12px] font-black mt-1">{first(speaker.name)}</p>
                  <p className="text-[9px] uppercase tracking-[0.14em] font-black text-white/55">{crown ? '👑 outgoing' : 'leading tonight'}</p>
                </div>
                <span className="text-2xl text-kaya-gold-light" aria-hidden>➜</span>
              </>
            )}
            <div className="text-center">
              <div className="text-4xl leading-none">{inc.emoji}</div>
              <p className="text-[12px] font-black mt-1">{first(inc.name)}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] font-black text-white/55">{variant === 'renewal' ? '👑 leading again' : 'incoming'}</p>
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            {phases.filter((p) => p !== 'intro' && p !== 'words').map((p, i) => {
              const row = p === 'out'
                ? { t: crown ? 'Outgoing leader’s speech' : 'Tonight’s leader — a closing word', s: 'my week · my lesson · my advice', d: '~1 min' }
                : p === 'pledge'
                  ? { t: variant === 'renewal' ? 'The pledge, re-taken + a renewal speech' : 'Incoming leader’s speech', s: variant === 'little' ? 'a parent reads the Pledge · “I promise!”' : 'the Leader’s Pledge + my own words', d: '~1 min' }
                  : { t: 'The crown passes', s: `${cfg.handoverBlessing ? 'a parent’s blessing · ' : ''}${hasSurprise ? 'first job as leader' : 'then we close'}`, d: '~30 s' };
              return (
                <div key={p} className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2">
                  <span className="w-6 h-6 rounded-full bg-kaya-gold text-kaya-chocolate grid place-items-center text-[11px] font-black shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-extrabold">{row.t}</span>
                    <span className="block text-[10.5px] text-white/55 font-bold">{row.s}</span>
                  </span>
                  <span className="text-[10.5px] text-white/55 font-bold whitespace-nowrap">{row.d}</span>
                </div>
              );
            })}
            {variant === 'adult' && (
              <p className="text-[11.5px] text-white/60 pt-1">👤 {first(inc.name)} is a grown-up — a short word tonight; the 👑 still goes to a kid through the appoint card on Home.</p>
            )}
            {variant === 'absent' && (
              <p className="text-[11.5px] text-kaya-gold-light pt-1">🛌 {first(inc.name)} isn&apos;t here tonight — the pledge will wait on {first(inc.name)}&apos;s Home screen.</p>
            )}
          </div>
          <div className="text-center mt-4">
            <button type="button" onClick={() => go(1)} className="h-11 px-6 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-sm">Begin the hand-over →</button>
          </div>
        </div>
      )}

      {/* ── S19 · ① outgoing leader's speech ──────────────────────── */}
      {phase === 'out' && speaker && (
        <div className={CARD}>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{speaker.emoji}</span>
            <div className="min-w-0">
              <p className="font-display font-black text-[15px] leading-tight">{first(speaker.name)}&apos;s {crown ? 'farewell' : 'closing word'}</p>
              <p className="text-[11px] text-white/60 font-bold">Stand up · speak from the heart · no reading needed</p>
            </div>
            <SoftRing runKey="out" />
          </div>
          {b && (
            <>
              <p className={LBL}>Your week as leader</p>
              <div className="flex flex-wrap gap-1.5">
                <Fact>📒 {b.notes} note{b.notes === 1 ? '' : 's'}</Fact>
                <Fact>✅ {b.approved} approved</Fact>
                {b.siblings > 0 && <Fact>👀 noticed {b.siblingsNoticed >= b.siblings ? `all ${b.siblings}` : `${b.siblingsNoticed} of ${b.siblings}`} sibling{b.siblings === 1 ? '' : 's'}</Fact>}
                {b.mission && <Fact>🎯 mission {b.mission.done ? 'done' : 'in progress'}</Fact>}
                {tonightLeader?.id === speaker.id && <Fact>🎤 led tonight</Fact>}
              </div>
            </>
          )}
          <p className={LBL}>Say it in your own words</p>
          <div className="space-y-1.5">
            {outgoingStarters(first(inc.name)).map((t) => <Starter key={t}>{t}</Starter>)}
          </div>
          <p className={LBL}>Keep the advice for {first(inc.name)} <span className="normal-case tracking-normal font-bold text-white/50">· optional · one line</span></p>
          <RichNote
            tone="dark" rows={2} maxLength={200}
            value={state.advice} onChange={(v) => set({ advice: v })}
            placeholder={`What ${first(speaker.name)} said — in ${first(speaker.name)}'s own words`}
            aiLabel="✨ Help me say it" onAi={tidy} aiBusy={aiBusy} aiDisabled={state.advice.trim().split(/\s+/).filter(Boolean).length < 3}
            ariaLabel="Advice for the next leader"
          />
          {aiNote && <p className="text-[11px] text-white/60 mt-1.5">{aiNote}</p>}
          <SaidButton said={state.outSaid} onToggle={() => set({ outSaid: !state.outSaid })} />
          <PhaseNav onBack={() => go(-1)} onNext={() => go(1)} nextLabel={variant === 'absent' ? 'The crown passes →' : `${first(inc.name)}'s turn →`} />
          {cfg.handoverRequired && <button type="button" onClick={() => setSkipOpen(true)} className="block mx-auto mt-2 text-[11px] font-bold text-white/50 underline">Skip tonight…</button>}
        </div>
      )}

      {/* ── S20 · ② the Leader's Pledge ───────────────────────────── */}
      {phase === 'pledge' && (
        <div className={CARD}>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{inc.emoji}</span>
            <div className="min-w-0">
              <p className="font-display font-black text-[15px] leading-tight">{first(inc.name)} takes the pledge</p>
              <p className="text-[11px] text-white/60 font-bold">
                {variant === 'little' ? 'A parent reads each line — answer “I promise!” — tap it when it’s said' : 'Read each line out loud — tap it when it’s said'}
              </p>
            </div>
            <SoftRing runKey="pledge" />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {led && led.led > 0
              ? <><Fact>👑 You&apos;ve led {led.led}×</Fact>{led.strongest && <Fact>your strongest: {TRAIT_META[led.strongest].emoji} {TRAIT_META[led.strongest].label}</Fact>}</>
              : <Fact>👑 First time wearing the crown</Fact>}
          </div>
          <p className={LBL}>📜 The Leader&apos;s Pledge · 5 principles</p>
          <div className="space-y-1.5">
            {pledgeLines.map((l, i) => {
              if (l.family && i === LEADER_PLEDGE.length) {
                // header before the first family line
              }
              const on = state.pledged.includes(i);
              return (
                <div key={i}>
                  {l.family && i === LEADER_PLEDGE.length && <p className={LBL}>Our family adds</p>}
                  <button
                    type="button"
                    onClick={() => set({ pledged: on ? state.pledged.filter((x) => x !== i) : [...state.pledged, i] })}
                    aria-pressed={on}
                    className={`w-full text-left flex items-start gap-2 rounded-xl px-3 py-2 border text-[12.5px] font-extrabold leading-snug transition-colors ${
                      on ? 'bg-kaya-gold/20 border-kaya-gold/60' : 'bg-white/[0.05] border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <span aria-hidden>{l.emoji}</span>
                    <span className="flex-1">{l.text}</span>
                    {l.trait && <span className="text-[10px] font-black text-kaya-gold-light whitespace-nowrap pt-0.5">{TRAIT_META[l.trait].emoji} {TRAIT_META[l.trait].label}</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-center text-[12.5px] font-bold text-[#FBE3A0] mt-3">Everyone together: <b>“{PLEDGE_RESPONSE}” 🙌</b></p>
          <PhaseNav onBack={() => go(-1)} onNext={() => go(1)} nextLabel={`${first(inc.name)}'s own words →`} />
        </div>
      )}

      {/* ── S21 · ② the incoming leader's own words ───────────────── */}
      {phase === 'words' && (
        <div className={CARD}>
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden>{inc.emoji}</span>
            <div className="min-w-0">
              <p className="font-display font-black text-[15px] leading-tight">
                {variant === 'adult' ? `${first(inc.name)} — a short word` : variant === 'renewal' ? `${first(inc.name)} leads again` : `${first(inc.name)}'s first words as leader`}
              </p>
              <p className="text-[11px] text-white/60 font-bold">
                {variant === 'adult' ? '“I’ll lead next Sunday” — and one hope for the week'
                  : `Pledge taken ${state.pledged.length >= pledgeLines.length ? '✓ ' : ''}${state.pledged.length} of ${pledgeLines.length} · now your own words`}
              </p>
            </div>
            <SoftRing runKey="words" />
          </div>
          <p className={LBL}>Say it in your own words</p>
          <div className="space-y-1.5">
            {(variant === 'adult' ? ['🎤 "I\'ll lead next Sunday\'s meeting…"', '🏠 "This week I hope our home will…"']
              : variant === 'renewal' ? RENEWAL_STARTERS
                : variant === 'little' ? [LITTLE_STARTER]
                  : incomingStarters(first(speaker?.name))).map((t) => <Starter key={t}>{t}</Starter>)}
          </div>
          <SaidButton said={state.inSaid} onToggle={() => set({ inSaid: !state.inSaid })} />
          <PhaseNav onBack={() => go(-1)} onNext={() => go(1)} nextLabel="The crown passes →" nextGold />
          {cfg.handoverRequired && (
            <>
              <p className="text-center text-[10.5px] text-white/50 mt-2">Next unlocks only when both speeches are marked said.</p>
              <button type="button" onClick={() => setSkipOpen(true)} className="block mx-auto mt-1 text-[11px] font-bold text-white/50 underline">Skip tonight…</button>
            </>
          )}
        </div>
      )}

      {/* ── S22 · ③ the crown passes ──────────────────────────────── */}
      {phase === 'crown' && (
        <div className={`${CARD} text-center`}>
          <div className="flex items-center justify-center gap-4 mt-1">
            {variant !== 'renewal' && speaker && crown && (
              <div className="text-center opacity-70">
                <div className="text-4xl leading-none opacity-80">{speaker.emoji}</div>
                <p className="text-[12px] font-black mt-1">{first(speaker.name)}</p>
                <p className="text-[9px] uppercase tracking-[0.14em] font-black text-white/55">thank you</p>
              </div>
            )}
            {variant !== 'renewal' && speaker && crown && (
              <div><div className="text-3xl leading-none kaya-crown-pass" aria-hidden>👑</div><div className="text-[13px] tracking-[6px] text-kaya-gold-light">· · · ➜</div></div>
            )}
            <div className="text-center">
              <div className="text-4xl leading-none">{variant === 'adult' ? '👑' : inc.emoji}</div>
              <p className="text-[12px] font-black mt-1">{variant === 'adult' ? 'a kid, soon' : first(inc.name)}</p>
              <p className="text-[9px] uppercase tracking-[0.14em] font-black text-kaya-gold-light">leader of the week</p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-left">
            {state.advice.trim() && speaker && variant !== 'adult' && (
              <Mini title={`🎁 ${first(speaker.name)}'s advice to ${first(inc.name)}`}>“{state.advice.trim()}”</Mini>
            )}
            {cfg.handoverBlessing && variant !== 'adult' && variant !== 'absent' && (
              <Mini gold title="💛 A parent’s blessing · 20 seconds">
                One sentence, said to {first(inc.name)}: <i>“{BLESSING_PROMPT}”</i>
                <span className="flex flex-wrap gap-1.5 mt-2">
                  {state.blessingBy
                    ? <button type="button" onClick={() => set({ blessingBy: '' })} className="px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-500/20 border border-emerald-400/50 text-emerald-200">✓ Blessing given · {first(state.blessingBy)}</button>
                    : parents.map((p) => (
                      <button key={p.uid} type="button" onClick={() => set({ blessingBy: p.name })} className="px-2.5 py-1 rounded-full text-[11px] font-black bg-white/10 hover:bg-white/20 text-white">{first(p.name)} gave it ✓</button>
                    ))}
                </span>
              </Mini>
            )}
            {variant === 'absent' && <Mini title={`📜 Waiting for ${first(inc.name)}`}>The pledge will be on {first(inc.name)}&apos;s Home screen — taken there on first open as leader.</Mini>}
            {variant === 'adult' && <Mini title="👑 Who wears the crown?">A parent appoints a kid from Home — and that kid takes the pledge on their own Home screen.</Mini>}
            {hasSurprise && variant !== 'adult' && variant !== 'absent' && (
              <Mini title={`🎁 ${first(inc.name)}'s first job as leader`}>Open tonight&apos;s Sunday Surprise for the family.</Mini>
            )}
          </div>
          <p className="text-[11px] text-white/55 mt-3">👑 The crown becomes official when you {hasSurprise ? 'tap Finish tonight' : 'close the meeting below'}.</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <button type="button" onClick={() => go(-1)} className="h-10 px-4 rounded-kaya bg-white/10 hover:bg-white/20 text-white font-display font-extrabold text-[13px]">← Back</button>
            {hasSurprise && (
              <button type="button" onClick={onContinue} className="h-10 px-5 rounded-kaya bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate font-display font-extrabold text-[13px]">On to the Sunday Surprise →</button>
            )}
          </div>
        </div>
      )}

      {skipOpen && <SkipSheet onClose={() => setSkipOpen(false)} onPick={(r) => { set({ skipped: r }); setSkipOpen(false); }} />}
      <style jsx global>{`
        @keyframes kayaCrownPass { 0% { transform: translateX(-46px) rotate(-8deg); opacity: .4; } 60% { transform: translateX(8px) rotate(6deg); opacity: 1; } 100% { transform: translateX(0) rotate(0); opacity: 1; } }
        .kaya-crown-pass { display: inline-block; animation: kayaCrownPass 1.4s ease-out both; }
      `}</style>
    </div>
  );
}

function Fact({ children }: { children: ReactNode }) {
  return <span className="text-[10.5px] font-black px-2 py-1 rounded-full bg-kaya-gold/15 border border-kaya-gold/40 text-[#FBE3A0]">{children}</span>;
}
function Starter({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-white/[0.06] border-l-[3px] border-kaya-gold px-3 py-2 text-[13px] font-extrabold italic text-white/90 leading-snug">{children}</p>;
}
function Mini({ title, children, gold = false }: { title: string; children: ReactNode; gold?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${gold ? 'border-kaya-gold/50 bg-kaya-gold/10' : 'border-white/15 bg-white/[0.05]'}`}>
      <p className="text-[11.5px] font-black text-kaya-gold-light mb-1">{title}</p>
      <div className="text-[12px] leading-relaxed text-white/85 font-bold">{children}</div>
    </div>
  );
}
function SaidButton({ said, onToggle }: { said: boolean; onToggle: () => void }) {
  return (
    <button
      type="button" onClick={onToggle} aria-pressed={said}
      className={`block w-full mt-4 h-11 rounded-xl font-display font-black text-[13.5px] transition-colors ${said ? 'bg-emerald-600 text-white' : 'bg-white/10 hover:bg-white/15 text-white/80'}`}
    >
      {said ? '✓ Speech said' : 'Tap when the speech has been said'}
    </button>
  );
}
function PhaseNav({ onBack, onNext, nextLabel, nextGold = false }: { onBack: () => void; onNext: () => void; nextLabel: string; nextGold?: boolean }) {
  return (
    <div className="flex gap-2 mt-2.5">
      <button type="button" onClick={onBack} className="flex-1 h-10 rounded-xl bg-white/[0.08] hover:bg-white/15 text-white/70 text-[12px] font-black">← Back</button>
      <button type="button" onClick={onNext} className={`flex-[1.4] h-10 rounded-xl text-[12px] font-black ${nextGold ? 'bg-kaya-gold hover:bg-kaya-gold-dark text-kaya-chocolate' : 'bg-white/15 hover:bg-white/25 text-white'}`}>{nextLabel}</button>
    </div>
  );
}
function SkipSheet({ onClose, onPick }: { onClose: () => void; onPick: (r: { reason: string; label: string }) => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Skip the hand-over tonight" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-sm bg-kaya-chocolate text-white rounded-3xl border border-white/15 shadow-2xl p-5">
        <p className="font-display font-black text-lg">Skip the hand-over tonight?</p>
        <p className="text-[12px] text-white/65 mt-1 mb-3">Tell us why — it goes on the Meeting Report, so it&apos;s never a silent skip.</p>
        <div className="space-y-1.5">
          {HANDOVER_SKIP_REASONS.map(([reason, label]) => (
            <button key={reason} type="button" onClick={() => onPick({ reason, label })} className="w-full text-left h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-[13px] font-extrabold">{label}</button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="block mx-auto mt-3 text-[12px] font-bold text-kaya-gold-light">Keep going — let&apos;s do it</button>
      </div>
    </div>
  );
}
