'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import { resolveGamesConfig, SUGGESTED_WINDOWS, type GamesConfig } from '@/lib/games';

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-12 h-7 rounded-full transition-colors ${on ? 'bg-games-violet' : 'bg-games-ink/20'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function Stepper({
  value, onChange, min, max, step, suffix, zeroLabel,
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix: string; zeroLabel?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onChange(clamp(value - step))} className="w-8 h-8 rounded-full bg-games-bg text-games-violet font-black text-lg leading-none">−</button>
      <span className="min-w-[68px] text-center font-display font-extrabold text-games-ink text-sm">
        {value === 0 && zeroLabel ? zeroLabel : `${value} ${suffix}`}
      </span>
      <button type="button" onClick={() => onChange(clamp(value + step))} className="w-8 h-8 rounded-full bg-games-bg text-games-violet font-black text-lg leading-none">+</button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3.5 border-b border-games-ink/8 last:border-0">
      <div>
        <p className="text-sm font-bold text-games-ink">{label}</p>
        {hint && <p className="text-[11px] text-games-ink-soft mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function WindowRow({
  label, win, preset, onChange,
}: {
  label: string;
  win: { start: string; end: string } | null;
  preset: { start: string; end: string };
  onChange: (w: { start: string; end: string } | null) => void;
}) {
  return (
    <div className="py-3.5 border-b border-games-ink/8 last:border-0">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-games-ink">{label}</p>
        <Toggle on={win !== null} onChange={(v) => onChange(v ? preset : null)} />
      </div>
      {win && (
        <div className="flex items-center gap-2 mt-3">
          <input type="time" value={win.start} onChange={(e) => onChange({ ...win, start: e.target.value })}
            className="bg-games-bg rounded-kaya-sm px-3 py-2 text-sm font-bold text-games-ink" />
          <span className="text-games-ink-soft text-sm">to</span>
          <input type="time" value={win.end} onChange={(e) => onChange({ ...win, end: e.target.value })}
            className="bg-games-bg rounded-kaya-sm px-3 py-2 text-sm font-bold text-games-ink" />
        </div>
      )}
    </div>
  );
}

export default function GamesControlsPage() {
  const { profile } = useAuth();
  const { family, refresh } = useFamily();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  const [cfg, setCfg] = useState<GamesConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (family && cfg === null) setCfg(resolveGamesConfig(family.gamesConfig));
  }, [family, cfg]);

  const patch = (p: Partial<GamesConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  const save = async () => {
    if (!cfg || !familyId) return;
    setSaving(true);
    try {
      await updateFamily(familyId, { gamesConfig: cfg });
      await refresh();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        {!isParent ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🛡️</p>
            <p className="font-display text-xl font-extrabold text-games-ink mb-2">Parents only</p>
            <p className="text-sm text-games-ink-soft">Ask a parent to set up Games controls.</p>
          </div>
        ) : !cfg ? (
          <p className="text-center text-sm text-games-ink-soft py-16">Loading…</p>
        ) : (
          <>
            <div className="rounded-kaya-lg p-5 my-4 text-white bg-gradient-to-br from-games-ink to-games-violet-deep">
              <h1 className="font-display text-2xl font-black mb-1">🛡️ Games Controls</h1>
              <p className="text-xs opacity-90">Set the limits — they&rsquo;re enforced for every kid in your family.</p>
            </div>

            <div className="bg-games-card rounded-kaya p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-1">Daily limits</p>
              <Row label="House Points cap" hint="Most a kid can earn from games per day">
                <Stepper value={cfg.dailyPointsCap} onChange={(v) => patch({ dailyPointsCap: v })} min={0} max={500} step={25} suffix="pts" zeroLabel="No cap" />
              </Row>
              <Row label="Play-time cap" hint="Minutes of games per day">
                <Stepper value={cfg.dailyMinutesCap} onChange={(v) => patch({ dailyMinutesCap: v })} min={0} max={180} step={5} suffix="min" zeroLabel="No cap" />
              </Row>
              <Row label="Calm Corner always free" hint="Breathing, gratitude &amp; mood don&rsquo;t use the caps">
                <Toggle on={cfg.calmUncapped} onChange={(v) => patch({ calmUncapped: v })} />
              </Row>
            </div>

            <div className="bg-games-card rounded-kaya p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-1">Access</p>
              <Row label="Homework first" hint="Hide non-calm games until the day&rsquo;s homework is ticked">
                <Toggle on={cfg.homeworkGate} onChange={(v) => patch({ homeworkGate: v })} />
              </Row>
              <Row label="Younger-kid bonus" hint={`1.5× points on Quick Plays for ages ${cfg.youngMaxAge} and under`}>
                <Toggle on={cfg.youngMultiplier > 1} onChange={(v) => patch({ youngMultiplier: v ? 1.5 : 1 })} />
              </Row>
            </div>

            <div className="bg-games-card rounded-kaya p-4 mb-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-1">Play windows</p>
              <WindowRow label="Weekdays" win={cfg.weekdayWindow} preset={SUGGESTED_WINDOWS.weekday} onChange={(w) => patch({ weekdayWindow: w })} />
              <WindowRow label="Weekends" win={cfg.weekendWindow} preset={SUGGESTED_WINDOWS.weekend} onChange={(w) => patch({ weekendWindow: w })} />
              <p className="text-[11px] text-games-ink-soft mt-2">Off = playable any time. (Windows show in the kid&rsquo;s app; full lock-out lands with the next update.)</p>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full disabled:opacity-60"
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save controls'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
