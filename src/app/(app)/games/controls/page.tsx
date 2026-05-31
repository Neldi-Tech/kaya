'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import {
  resolveGamesConfig, SUGGESTED_WINDOWS, isMindGame,
  POINTS_PER_GAME_MIN, POINTS_PER_GAME_MAX, POINTS_PER_GAME_STEP,
  MIND_GAME_IDS, type GamesConfig,
} from '@/lib/games';
import { GAME_WORLDS, gamesByWorld, getGame } from '@/lib/gamesCatalog';

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

// Like Stepper, but the centre is a real number field you can type into — so
// a cap can be any value from 0 (not just 25-step jumps). Empty/blur snaps
// back to a clamped number; 0 shows the zeroLabel when not being edited.
function ManualStepper({
  value, onChange, min, max, step, suffix, zeroLabel, width = 'w-16',
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix: string; zeroLabel?: string; width?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);

  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    onChange(Number.isFinite(n) ? clamp(n) : min);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(clamp(value - step))} className="w-8 h-8 rounded-full bg-games-bg text-games-violet font-black text-lg leading-none shrink-0">−</button>
      <div className="relative flex items-center">
        <input
          type="number"
          inputMode="numeric"
          value={editing ? text : (value === 0 && zeroLabel ? '' : String(value))}
          placeholder={value === 0 && zeroLabel ? zeroLabel : '0'}
          min={min}
          max={max}
          onFocus={() => { setEditing(true); setText(value ? String(value) : ''); }}
          onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
          onBlur={() => { setEditing(false); commit(text); }}
          className={`${width} h-9 text-center font-display font-extrabold text-games-ink text-sm bg-games-bg rounded-xl border border-games-violet/15 focus:outline-none focus:ring-2 focus:ring-games-violet/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        />
      </div>
      <span className="text-[11px] font-bold text-games-ink-soft w-8 shrink-0">{value === 0 && zeroLabel ? '' : suffix}</span>
      <button type="button" onClick={() => onChange(clamp(value + step))} className="w-8 h-8 rounded-full bg-games-bg text-games-violet font-black text-lg leading-none shrink-0">+</button>
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
            className="flex-1 h-10 px-3 bg-games-bg rounded-xl text-sm text-games-ink border border-games-violet/15" />
          <span className="text-games-ink-soft text-sm">to</span>
          <input type="time" value={win.end} onChange={(e) => onChange({ ...win, end: e.target.value })}
            className="flex-1 h-10 px-3 bg-games-bg rounded-xl text-sm text-games-ink border border-games-violet/15" />
        </div>
      )}
    </div>
  );
}

// One game's House-Points value. Default 0 = the game earns nothing (and so
// needs no approval). Set a value and every win waits for a parent's ✓.
function GamePointsRow({
  icon, name, suggested, mind, value, onChange,
}: {
  icon: string; name: string; suggested: number; mind: boolean;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-games-ink/8 last:border-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-xl shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-bold text-games-ink truncate">{name}</p>
            {mind && (
              <span className="inline-flex items-center text-[9px] font-extrabold uppercase tracking-wide text-games-teal bg-games-teal/12 px-1.5 py-0.5 rounded-full">🧠 Mind +</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(suggested)}
            className="text-[11px] text-games-ink-soft mt-0.5 hover:text-games-violet"
          >
            Suggested {suggested} pts{value === suggested ? ' ✓' : ' · tap to use'}
          </button>
        </div>
      </div>
      <div className="shrink-0">
        <ManualStepper
          value={value}
          onChange={onChange}
          min={POINTS_PER_GAME_MIN}
          max={POINTS_PER_GAME_MAX}
          step={POINTS_PER_GAME_STEP}
          suffix="pts"
          zeroLabel="Off"
          width="w-14"
        />
      </div>
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
  const setGameValue = (gameId: string, v: number) =>
    setCfg((c) => (c ? { ...c, gamePoints: { ...(c.gamePoints || {}), [gameId]: v } } : c));

  // Quick helpers for the per-game editor.
  const valuedCount = useMemo(
    () => (cfg ? Object.values(cfg.gamePoints || {}).filter((v) => (v || 0) > 0).length : 0),
    [cfg],
  );
  const suggestMindGames = () => {
    setCfg((c) => {
      if (!c) return c;
      const next = { ...(c.gamePoints || {}) };
      MIND_GAME_IDS.forEach((id) => {
        const g = getGame(id);
        if (g) next[id] = g.points;
      });
      return { ...c, gamePoints: next };
    });
  };
  const clearAllValues = () => patch({ gamePoints: {} });

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

            {/* How games earn — the approval-gated model in one card. */}
            <div className="bg-games-violet/8 border border-games-violet/20 rounded-kaya p-4 mb-4">
              <p className="text-sm font-extrabold text-games-violet-deep mb-1">🍯 Games start at 0 — you decide their worth</p>
              <p className="text-[12px] text-games-ink-soft leading-snug">
                House Points are real value, so every game is worth <strong>0 pts</strong> until you set one below.
                When a kid wins a valued game, it waits in your{' '}
                <Link href="/games/approvals" className="font-bold text-games-violet underline">approvals queue</Link>{' '}
                — points only land once you tap ✓.
              </p>
            </div>

            <div className="bg-games-card rounded-kaya p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-1">Earning caps</p>
              <Row label="Daily House Points cap" hint="Most a kid can earn from games per day">
                <ManualStepper value={cfg.dailyPointsCap} onChange={(v) => patch({ dailyPointsCap: v })} min={0} max={500} step={5} suffix="pts" zeroLabel="No cap" />
              </Row>
              <Row label="Weekly House Points cap" hint="Most a kid can earn from games per week">
                <ManualStepper value={cfg.weeklyPointsCap} onChange={(v) => patch({ weeklyPointsCap: v })} min={0} max={2000} step={25} suffix="pts" zeroLabel="No cap" />
              </Row>
              <Row label="Play-time cap" hint="Minutes of games per day">
                <Stepper value={cfg.dailyMinutesCap} onChange={(v) => patch({ dailyMinutesCap: v })} min={0} max={180} step={5} suffix="min" zeroLabel="No cap" />
              </Row>
              <Row label="Calm Corner always free" hint="Breathing, gratitude &amp; mood don&rsquo;t use the caps">
                <Toggle on={cfg.calmUncapped} onChange={(v) => patch({ calmUncapped: v })} />
              </Row>
            </div>

            {/* Story keepsakes — how long saved Story Builder stories stay readable. */}
            <div className="bg-games-card rounded-kaya p-4 mb-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft mb-1">📖 Story keepsakes</p>
              <Row label="Keep saved stories" hint="Days a saved story stays in the gallery before it&rsquo;s tidied away">
                <ManualStepper value={cfg.storyRetentionDays} onChange={(v) => patch({ storyRetentionDays: v })} min={0} max={365} step={5} suffix="days" zeroLabel="Forever" width="w-14" />
              </Row>
            </div>

            {/* Per-game points — the heart of the request. */}
            <div className="bg-games-card rounded-kaya p-4 mb-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-games-ink-soft">Points per game</p>
                <span className="text-[11px] font-bold text-games-violet">{valuedCount} earning</span>
              </div>
              <p className="text-[12px] text-games-ink-soft mb-2 leading-snug">
                House Points are only for <strong>mind-strengthening games</strong> (🧠). Every other game earns <strong>✨ Fun Points</strong> instead — automatic, no approval.
              </p>
              <div className="flex gap-2 mb-1">
                <button type="button" onClick={suggestMindGames} className="flex-1 h-9 rounded-full bg-games-teal/15 text-games-teal font-extrabold text-[12px]">🧠 Value mind games</button>
                <button type="button" onClick={clearAllValues} className="h-9 px-4 rounded-full bg-games-bg text-games-ink-soft font-extrabold text-[12px]">Clear all</button>
              </div>

              {GAME_WORLDS.map((world) => {
                const games = gamesByWorld(world.id);
                if (games.length === 0) return null;
                return (
                  <div key={world.id} className="mt-3">
                    <p className="text-[12px] font-extrabold text-games-ink flex items-center gap-1.5 mb-0.5">
                      <span>{world.emoji}</span> {world.label}
                      {world.uncapped && <span className="text-[10px] font-bold text-games-ink-soft normal-case">· cap-free</span>}
                    </p>
                    {games.map((g) => (
                      isMindGame(g.id) ? (
                        <GamePointsRow
                          key={g.id}
                          icon={g.icon}
                          name={g.name}
                          suggested={g.points}
                          mind
                          value={cfg.gamePoints?.[g.id] ?? 0}
                          onChange={(v) => setGameValue(g.id, v)}
                        />
                      ) : (
                        <div key={g.id} className="flex items-center justify-between gap-3 py-3 border-b border-games-ink/8 last:border-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xl shrink-0">{g.icon}</span>
                            <p className="text-sm font-bold text-games-ink truncate">{g.name}</p>
                          </div>
                          <span className="shrink-0 text-[11px] font-extrabold text-games-violet bg-games-violet/10 px-2.5 py-1 rounded-full">✨ Fun only</span>
                        </div>
                      )
                    ))}
                  </div>
                );
              })}
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
