'use client';

// Kaya · 🎤 Voice bubble (Voice 2.0 · V4–V5, approved 22-Sep-2026).
//
// Replaces the raw browser <audio controls> in chat — which looked (and
// broke) differently on every phone — with one Kaya player: play/pause,
// a tap-to-seek progress bar, and the duration, identical on iPhone and
// Android and sized for kid thumbs. preload="metadata" so long threads
// don't download every note.
//
// V5 · legacy notes: old WebM notes (sent before the universal-format fix)
// may not decode on iPhones. When the audio element reports it can't play,
// the bubble says so kindly instead of showing a dead control.

import { useEffect, useRef, useState } from 'react';

const mmss = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function VoiceBubble({ url, durationSec, mine }: {
  url: string;
  durationSec?: number;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [metaDuration, setMetaDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  // The attachment's stored duration wins (always correct); the element's
  // metadata is the fallback for older notes (and is Infinity on legacy
  // MediaRecorder WebM — filtered out).
  const duration = (durationSec && durationSec > 0) ? durationSec
    : (Number.isFinite(metaDuration) && metaDuration > 0 ? metaDuration : 0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime || 0);
    const onMeta = () => setMetaDuration(a.duration);
    const onEnd = () => { setPlaying(false); setTime(0); };
    const onErr = () => { setFailed(true); setPlaying(false); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onErr);
      a.pause();
    };
  }, [url]);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a || failed) return;
    try {
      if (playing) { a.pause(); setPlaying(false); }
      else { await a.play(); setPlaying(true); }
    } catch { setFailed(true); setPlaying(false); }
  };

  const seek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const a = audioRef.current;
    if (!a || failed || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * duration;
    setTime(a.currentTime);
  };

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  if (failed) {
    return (
      <div className={`flex items-start gap-2 max-w-[230px] text-[11.5px] leading-snug ${mine ? 'text-white/85' : 'text-kaya-sand'}`}>
        <span className="text-base shrink-0">🎤</span>
        <span>This older note can&apos;t play on this phone — ask them to resend 💛</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 min-w-[190px] max-w-[230px]">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-black shrink-0 active:scale-95 transition ${
          mine ? 'bg-kaya-gold text-kaya-chocolate' : 'bg-kaya-chocolate text-kaya-gold'
        }`}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        onClick={seek}
        aria-label="Jump within voice note"
        className="flex-1 h-6 flex items-center cursor-pointer"
      >
        <span className={`block w-full h-[4px] rounded-full relative overflow-hidden ${mine ? 'bg-white/25' : 'bg-kaya-chocolate/15'}`}>
          <span
            className={`absolute left-0 top-0 bottom-0 rounded-full ${mine ? 'bg-kaya-gold' : 'bg-kaya-chocolate'}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      </button>
      <span className={`text-[10.5px] font-bold shrink-0 tabular-nums ${mine ? 'text-white/75' : 'text-kaya-sand'}`}>
        {playing || time > 0 ? `${mmss(time)} / ` : ''}{duration > 0 ? mmss(duration) : '· · ·'}
      </span>
    </div>
  );
}
