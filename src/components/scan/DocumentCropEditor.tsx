'use client';

// DocumentCropEditor — CS-Scanner-style crop + flatten (Scanning 2.0 · PR 6a).
//
// Shows a captured photo with four DRAGGABLE corner handles, seeded by
// auto-detect (a sensible inset box when detection is unsure). The user
// nudges any corner onto the page edges, optionally rotates a sideways
// shot, then we perspective-warp + clean → a crisp, upright scan (the
// Image-3 result). The manual adjust GUARANTEES a good crop even when
// auto-detect misses — and gives the uploader control "if and when needed".

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadImage, cropCleanScan, rotateFile90,
  type DocCorners,
} from '@/lib/photoEnhance';
import { detectCornersBest } from '@/lib/scan/cvDetect';

type CornerKey = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';
const ORDER: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
const DEFAULT_CORNERS: DocCorners = {
  topLeft: { x: 0.08, y: 0.08 }, topRight: { x: 0.92, y: 0.08 },
  bottomRight: { x: 0.92, y: 0.92 }, bottomLeft: { x: 0.08, y: 0.92 },
};

export default function DocumentCropEditor({
  file, onConfirm, onCancel, detectCorners, title = 'Crop the page', sw = false,
}: {
  file: File;
  onConfirm: (result: { file: File; previewUrl: string }) => void | Promise<void>;
  onCancel: () => void;
  /** Optional CV detector overriding the built-in AI detect (PR 6b). */
  detectCorners?: (file: File) => Promise<DocCorners | null>;
  title?: string;
  sw?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const [workingFile, setWorkingFile] = useState<File>(file);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<DocCorners>(DEFAULT_CORNERS);
  const [detecting, setDetecting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState<CornerKey | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Reset to the incoming file if the caller swaps it.
  useEffect(() => { setWorkingFile(file); }, [file]);

  // Load the working image (for display + warp) + seed corners via auto-detect.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(workingFile);
    setImgUrl(url);
    setDetecting(true);
    setCorners(DEFAULT_CORNERS);
    (async () => {
      try {
        const img = await loadImage(workingFile);
        if (!cancelled) imgElRef.current = img;
      } catch { /* ignore — confirm guards on a loaded image */ }
      try {
        const detect = detectCorners ?? detectCornersBest;
        const found = await detect(workingFile);
        if (!cancelled && found) setCorners(found);
      } catch { /* keep the default box */ }
      finally { if (!cancelled) setDetecting(false); }
    })();
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [workingFile, detectCorners]);

  const updateCorner = useCallback((clientX: number, clientY: number, key: CornerKey) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setCorners((prev) => ({ ...prev, [key]: { x, y } }));
  }, []);

  useEffect(() => {
    if (!dragKey) return;
    const move = (e: PointerEvent) => { e.preventDefault(); updateCorner(e.clientX, e.clientY, dragKey); };
    const up = () => setDragKey(null);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragKey, updateCorner]);

  const reDetect = async () => {
    setDetecting(true);
    setErr(null);
    try {
      const detect = detectCorners ?? detectCornersBest;
      const found = await detect(workingFile);
      if (found) setCorners(found);
      else setErr(sw ? 'Sikuona ukurasa — buruta pembe.' : 'Couldn’t find the page — drag the corners to the edges.');
    } catch {
      setErr(sw ? 'Imeshindwa — buruta pembe.' : 'Couldn’t auto-detect — drag the corners.');
    } finally { setDetecting(false); }
  };

  const rotate = async () => {
    setBusy(true); setErr(null);
    try { setWorkingFile(await rotateFile90(workingFile)); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    const img = imgElRef.current;
    if (!img) { setErr(sw ? 'Bado inapakia picha…' : 'Still loading the photo…'); return; }
    setBusy(true); setErr(null);
    try {
      const result = await cropCleanScan(img, corners);
      if (!result) { setErr(sw ? 'Mraba ni mdogo mno — upanue.' : 'That crop is too small — widen it.'); setBusy(false); return; }
      await onConfirm({ file: result.file, previewUrl: result.previewUrl });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Crop failed. Try again?');
      setBusy(false);
    }
  };

  const pts = ORDER.map((k) => `${corners[k].x},${corners[k].y}`).join(' ');

  return (
    <div className="fixed inset-0 z-[90] bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button type="button" onClick={onCancel} className="text-[14px] font-bold">{sw ? 'Ghairi' : 'Cancel'}</button>
        <span className="text-[14px] font-extrabold">{title}</span>
        <button type="button" onClick={reDetect} disabled={detecting || busy} className="text-[13px] font-bold disabled:opacity-50">
          {detecting ? (sw ? 'Inatafuta…' : 'Detecting…') : (sw ? 'Otomatiki' : 'Auto')}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-3 overflow-hidden">
        <div ref={wrapRef} className="relative inline-block max-w-full touch-none select-none">
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="Captured page" className="block w-auto h-auto max-w-full max-h-[68vh]" draggable={false} />
          )}
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <mask id="cropmask">
                <rect x="0" y="0" width="1" height="1" fill="white" />
                <polygon points={pts} fill="black" />
              </mask>
            </defs>
            <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.55)" mask="url(#cropmask)" />
            <polygon points={pts} fill="none" stroke="#7c5cff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                setDragKey(k);
              }}
              className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-white shadow-lg touch-none active:scale-110 transition-transform"
              style={{ left: `${corners[k].x * 100}%`, top: `${corners[k].y * 100}%`, background: 'rgba(124,92,255,0.85)' }}
              aria-label={`Drag ${k} corner`}
            />
          ))}
        </div>
      </div>

      <p className="text-center text-[12px] px-4 min-h-[18px] font-bold" style={{ color: err ? '#FFB4A8' : 'rgba(255,255,255,0.7)' }}>
        {err ?? (sw ? 'Buruta pembe kwenye kingo za ukurasa.' : 'Drag the corners onto the edges of the page.')}
      </p>

      <div className="px-4 py-4 flex items-center gap-2">
        <button type="button" onClick={rotate} disabled={busy}
          className="px-3 h-11 rounded-full text-[13px] font-black text-white/90 border border-white/30 disabled:opacity-50">⟳ {sw ? 'Zungusha' : 'Rotate'}</button>
        <button type="button" onClick={() => setCorners(DEFAULT_CORNERS)} disabled={busy}
          className="px-3 h-11 rounded-full text-[13px] font-black text-white/90 border border-white/30 disabled:opacity-50">{sw ? 'Weka upya' : 'Reset'}</button>
        <button type="button" onClick={confirm} disabled={busy}
          className="flex-1 h-11 rounded-full text-[14px] font-black text-white disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#7c5cff,#9a86ff)' }}>
          {busy ? (sw ? 'Inakata…' : 'Cropping…') : (sw ? 'Tumia mraba huu ✓' : 'Use this crop ✓')}
        </button>
      </div>
    </div>
  );
}
