'use client';

// RewardsWizard — guided 3-step modal to add the family's first reward
// in ~30 seconds: Name (with example pills) → Cost (quick buttons +
// input) → Icon (emoji picker). Replaces the blank inline form for the
// First Week flow; existing inline form on /parent/rewards stays as a
// power-user path. Auto-opens when ?wizard=1 is in the URL.

import { useEffect, useState } from 'react';
import { addReward, DEFAULT_REWARD_CATEGORY } from '@/lib/firestore';

type Props = {
  open: boolean;
  familyId: string;
  onClose: () => void;
  onSaved: () => void;
};

const NAME_EXAMPLES = [
  { emoji: '🍦', label: 'Ice cream outing' },
  { emoji: '📖', label: 'Extra story before bed' },
  { emoji: '🎬', label: 'Pick the family movie' },
  { emoji: '🏊', label: 'Trip to the pool' },
  { emoji: '🛌', label: 'Friday sleepover' },
  { emoji: '🍳', label: 'Choose Sunday breakfast' },
] as const;

const COST_OPTIONS = [10, 25, 50, 100] as const;

const ICON_OPTIONS = [
  '🎁',
  '🍦',
  '📖',
  '🎬',
  '🏊',
  '🛌',
  '🍳',
  '🎮',
  '🐾',
  '⭐',
  '🍿',
  '🏞️',
] as const;

export default function RewardsWizard({ open, familyId, onClose, onSaved }: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [cost, setCost] = useState(25);
  const [icon, setIcon] = useState('🎁');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset on open + body scroll lock + Esc handler.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName('');
    setCost(25);
    setIcon('🎁');
    setSaving(false);
    setError('');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const trimmedName = name.trim();
  const canAdvanceFromStep1 = trimmedName.length > 0;
  const canSave = trimmedName.length > 0 && cost > 0;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      await addReward(familyId, {
        title: trimmedName,
        description: '',
        pointsCost: cost,
        icon,
        active: true,
        category: DEFAULT_REWARD_CATEGORY,
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not add the reward.';
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-brand-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add a reward"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full sm:max-w-[520px] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
        {/* Head */}
        <div className="px-5 py-4 border-b border-kaya-warm-dark/60 flex items-center justify-between">
          <h3 className="font-display font-extrabold text-base sm:text-lg text-brand-navy">
            🎁 Add a reward
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-kaya-warm hover:bg-kaya-warm-dark text-brand-ink/70 text-sm flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* Step dots */}
        <div className="flex gap-1.5 px-5 pt-3.5">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`flex-1 h-1 rounded-full ${
                n < step
                  ? 'bg-brand-honey'
                  : n === step
                    ? 'bg-brand-honey-dk'
                    : 'bg-brand-navy/10'
              }`}
            />
          ))}
        </div>
        <div className="px-5 pt-2 text-[11px] text-brand-ink/60 font-extrabold uppercase tracking-[0.12em]">
          Step {step} of 3
          {step === 1 && ' · Name'}
          {step === 2 && ' · Cost'}
          {step === 3 && ' · Icon'}
        </div>

        {/* Body — scrolls if long */}
        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-5">
          {step === 1 && (
            <>
              <h4 className="font-display font-extrabold text-[18px] text-brand-navy mb-1 leading-tight">
                What can kids earn?
              </h4>
              <p className="text-[13px] text-brand-ink/65 mb-3.5">
                One reward to start — you can add more later. Keep it small and real.
              </p>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ice cream outing"
                maxLength={60}
                autoFocus
                className="w-full bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-4 py-2.5 text-[15px] focus:outline-none focus:border-brand-honey focus:ring-2 focus:ring-brand-honey/30"
              />
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {NAME_EXAMPLES.map((ex) => {
                  const picked = name === ex.label;
                  return (
                    <button
                      key={ex.label}
                      type="button"
                      onClick={() => {
                        setName(ex.label);
                        // Mirror the matching icon if available.
                        if (ICON_OPTIONS.includes(ex.emoji as (typeof ICON_OPTIONS)[number])) {
                          setIcon(ex.emoji);
                        }
                      }}
                      className={`bg-white border rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                        picked
                          ? 'border-brand-honey bg-brand-honey/10 text-brand-navy font-extrabold'
                          : 'border-kaya-warm-dark text-brand-ink/70 hover:border-brand-honey'
                      }`}
                    >
                      {ex.emoji} {ex.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h4 className="font-display font-extrabold text-[18px] text-brand-navy mb-1 leading-tight">
                How many points?
              </h4>
              <p className="text-[13px] text-brand-ink/65 mb-3.5">
                Small treats sit around 25. Bigger ones at 100. You can change this later.
              </p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {COST_OPTIONS.map((c) => {
                  const picked = cost === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCost(c)}
                      className={`py-3 rounded-xl border-[1.5px] font-extrabold text-base transition-colors ${
                        picked
                          ? 'border-brand-honey-dk bg-brand-honey/15 text-brand-navy'
                          : 'border-kaya-warm-dark bg-white text-brand-navy hover:border-brand-honey'
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              <label className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-brand-ink/60 mb-1.5">
                Or pick your own
              </label>
              <input
                type="number"
                min={1}
                max={9999}
                value={cost}
                onChange={(e) => setCost(Math.max(1, Math.min(9999, Number(e.target.value) || 0)))}
                className="w-full bg-brand-cream border-[1.5px] border-kaya-warm-dark rounded-xl px-4 py-2.5 text-[15px] focus:outline-none focus:border-brand-honey focus:ring-2 focus:ring-brand-honey/30"
              />
            </>
          )}

          {step === 3 && (
            <>
              <h4 className="font-display font-extrabold text-[18px] text-brand-navy mb-1 leading-tight">
                Pick an icon
              </h4>
              <p className="text-[13px] text-brand-ink/65 mb-3.5">
                Helps the kids spot it on the rewards list.
              </p>

              {/* Preview tile */}
              <div className="bg-brand-cream-warm border border-brand-honey/35 rounded-xl p-4 mb-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-2xl shadow-sm shrink-0">
                  {icon}
                </div>
                <div className="min-w-0">
                  <div className="font-display font-extrabold text-[14.5px] text-brand-navy truncate">
                    {trimmedName || 'Your reward'}
                  </div>
                  <div className="text-[12px] text-brand-ink/60">{cost} pts</div>
                </div>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {ICON_OPTIONS.map((opt) => {
                  const picked = icon === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setIcon(opt)}
                      className={`aspect-square rounded-xl border-[1.5px] text-2xl flex items-center justify-center transition-colors ${
                        picked
                          ? 'border-brand-honey-dk bg-brand-honey/15'
                          : 'border-kaya-warm-dark bg-white hover:border-brand-honey'
                      }`}
                      aria-label={`Use ${opt}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && (
            <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2 mt-3">
              {error}
            </p>
          )}
        </div>

        {/* Foot */}
        <div className="px-5 py-3.5 border-t border-kaya-warm-dark/60 flex items-center justify-between gap-3">
          {step === 1 ? (
            <button
              type="button"
              onClick={onClose}
              className="text-[13px] font-extrabold text-brand-ink/60 hover:text-brand-navy"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="text-[13px] font-extrabold text-brand-ink/60 hover:text-brand-navy"
            >
              ← Back
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(3, s + 1))}
              disabled={step === 1 && !canAdvanceFromStep1}
              className="bg-brand-honey hover:bg-brand-honey-dk disabled:bg-brand-honey/40 disabled:cursor-not-allowed text-brand-navy font-extrabold text-[14px] px-5 py-2.5 rounded-xl transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              className="bg-brand-honey hover:bg-brand-honey-dk disabled:bg-brand-honey/40 disabled:cursor-not-allowed text-brand-navy font-extrabold text-[14px] px-5 py-2.5 rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : 'Use this reward →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
