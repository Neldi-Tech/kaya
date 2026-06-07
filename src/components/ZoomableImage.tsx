'use client';

// Kaya · ZoomableImage — pinch / double-tap / drag-to-pan zoom for a full-res
// image, plus ＋ − reset controls. Used by the document viewer + the Moments
// lightbox so a scanned page is never stuck small. Pure CSS-transform on the
// <img>, so a high-res source stays crisp at zoom.

import { useRef, useState } from 'react';

const MAX = 5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const g = useRef<{
    startDist: number; startScale: number;
    panX: number; panY: number; startTx: number; startTy: number; lastTap: number;
  }>({ startDist: 0, startScale: 1, panX: 0, panY: 0, startTx: 0, startTy: 0, lastTap: 0 });

  const reset = () => { setScale(1); setTx(0); setTy(0); };
  const bump = (delta: number) => setScale((s) => {
    const n = clamp(s + delta, 1, MAX);
    if (n === 1) { setTx(0); setTy(0); }
    return n;
  });

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      g.current.startDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      g.current.startScale = scale;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      g.current.panX = t.clientX; g.current.panY = t.clientY;
      g.current.startTx = tx; g.current.startTy = ty;
      const now = Date.now();
      if (g.current.lastTap && now - g.current.lastTap < 280) {
        if (scale > 1) reset(); else setScale(2.5);
        g.current.lastTap = 0;
      } else {
        g.current.lastTap = now;
      }
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && g.current.startDist > 0) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      setScale(clamp(g.current.startScale * (dist / g.current.startDist), 1, MAX));
      e.preventDefault();
    } else if (e.touches.length === 1 && scale > 1) {
      const t = e.touches[0];
      setTx(g.current.startTx + (t.clientX - g.current.panX));
      setTy(g.current.startTy + (t.clientY - g.current.panY));
      e.preventDefault();
    }
  };

  return (
    <div className={`relative w-full h-full overflow-hidden grid place-items-center touch-none ${className ?? ''}`}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove}
      onDoubleClick={() => (scale > 1 ? reset() : setScale(2.5))}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt={alt} draggable={false}
        className="max-w-full max-h-full object-contain select-none"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transition: 'transform 60ms linear', cursor: scale > 1 ? 'grab' : 'zoom-in', willChange: 'transform' }}
      />
      {/* Controls */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/55 rounded-full px-1 py-1">
        <button type="button" aria-label="Zoom out" onClick={() => bump(-0.5)} className="w-9 h-9 rounded-full text-white text-lg font-black grid place-items-center active:bg-white/20">−</button>
        <button type="button" aria-label="Reset zoom" onClick={reset} className="px-3 h-9 rounded-full text-white text-[11px] font-bold grid place-items-center active:bg-white/20">{Math.round(scale * 100)}%</button>
        <button type="button" aria-label="Zoom in" onClick={() => bump(0.5)} className="w-9 h-9 rounded-full text-white text-lg font-black grid place-items-center active:bg-white/20">＋</button>
      </div>
    </div>
  );
}
