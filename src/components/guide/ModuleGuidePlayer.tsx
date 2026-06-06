'use client';

// Plays a ModuleGuide like a short video: auto-advancing scenes, a progress
// bar, optional 🔊 voiceover (on-device speech), role-aware copy, and a
// Try-it-now hand-off into the real screen. Built from the live app, so it
// never goes stale. Launched via openModuleGuide() → GuideHost renders this.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import type { ModuleGuide, GuideScene } from '@/lib/moduleGuides';

const SCENE_MS = 4600;

function Visual({ scene }: { scene: GuideScene }) {
  const v = scene.visual;
  if (v.kind === 'flow') {
    return (
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {v.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1 bg-kaya-cream border border-black/5 rounded-2xl px-3 py-2 min-w-[74px]">
              <span className="text-xl">{s.emoji}</span>
              <span className="text-[12px] font-nunito font-extrabold text-hive-navy">{s.label}</span>
            </div>
            {i < v.steps.length - 1 && <span className="text-hive-honey font-black text-lg">→</span>}
          </div>
        ))}
      </div>
    );
  }
  if (v.kind === 'grid') {
    return (
      <div className="grid grid-cols-3 gap-2 w-full max-w-[280px]">
        {v.items.map((it, i) => (
          <div key={i} className="bg-kaya-cream border border-black/5 rounded-xl py-2.5 text-center">
            <div className="text-lg">{it.emoji}</div>
            <div className="text-[10px] font-nunito font-extrabold text-hive-navy mt-0.5">{it.label}</div>
          </div>
        ))}
      </div>
    );
  }
  if (v.kind === 'pair') {
    return (
      <div className="flex gap-2.5 w-full max-w-[300px]">
        {v.items.map((it, i) => (
          <div key={i} className="flex-1 bg-kaya-cream border border-black/5 rounded-2xl p-3 text-center">
            <div className="text-2xl">{it.emoji}</div>
            <div className="text-[12.5px] font-nunito font-black text-hive-navy mt-1">{it.label}</div>
            <div className="text-[10px] font-nunito font-semibold text-hive-navy/55 mt-0.5">{it.sub}</div>
          </div>
        ))}
      </div>
    );
  }
  if (v.kind === 'budget') {
    return (
      <div className="w-[88%] max-w-[300px]">
        <div className="text-[13px] font-nunito font-black text-hive-navy text-left">{v.label}</div>
        <div className="h-3.5 bg-black/8 rounded-full overflow-hidden my-2">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: `${v.pct}%` }} />
        </div>
        <div className="flex justify-between text-[11px] font-nunito font-extrabold text-hive-navy/60">
          <span>{v.pct}% used</span><span>{v.note}</span>
        </div>
      </div>
    );
  }
  return <div className="text-[56px] leading-none">{v.emoji}</div>;
}

export default function ModuleGuidePlayer({
  guide, onClose, onWatched,
}: {
  guide: ModuleGuide;
  onClose: () => void;
  onWatched: (id: string) => void;
}) {
  const { profile } = useAuth();
  const isHelper = profile?.role === 'helper';
  const scenes = guide.scenes;
  const last = scenes.length - 1;

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const timer = useRef<number | null>(null);
  const watchedRef = useRef(false);

  const bodyFor = useCallback(
    (s: GuideScene) => (isHelper && s.bodyHelper ? s.bodyHelper : s.body),
    [isHelper],
  );

  const speak = useCallback((s: GuideScene) => {
    if (!voiceOn || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${s.title}. ${bodyFor(s)}`);
    u.lang = 'en-US'; u.rate = 1; u.pitch = 1.05;
    window.speechSynthesis.speak(u);
  }, [voiceOn, bodyFor]);

  const stopVoice = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  // Mark watched once the kid/parent reaches the final scene.
  useEffect(() => {
    if (i === last && !watchedRef.current) { watchedRef.current = true; onWatched(guide.id); }
  }, [i, last, guide.id, onWatched]);

  // Auto-advance + narrate the current scene.
  useEffect(() => {
    speak(scenes[i]);
    if (timer.current) window.clearTimeout(timer.current);
    if (playing && i < last) {
      timer.current = window.setTimeout(() => setI((n) => Math.min(last, n + 1)), SCENE_MS);
    } else if (playing && i === last) {
      setPlaying(false);
    }
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [i, playing, last, scenes, speak]);

  useEffect(() => () => stopVoice(), []);

  const close = () => { stopVoice(); onClose(); };
  const toggleVoice = () => {
    const next = !voiceOn; setVoiceOn(next);
    if (next) {
      const s = scenes[i];
      window.speechSynthesis?.cancel();
      const u = new SpeechSynthesisUtterance(`${s.title}. ${bodyFor(s)}`);
      u.rate = 1; u.pitch = 1.05; window.speechSynthesis?.speak(u);
    } else stopVoice();
  };
  const replay = () => { setI(0); setPlaying(true); };
  const togglePlay = () => {
    if (i === last) { replay(); return; }
    setPlaying((p) => { if (p) stopVoice(); return !p; });
  };

  const scene = scenes[i];
  const onEnd = i === last;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm" onClick={close}>
      <div
        className="w-full sm:w-[420px] max-h-[92vh] overflow-auto bg-kaya-cream rounded-t-3xl sm:rounded-3xl p-4 pb-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* top bar */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-navy/55 mr-auto">
            {guide.emoji} {guide.title} · Guide
          </span>
          {isHelper && <span className="text-[10px] font-nunito font-black bg-black/8 text-hive-navy rounded-full px-2 py-1">👤 Helper</span>}
          <button
            type="button" onClick={toggleVoice}
            className={`text-[11px] font-nunito font-black rounded-full px-2.5 py-1 ${voiceOn ? 'bg-hive-honey text-white' : 'bg-black/8 text-hive-navy'}`}
          >
            {voiceOn ? '🔊 Voice on' : '🔊 Voice'}
          </button>
          <button type="button" onClick={close} aria-label="Close" className="w-7 h-7 rounded-full bg-black/8 text-hive-navy font-black">✕</button>
        </div>

        {/* progress */}
        <div className="flex gap-1.5 mb-3">
          {scenes.map((_, n) => (
            <div key={n} className="h-1 flex-1 rounded-full bg-black/10 overflow-hidden">
              <div className="h-full bg-hive-honey rounded-full transition-all" style={{ width: n < i ? '100%' : n === i ? '100%' : '0%' }} />
            </div>
          ))}
        </div>

        {/* stage */}
        <div className="h-[210px] rounded-2xl bg-white border border-black/5 flex items-center justify-center p-4 mb-3">
          {onEnd ? (
            <div className="text-center">
              <div className="text-[42px] leading-none">🎉</div>
              <h3 className="font-nunito font-black text-hive-navy text-lg mt-1">{scene.title}</h3>
              <p className="text-[12px] font-nunito font-semibold text-hive-navy/60 mt-1 mb-3 max-w-[260px] mx-auto">{bodyFor(scene)}</p>
              {guide.ctaHref && (
                <Link href={guide.ctaHref} onClick={close} className="inline-block bg-hive-honey text-white font-nunito font-black text-[13px] px-5 py-2.5 rounded-full">
                  {guide.ctaLabel || 'Open'} ▶
                </Link>
              )}
              <button type="button" onClick={replay} className="block mx-auto mt-2.5 text-[12px] font-nunito font-extrabold text-hive-navy/55">↺ Watch again</button>
            </div>
          ) : (
            <Visual scene={scene} />
          )}
        </div>

        {/* copy */}
        {!onEnd && (
          <div className="min-h-[64px] mb-3">
            <h3 className="font-nunito font-black text-hive-navy text-[18px] mb-1">{scene.title}</h3>
            <p className="text-[13px] font-nunito font-semibold text-hive-navy/65 leading-snug">{bodyFor(scene)}</p>
          </div>
        )}

        {/* controls */}
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}
            className="w-11 h-11 rounded-full bg-black/8 text-hive-navy font-black text-lg disabled:opacity-40">‹</button>
          <button type="button" onClick={togglePlay}
            className="flex-1 h-11 rounded-full bg-hive-navy text-white font-nunito font-black text-sm">
            {onEnd ? '↺ Replay' : playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <span className="text-[11px] font-nunito font-extrabold text-hive-navy/55 w-9 text-center">{i + 1}/{scenes.length}</span>
          <button type="button" onClick={() => setI((n) => Math.min(last, n + 1))} disabled={i === last}
            className="w-11 h-11 rounded-full bg-black/8 text-hive-navy font-black text-lg disabled:opacity-40">›</button>
        </div>
      </div>
    </div>
  );
}
