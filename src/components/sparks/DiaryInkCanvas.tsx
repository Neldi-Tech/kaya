'use client';

// Kaya Sparks · Diary ink canvas (Slice 8b · 2026-07-21).
//
// Apple-Pencil-friendly drawing surface for diary pages, per the
// approved design:
//   · PointerEvents capture pen input WITH pressure (lineWidth scales)
//   · ✏️ Pen / 🩹 Eraser / ↩︎ Undo tools
//   · "☝️ Finger scrolls" toggle — the web palm-rejection compromise:
//     ON (default) → touch pointers scroll the page, only pen/mouse
//     draw; OFF → fingers draw too (phones without a stylus).
//   · Exports the drawing as a PNG File via toBlob for the standard
//     photo upload pipeline (compressed server of truth in Storage).
//
// Strokes are kept in memory for Undo; the export flattens to image —
// ink is not editable after save (v1, per the logic test).

import { useEffect, useRef, useState } from 'react';

interface Stroke {
  points: Array<{ x: number; y: number; w: number }>;
  erase: boolean;
}

interface Props {
  /** Canvas CSS height (px). Width fills the container. */
  height?: number;
  /** Called whenever stroke count changes (lets the parent enable Save). */
  onDirtyChange?: (hasInk: boolean) => void;
}

export interface DiaryInkHandle {
  /** Export the drawing as a PNG File, or null when the canvas is empty. */
  exportFile: () => Promise<File | null>;
  clear: () => void;
}

import { forwardRef, useImperativeHandle } from 'react';

const DiaryInkCanvas = forwardRef<DiaryInkHandle, Props>(function DiaryInkCanvas(
  { height = 260, onDirtyChange }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const liveRef = useRef<Stroke | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [fingerScrolls, setFingerScrolls] = useState(true);
  const [strokeCount, setStrokeCount] = useState(0);

  // Fit the bitmap to the CSS box × devicePixelRatio for crisp ink.
  useEffect(() => {
    const cv = canvasRef.current, wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const fit = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${height}px`;
      const ctx = cv.getContext('2d');
      if (ctx) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); redraw(ctx); }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const redraw = (ctx: CanvasRenderingContext2D) => {
    const cv = canvasRef.current;
    if (!cv) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.restore();
    for (const s of [...strokesRef.current, ...(liveRef.current ? [liveRef.current] : [])]) {
      drawStroke(ctx, s);
    }
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    if (s.points.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#1B1547';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1], b = s.points[i];
      ctx.beginPath();
      ctx.lineWidth = s.erase ? 18 : Math.max(1.2, b.w);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    if (s.points.length === 1 && !s.erase) {
      const p = s.points[0];
      ctx.beginPath();
      ctx.fillStyle = '#1B1547';
      ctx.arc(p.x, p.y, Math.max(0.8, p.w / 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const pointFrom = (e: React.PointerEvent): { x: number; y: number; w: number } => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    // Pressure: pens report 0..1 (0.5 default when unsupported). Map to
    // a 1.5–5px line so light strokes read light.
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: 1.5 + pressure * 3.5 };
  };

  const shouldDraw = (e: React.PointerEvent): boolean => {
    if (e.pointerType === 'touch' && fingerScrolls) return false;
    return true;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!shouldDraw(e)) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    liveRef.current = { points: [pointFrom(e)], erase: tool === 'eraser' };
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) redraw(ctx);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!liveRef.current || !shouldDraw(e)) return;
    e.preventDefault();
    liveRef.current.points.push(pointFrom(e));
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawStroke(ctx, {
      points: liveRef.current.points.slice(-2),
      erase: liveRef.current.erase,
    });
  };
  const onUp = () => {
    if (!liveRef.current) return;
    strokesRef.current.push(liveRef.current);
    liveRef.current = null;
    setStrokeCount(strokesRef.current.length);
    onDirtyChange?.(strokesRef.current.length > 0);
  };

  const undo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    onDirtyChange?.(strokesRef.current.length > 0);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) redraw(ctx);
  };

  useImperativeHandle(ref, () => ({
    exportFile: async () => {
      const cv = canvasRef.current;
      if (!cv || strokesRef.current.length === 0) return null;
      // Flatten onto white so the PNG isn't transparent (JPEG-safe
      // through the photo pipeline).
      const out = document.createElement('canvas');
      out.width = cv.width; out.height = cv.height;
      const octx = out.getContext('2d')!;
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(cv, 0, 0);
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
      if (!blob) return null;
      return new File([blob], `diary-ink-${Date.now()}.png`, { type: 'image/png' });
    },
    clear: () => {
      strokesRef.current = [];
      liveRef.current = null;
      setStrokeCount(0);
      onDirtyChange?.(false);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) redraw(ctx);
    },
  }), [onDirtyChange]);

  return (
    <div ref={wrapRef} className="relative rounded-2xl border-2 border-[#EBC2DC] bg-white overflow-hidden">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        // touch-action: with finger-scroll ON we let touch pan the page
        // (pen still draws — pen pointers aren't touch). OFF = draw all.
        style={{ touchAction: fingerScrolls ? 'pan-y' : 'none', display: 'block' }}
        aria-label="Drawing canvas"
      />
      {strokeCount === 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none text-[#d9c2d0] text-[13px] font-bold">
          Write or draw here with your pencil…
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center gap-1.5 flex-wrap">
        <button type="button" onClick={() => setTool('pen')}
          className={`text-[10.5px] font-extrabold rounded-lg px-2 py-1 border ${tool === 'pen' ? 'bg-[#F9E4F1] text-[#7A2E5C] border-[#EBC2DC]' : 'bg-[#FBF7EE] text-[#5A6488] border-[#ECE4D3]'}`}>
          ✏️ Pen
        </button>
        <button type="button" onClick={() => setTool('eraser')}
          className={`text-[10.5px] font-extrabold rounded-lg px-2 py-1 border ${tool === 'eraser' ? 'bg-[#F9E4F1] text-[#7A2E5C] border-[#EBC2DC]' : 'bg-[#FBF7EE] text-[#5A6488] border-[#ECE4D3]'}`}>
          🩹 Eraser
        </button>
        <button type="button" onClick={undo} disabled={strokeCount === 0}
          className="text-[10.5px] font-extrabold rounded-lg px-2 py-1 border bg-[#FBF7EE] text-[#5A6488] border-[#ECE4D3] disabled:opacity-40">
          ↩︎ Undo
        </button>
        <button type="button" onClick={() => setFingerScrolls((v) => !v)}
          className={`ml-auto text-[10.5px] font-extrabold rounded-lg px-2 py-1 border ${fingerScrolls ? 'bg-[#F9E4F1] text-[#7A2E5C] border-[#EBC2DC]' : 'bg-[#FBF7EE] text-[#5A6488] border-[#ECE4D3]'}`}
          title="ON: fingers scroll the page, pencil draws. OFF: fingers draw too.">
          ☝️ {fingerScrolls ? 'Finger scrolls' : 'Finger draws'}
        </button>
      </div>
    </div>
  );
});

export default DiaryInkCanvas;
