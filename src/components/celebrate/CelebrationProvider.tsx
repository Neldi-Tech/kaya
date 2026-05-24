'use client';

// Kaya · Celebration overlay provider. Mount once at the (app) layout (mirrors
// ConfirmProvider). Any descendant calls `useCelebrate()` to fire a short,
// joyful (or inspiring) takeover when a kid earns points. The treatment is
// chosen by `resolveCelebration` from the kid's per-kid settings (age-aware),
// with a rotating "surprise pool" so it stays fresh.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  CelebrationEvent, CelebrationSettings, CelebrationVariant, ResolvedCelebration,
  resolveCelebration, celebrationSettingsFor,
} from '@/lib/celebrate';

type CelebrateFn = (event: CelebrationEvent, settingsOverride?: CelebrationSettings) => void;

const CelebrationContext = createContext<CelebrateFn | null>(null);

const LAST_VARIANT_KEY = 'kaya:celebrate:last';

/** Fire a celebration. No-ops gracefully if used outside the provider. */
export function useCelebrate(): CelebrateFn {
  return useContext(CelebrationContext) ?? (() => {});
}

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const { children: kids } = useFamily();
  const [active, setActive] = useState<ResolvedCelebration | null>(null);
  const lastVariant = useRef<CelebrationVariant | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_VARIANT_KEY);
      if (v) lastVariant.current = v as CelebrationVariant;
    } catch { /* ignore */ }
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setActive(null);
  }, []);

  const celebrate = useCallback<CelebrateFn>((event, settingsOverride) => {
    // Settings: explicit override → the acting kid's settings → age default.
    const myChild = profile?.role === 'kid' && profile.childId
      ? kids.find((c) => c.id === profile.childId)
      : undefined;
    const settings = settingsOverride ?? celebrationSettingsFor(myChild ?? null);

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const effective: CelebrationSettings = reduced ? { ...settings, intensity: 'calm' } : settings;

    const resolved = resolveCelebration(event, effective, { lastVariant: lastVariant.current });
    lastVariant.current = resolved.variant;
    try { localStorage.setItem(LAST_VARIANT_KEY, resolved.variant); } catch { /* ignore */ }

    if (resolved.sound) playChime();
    setActive(resolved);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(null), resolved.durationMs);
  }, [profile?.role, profile?.childId, kids]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <CelebrationContext.Provider value={celebrate}>
      {children}
      {active && <CelebrationOverlay c={active} onDismiss={dismiss} />}
    </CelebrationContext.Provider>
  );
}

// Tiny WebAudio chime so the (opt-in) sound flag is real without an asset.
function playChime() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.start(t); o.stop(t + 0.3);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* sound is best-effort */ }
}

// ── Overlay ──────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#F5D77A', '#C2576B', '#6C5CE7', '#2F7D32', '#D17F1A', '#33485f'];

function CelebrationOverlay({ c, onDismiss }: { c: ResolvedCelebration; onDismiss: () => void }) {
  const big = c.intensity === 'big';
  const showConfetti = c.mode === 'celebration' && (c.variant === 'confetti' || c.variant === 'fireworks');
  const pieces = c.intensity === 'calm' ? 0 : big ? 36 : 22;

  if (c.mode === 'inspiring') {
    return (
      <button type="button" onClick={onDismiss} aria-label="Continue"
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-center px-8 cursor-pointer"
        style={{ background: 'linear-gradient(160deg,#FAF6EC 0%,#F4ECD8 100%)' }}>
        <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center text-5xl"
          style={{ border: '5px solid #F5D77A', boxShadow: '0 10px 26px rgba(209,127,26,.18)' }}>{c.emoji}</div>
        <div className="font-nunito font-black text-[30px] text-hive-navy mt-5">{c.headline}</div>
        {c.quote && <p className="font-nunito font-extrabold italic text-[18px] text-hive-navy/90 max-w-[300px] mt-4 leading-snug">“{c.quote}”</p>}
        <p className="text-[13px] text-hive-muted mt-3">{c.message}</p>
        <p className="text-[12px] text-hive-muted mt-8">tap to continue →</p>
      </button>
    );
  }

  return (
    <button type="button" onClick={onDismiss} aria-label="Continue"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-center px-8 overflow-hidden cursor-pointer"
      style={{ background: 'radial-gradient(circle at 50% 34%, #33485f, #1F2D3D 72%)' }}>
      <style>{keyframes}</style>
      {showConfetti && (
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: pieces }).map((_, i) => {
            const left = (i * 37) % 100;
            const delay = (i % 8) * 0.18;
            const dur = 1.8 + (i % 5) * 0.35;
            const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
            return (
              <span key={i} aria-hidden
                style={{
                  position: 'absolute', top: '-6%', left: `${left}%`,
                  width: 9, height: 14, background: color, borderRadius: 2,
                  animation: `kaya-fall ${dur}s linear ${delay}s infinite`,
                }} />
            );
          })}
        </div>
      )}

      <div className="text-[84px] leading-none" style={{ animation: 'kaya-pop .5s ease-out, kaya-bounce 1.6s ease-in-out .5s infinite', filter: 'drop-shadow(0 8px 18px rgba(0,0,0,.4))' }}>{c.emoji}</div>
      <div className="text-[12px] font-nunito font-black uppercase tracking-[.12em] text-hive-honey mt-2">🎉 Woohoo!</div>
      <div className="font-nunito font-black text-white text-[22px] mt-1">{c.headline}</div>
      <div className="font-nunito font-black text-white text-[40px] leading-none mt-1" style={{ textShadow: '0 4px 14px rgba(0,0,0,.35)' }}>{c.message}</div>

      {c.reward && (
        <div className="mt-6 rounded-[16px] px-5 py-3.5" style={{ background: 'rgba(255,255,255,.10)', border: '1.5px solid #F5D77A', animation: 'kaya-pop .5s ease-out .25s both' }}>
          <div className="text-[10px] font-nunito font-black uppercase tracking-[.1em] text-hive-honey">✨ Surprise unlocked</div>
          <div className="text-[17px] font-nunito font-black text-white mt-1">{c.reward.label}</div>
          <div className="text-[30px] mt-1">{c.reward.emoji}</div>
        </div>
      )}

      <p className="absolute bottom-7 left-0 right-0 text-[12px] text-white/60">tap to continue →</p>
    </button>
  );
}

const keyframes = `
@keyframes kaya-fall { 0%{transform:translateY(0) rotate(0);opacity:1} 100%{transform:translateY(115vh) rotate(540deg);opacity:.9} }
@keyframes kaya-pop { 0%{transform:scale(.3);opacity:0} 70%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
@keyframes kaya-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
`;
