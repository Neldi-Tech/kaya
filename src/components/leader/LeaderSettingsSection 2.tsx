'use client';
// 👑 Leader of the Week — parent settings (R16), self-saving: every change
// writes `family.leaderConfig` immediately (+ per-kid Notebook overrides on
// the child doc), independent of the meetings page's big Save so nothing
// clobbers. Lives on /settings/meetings#leader.

import { useEffect, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily, updateChild } from '@/lib/firestore';
import { readLeaderConfig, DEFAULT_LEADER_CONFIG, type LeaderConfig } from '@/lib/leaderWeek.shared';
import { ageOf } from '@/lib/participation';

function Toggle({ on, onChange, label, help }: { on: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-5 h-5 accent-kaya-gold cursor-pointer" />
      <span>
        <span className="block font-display font-extrabold text-[14px] text-kaya-chocolate">{label}</span>
        {help && <span className="block text-[12px] text-kaya-sand">{help}</span>}
      </span>
    </label>
  );
}

function Seg<T extends number | string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-1 bg-kaya-warm rounded-xl p-1">
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-lg text-[12px] font-black ${value === v ? 'bg-white text-kaya-chocolate shadow-sm' : 'text-kaya-sand'}`}>{l}</button>
      ))}
    </div>
  );
}

export default function LeaderSettingsSection() {
  const { family, children, refresh } = useFamily();
  const [cfg, setCfg] = useState<LeaderConfig>(DEFAULT_LEADER_CONFIG);
  const [dutyDraft, setDutyDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCfg(readLeaderConfig(family)); }, [family]);

  const write = async (patch: Partial<LeaderConfig>) => {
    if (!family) return;
    const next = { ...cfg, ...patch };
    setCfg(next); setErr(null);
    try {
      await updateFamily(family.id, { leaderConfig: next });
      setSaved(true); setTimeout(() => setSaved(false), 1500);
      void refresh();
    } catch { setErr('Could not save — try again.'); }
  };

  if (!family) return null;

  return (
    <section id="leader" className="mb-8 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 lg:p-7 scroll-mt-24">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-lg lg:text-xl font-black">Leader of the Week 👑</h2>
        <span className="text-[10px] uppercase tracking-wider font-bold text-kaya-sand">{saved ? 'saved ✓' : cfg.enabled ? 'on' : 'off'}</span>
      </div>
      <p className="text-[12px] lg:text-[13px] text-kaya-sand mb-3">
        The Sunday wheel crowns a kid for the week. They take notes (⭐ shout-outs / 📝 heads-ups) about siblings; you decide the points; the week seals into a 5-trait radar on their profile.
      </p>
      {err && <p className="text-[12px] font-bold text-red-600 mb-2">{err}</p>}

      <Toggle on={cfg.enabled} onChange={(v) => write({ enabled: v })} label="Leader of the Week is on" help="Off hides the crown, the Notebook and the Home cards for everyone." />

      <div className="border-t border-kaya-warm-dark/60 my-2" />
      <div className="py-2">
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate">📒 Notebook opens from age</p>
        <p className="text-[12px] text-kaya-sand mb-2">Younger kids still wear the crown — they just don&apos;t take notes. Per-kid overrides below.</p>
        <Seg value={cfg.notebookMinAge} options={[[4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'], [10, '10']]} onChange={(v) => write({ notebookMinAge: v })} />
        {children.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {children.map((c) => {
              const age = ageOf(c);
              const ov = c.participationOverrides?.notebook;
              const effective = typeof ov === 'boolean' ? ov : (age === null ? true : age >= cfg.notebookMinAge);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    // Cycle: follow-age → override → follow-age. Writing the
                    // whole map (without `notebook`) clears the override —
                    // Firestore rejects `undefined`, so never send it.
                    const rest: Record<string, boolean> = {};
                    Object.entries(c.participationOverrides || {}).forEach(([k, v]) => { if (k !== 'notebook' && typeof v === 'boolean') rest[k] = v; });
                    const nextMap = typeof ov === 'boolean' ? rest : { ...rest, notebook: !effective };
                    try {
                      await updateChild(family.id, c.id, { participationOverrides: nextMap });
                      void refresh();
                    } catch { setErr('Could not save the override.'); }
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11.5px] font-black border ${effective ? 'bg-green-50 border-green-600 text-green-800' : 'bg-kaya-warm border-kaya-warm-dark text-kaya-sand'}`}
                  title={typeof ov === 'boolean' ? 'Override set — tap to clear' : 'Following the age rule — tap to override'}
                >
                  {c.avatarEmoji || '🧒'} {c.name.split(' ')[0]} · {effective ? 'Notebook ✓' : 'crown only'}{typeof ov === 'boolean' ? ' · override' : ''}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-kaya-warm-dark/60 my-2" />
      <div className="py-2">
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate">Notes per day</p>
        <p className="text-[12px] text-kaya-sand mb-2">A cap keeps the Notebook thoughtful, not a scoreboard.</p>
        <Seg value={cfg.dailyNoteCap} options={[[3, '3'], [5, '5'], [8, '8'], [10, '10']]} onChange={(v) => write({ dailyNoteCap: v })} />
      </div>
      <Toggle on={cfg.allowSelfNotes} onChange={(v) => write({ allowSelfNotes: v })} label="Notes about themselves" help="Max 1 self shout-out a day; an approved self heads-up earns Honest ✓. Self notes never move the radar." />

      <div className="border-t border-kaya-warm-dark/60 my-2" />
      <div className="py-2">
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate">Leader bonus when the week seals</p>
        <p className="text-[12px] text-kaya-sand mb-2">House Points for the leader at the end of a week that lasted ≥ 3 days. 0 = the crown and the card are the reward.</p>
        <Seg value={cfg.termBonusPoints} options={[[0, 'Off'], [1, '+1'], [2, '+2'], [3, '+3']]} onChange={(v) => write({ termBonusPoints: v })} />
      </div>
      <div className="py-2">
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate">How an approved heads-up reaches the sibling</p>
        <p className="text-[12px] text-kaya-sand mb-2">Shout-outs always say “noticed by 👑 {'{leader}'}”. Heads-ups can stay with the role.</p>
        <Seg value={cfg.headsUpAttribution} options={[['role', '👑 Leader’s note'], ['name', 'Show the leader’s name']]} onChange={(v) => write({ headsUpAttribution: v })} />
      </div>
      <Toggle on={cfg.kidSeesTraits} onChange={(v) => write({ kidSeesTraits: v })} label="Kids see their own radar" help="On My Stats. Siblings only ever see the crown and “led N×”." />
      <Toggle on={cfg.missionsOn} onChange={(v) => write({ missionsOn: v })} label="🎯 Mission Card each week" help="One small mission per week, picked for the leader’s weakest trait." />
      <Toggle on={cfg.coachNudgesOn} onChange={(v) => write({ coachNudgesOn: v })} label="👀 Kaya whispers" help="Soft fairness nudges on the leader’s Notebook tile — never push or email." />

      <div className="border-t border-kaya-warm-dark/60 my-2" />
      <div className="py-2">
        <p className="font-display font-extrabold text-[14px] text-kaya-chocolate">Our family adds (guide) · up to 3</p>
        <p className="text-[12px] text-kaya-sand mb-2">Extra duties shown in the “What it means to be leader” guide, e.g. “feed Simba in the morning”.</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {cfg.customDuties.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-black bg-kaya-warm text-kaya-chocolate">
              {d}
              <button type="button" aria-label={`Remove ${d}`} onClick={() => write({ customDuties: cfg.customDuties.filter((x) => x !== d) })} className="text-kaya-sand">✕</button>
            </span>
          ))}
        </div>
        {cfg.customDuties.length < 3 && (
          <div className="flex gap-2">
            <input value={dutyDraft} onChange={(e) => setDutyDraft(e.target.value.slice(0, 60))} placeholder="Add a duty…" className="flex-1 rounded-xl border border-kaya-warm-dark px-3 py-2 text-[13px] font-bold focus:outline-none focus:border-kaya-gold" />
            <button type="button" disabled={!dutyDraft.trim()} onClick={() => { write({ customDuties: [...cfg.customDuties, dutyDraft.trim()] }); setDutyDraft(''); }} className="px-4 rounded-xl bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[13px] disabled:opacity-50">Add</button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-kaya-sand mt-2">Changes here save immediately.</p>
    </section>
  );
}
