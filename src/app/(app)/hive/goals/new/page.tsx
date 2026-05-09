'use client';

// /hive/goals/new — small form that creates a Goal under the active kid.
// Layer choice (honey | cash) drives whether targetAmount is in 🍯 (integer)
// or cents. We let the kid pick a quick icon from a small palette.

import { useState } from 'react';
import NumberInput from '@/components/hive/NumberInput';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { addGoal } from '@/lib/hive';
import BackButton from '@/components/ui/BackButton';

const ICONS = ['🚲', '🎧', '🎮', '📱', '⚽', '🎨', '📚', '🧱', '🎸', '🐶', '✈️', '🏕️'];

export default function NewGoalPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { activeKidId, config } = useHive();

  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);
  const [layer, setLayer] = useState<'cash' | 'honey'>('cash');
  const [target, setTarget] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    if (!title.trim()) { setError('Give your goal a name.'); return; }
    const num = target;
    if (!Number.isFinite(num) || num <= 0) { setError('Pick a target amount.'); return; }
    const targetAmount = layer === 'cash' ? Math.round(num * 100) : Math.round(num);
    setSubmitting(true);
    try {
      await addGoal(profile.familyId, activeKidId, {
        title: title.trim(),
        icon,
        layer,
        targetAmount,
      });
      router.push('/hive/goals');
    } catch (e: any) {
      setError(e?.message || 'Failed to save goal.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">New goal</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">What are you saving for? 🎯</h1>
      </div>

      <div className="space-y-4">
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Goal name</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New bike"
            maxLength={60}
            className="w-full h-12 px-3 bg-hive-cream rounded-[12px] text-base font-nunito font-bold border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            autoFocus
          />
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Pick an icon</p>
          <div className="flex flex-wrap gap-2">
            {ICONS.map((i) => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                className={`w-11 h-11 rounded-hive flex items-center justify-center text-2xl border-2 transition-all ${
                  icon === i ? 'border-hive-honey bg-hive-honey-soft' : 'border-hive-line bg-hive-paper hover:border-hive-honey/40'
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Save in</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'cash',  label: 'Cash $',     desc: 'Real money' },
              { id: 'honey', label: 'Honey 🍯',   desc: 'In-Hive savings' },
            ] as const).map((c) => {
              const sel = layer === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => { setLayer(c.id); setTarget(0); }}
                  className={`p-3 rounded-hive border-2 text-left transition-all ${
                    sel ? 'border-hive-honey bg-hive-honey-soft/50' : 'border-hive-line bg-hive-paper'
                  }`}
                >
                  <p className="font-nunito font-extrabold text-[14px]">{c.label}</p>
                  <p className="text-[11px] text-hive-muted">{c.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
            Target {layer === 'cash' ? 'amount' : 'in 🍯'}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-nunito font-black text-3xl text-hive-muted">
              {layer === 'cash' ? '$' : '🍯'}
            </span>
            <NumberInput
              value={target}
              onChange={setTarget}
              allowDecimal={layer === 'cash'}
              min={0}
              ariaLabel="Goal target amount"
              placeholder={layer === 'cash' ? '120.00' : '120'}
              className="font-nunito font-black text-3xl bg-transparent outline-none flex-1 placeholder:text-hive-muted/30 min-w-0"
            />
          </div>
        </div>

        {error && <p className="text-hive-rose text-sm font-bold">{error}</p>}

        <button
          onClick={submit}
          disabled={submitting || isGuest}
          className="w-full h-12 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]"
        >
          {submitting ? 'Saving…' : 'Save goal'}
        </button>
      </div>
    </div>
  );
}
