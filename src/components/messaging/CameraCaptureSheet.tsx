'use client';

// CameraCaptureSheet — full-screen overlay that drives both chat-attach
// flows introduced 2026-05-27:
//   • mode='photo'  → single capture + AI-enhanced compare + Send
//   • mode='scan'   → multi-page capture, each enhanced for document text,
//                     all sent as separate JPEG attachments in one message
//
// Uses the native camera via <input type="file" accept="image/*"
// capture="environment"> so it works on every Kaya target (iOS Safari,
// Android Chrome, desktop).
//
// Scanning 2.0 (2026-06-07): scan mode now runs autoFrameScan — an AI
// vision pass finds the page's corners, the browser warps it flat + crops
// the background, then cleans it. Falls back to clean-only when no clear
// page is found, so a scan is never worse than before. Photo mode keeps the
// quick clean-only enhancePhoto.

import { useEffect, useRef, useState } from 'react';
import { enhancePhoto, autoScanWithDetector, rotateFile90WithPreview, applyColorMode, tightenScanFile, type ScanColorMode } from '@/lib/photoEnhance';
import { detectCornersBest } from '@/lib/scan/cvDetect';
import DocumentCropEditor from '@/components/scan/DocumentCropEditor';

type Page = {
  id: string;
  original: File;
  enhanced: File;
  enhancedUrl: string;
  originalUrl: string;
  useEnhanced: boolean;
  /** scan mode: true when the page was cropped + flattened via the editor. */
  framed: boolean;
  /** Output mode + the cleaned COLOR result it's derived from (so toggling
   *  Color/Grayscale/B&W re-derives without re-warping). */
  mode: ScanColorMode;
  colorBase: File;
  /** Content-tight crop (handwriting flow): the full cleaned page, the
   *  margin-trimmed version (null when there's nothing to trim), and which
   *  one is active. `colorBase` always tracks the active choice. */
  colorBaseFull: File;
  colorBaseTight: File | null;
  tight: boolean;
};

const MODES: { id: ScanColorMode; label: string }[] = [
  { id: 'color', label: 'Color' }, { id: 'grayscale', label: 'Gray' }, { id: 'bw', label: 'B&W' },
];

export default function CameraCaptureSheet({
  open, mode, onClose, onConfirm, contentTight = false,
}: {
  open: boolean;
  mode: 'photo' | 'scan';
  onClose: () => void;
  /** Caller persists the chosen files (`useEnhanced` is already applied
   *  here — each File is the variant the kid picked). */
  onConfirm: (files: File[]) => void | Promise<void>;
  /** Scan mode · auto-crop tight to the writing by default (handwriting
   *  notes). Each page keeps a one-tap "Whole page" opt-out. Off for the
   *  generic document scanners so their margins are preserved. */
  contentTight?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Crop editor (scan mode): the just-captured file awaiting crop, and the
  // page being re-cropped (null = a new page).
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [recropId, setRecropId] = useState<string | null>(null);
  // Trigger the camera the first time the sheet opens so the kid lands
  // straight in capture instead of staring at an empty modal.
  const triggered = useRef(false);

  useEffect(() => {
    if (open && !triggered.current) {
      triggered.current = true;
      // setTimeout so the input ref is attached.
      setTimeout(() => inputRef.current?.click(), 30);
    }
    if (!open) {
      // Reset on close so the next open is fresh.
      triggered.current = false;
      setPages((prev) => {
        for (const p of prev) {
          URL.revokeObjectURL(p.originalUrl);
          // enhancedUrl is a data URL, no revoke needed
        }
        return [];
      });
      setError('');
      setCropFile(null);
      setRecropId(null);
    }
  }, [open]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';                                       // allow re-capturing
    if (!file) return;
    setBusy(true); setError('');
    try {
      // Scan → AUTO: detect the page (on-device CV → AI) → warp flat + crop →
      // auto-rotate upright → clean. No prompt (fast for bulk); the page gets
      // an "✂️ Adjust crop" for the rare miss. Photo → quick clean only.
      let fullFile: File, fullPreview: string, framed = false;
      if (mode === 'scan') {
        const r = await autoScanWithDetector(file, detectCornersBest);
        fullFile = r.file; fullPreview = r.previewUrl; framed = r.framed;
      } else {
        const r = await enhancePhoto(file);
        fullFile = r.file; fullPreview = r.previewUrl;
      }
      // Handwriting flow → also compute a margin-trimmed version and make it
      // the default, keeping the full page so "Whole page" restores it 1-tap.
      let colorBaseTight: File | null = null;
      let tight = false;
      let activeFile = fullFile, activePreview = fullPreview;
      if (mode === 'scan' && contentTight) {
        const t = await tightenScanFile(fullFile).catch(() => null);
        if (t) { colorBaseTight = t.file; tight = true; activeFile = t.file; activePreview = t.previewUrl; }
      }
      const page: Page = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: file,
        enhanced: activeFile,
        enhancedUrl: activePreview,
        originalUrl: URL.createObjectURL(file),
        useEnhanced: true,
        framed,
        mode: 'color',
        colorBase: activeFile,
        colorBaseFull: fullFile,
        colorBaseTight,
        tight,
      };
      setPages((prev) => [...prev, page]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the photo.');
    } finally {
      setBusy(false);
    }
  };

  // Crop editor confirmed → add a new page (or replace the re-cropped one).
  const onCropConfirm = (result: { file: File; previewUrl: string }) => {
    const raw = cropFile;
    if (!raw) return;
    const originalUrl = URL.createObjectURL(raw);
    setPages((prev) => {
      if (recropId) {
        return prev.map((p) => {
          if (p.id !== recropId) return p;
          URL.revokeObjectURL(p.originalUrl);
          return { ...p, original: raw, originalUrl, enhanced: result.file, enhancedUrl: result.previewUrl, useEnhanced: true, framed: true, mode: 'color', colorBase: result.file, colorBaseFull: result.file, colorBaseTight: null, tight: false };
        });
      }
      return [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: raw, originalUrl, enhanced: result.file, enhancedUrl: result.previewUrl, useEnhanced: true, framed: true, mode: 'color', colorBase: result.file, colorBaseFull: result.file, colorBaseTight: null, tight: false,
      }];
    });
    setCropFile(null);
    setRecropId(null);
  };
  const onCropCancel = () => { setCropFile(null); setRecropId(null); };
  const reCrop = (p: Page) => { setRecropId(p.id); setCropFile(p.original); };
  // One-tap manual rotate of a page result (the reliable backstop when
  // auto-rotate doesn't land — e.g. a landscape certificate shot in portrait).
  const rotatePage = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    setBusy(true); setError('');
    try {
      // Rotate the FULL color base, re-derive the tight crop from it (so the
      // "Whole page"/"Tight" toggle stays valid), then re-apply the current
      // Color/Gray/B&W mode to whichever base is active.
      const rotatedFull = await rotateFile90WithPreview(page.colorBaseFull);
      const tightFile = page.colorBaseTight
        ? (await tightenScanFile(rotatedFull.file).catch(() => null))
        : null;
      const active = page.tight && tightFile ? tightFile : rotatedFull;
      let enhanced = active.file, previewUrl = active.previewUrl;
      if (page.mode !== 'color') {
        const m = await applyColorMode(active.file, page.mode);
        enhanced = m.file; previewUrl = m.previewUrl;
      }
      setPages((prev) => prev.map((p) => (p.id === id
        ? { ...p, colorBaseFull: rotatedFull.file, colorBaseTight: tightFile ? tightFile.file : null, colorBase: active.file, tight: page.tight && !!tightFile, enhanced, enhancedUrl: previewUrl, useEnhanced: true }
        : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rotate.');
    } finally { setBusy(false); }
  };

  // Toggle between the margin-trimmed crop (writing fills the frame) and the
  // whole page. Re-applies the current Color/Gray/B&W mode to the new base.
  const toggleTight = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page || !page.colorBaseTight) return;
    setBusy(true); setError('');
    try {
      const nextTight = !page.tight;
      const base = nextTight ? page.colorBaseTight : page.colorBaseFull;
      let enhanced = base, previewUrl = URL.createObjectURL(base);
      if (page.mode !== 'color') {
        const m = await applyColorMode(base, page.mode);
        enhanced = m.file; previewUrl = m.previewUrl;
      } else {
        const r = await applyColorMode(base, 'color'); // normalise → data-URL preview
        enhanced = r.file; previewUrl = r.previewUrl;
      }
      setPages((prev) => prev.map((p) => (p.id === id
        ? { ...p, tight: nextTight, colorBase: base, enhanced, enhancedUrl: previewUrl, useEnhanced: true }
        : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change crop.');
    } finally { setBusy(false); }
  };

  const setPageMode = async (id: string, mode: ScanColorMode) => {
    const page = pages.find((p) => p.id === id);
    if (!page || page.mode === mode) return;
    setBusy(true); setError('');
    try {
      const r = await applyColorMode(page.colorBase, mode);
      setPages((prev) => prev.map((p) => (p.id === id
        ? { ...p, mode, enhanced: r.file, enhancedUrl: r.previewUrl, useEnhanced: true }
        : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change mode.');
    } finally { setBusy(false); }
  };

  const toggleVariant = (id: string) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, useEnhanced: !p.useEnhanced } : p)));
  };
  const removePage = (id: string) => {
    setPages((prev) => {
      const dropped = prev.find((p) => p.id === id);
      if (dropped) URL.revokeObjectURL(dropped.originalUrl);
      return prev.filter((p) => p.id !== id);
    });
  };
  const addPage = () => inputRef.current?.click();

  const send = async () => {
    if (pages.length === 0) return;
    setBusy(true); setError('');
    try {
      const files = pages.map((p) => (p.useEnhanced ? p.enhanced : p.original));
      await onConfirm(files);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
      setBusy(false);
    }
  };

  if (!open) return null;

  const title = mode === 'scan' ? '📄 Scan document' : '📷 Take photo';
  const subtitle = mode === 'scan'
    ? 'Snap each page — AI finds it, straightens it, and sharpens it.'
    : 'AI brightens + sharpens for a clean send.';
  const sendLabel = pages.length === 0
    ? 'Send →'
    : `Send ${pages.length} ${mode === 'scan' ? (pages.length === 1 ? 'page' : 'pages') : (pages.length === 1 ? 'photo' : 'photos')} →`;

  return (
    <>
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-kaya-cream rounded-t-3xl sm:rounded-3xl p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-display font-extrabold text-[16px] text-kaya-chocolate">{title}</h3>
          <button type="button" onClick={onClose} className="text-kaya-sand text-xs font-bold">Close</button>
        </div>
        <p className="text-[12px] text-kaya-sand mb-3">{subtitle}</p>

        {/* Hidden native capture input */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleCapture}
        />

        {/* Captured pages — Original/AI compare per page */}
        <div className="space-y-3">
          {pages.map((p, i) => (
            <div key={p.id} className="bg-white border border-kaya-warm-dark/50 rounded-kaya p-3">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand">
                  {mode === 'scan' ? `Page ${i + 1}` : 'Photo'}
                </span>
                <button type="button" onClick={() => removePage(p.id)}
                  className="text-[11px] font-bold text-hive-rose hover:underline">Remove</button>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button type="button" onClick={() => toggleVariant(p.id)}
                  aria-pressed={!p.useEnhanced}
                  className={`relative aspect-[3/4] rounded-kaya overflow-hidden border-2 ${!p.useEnhanced ? 'border-kaya-chocolate' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.originalUrl} alt="Original" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 text-[9px] font-black bg-black/50 text-white px-1.5 py-0.5 rounded">Original</span>
                </button>
                <button type="button" onClick={() => toggleVariant(p.id)}
                  aria-pressed={p.useEnhanced}
                  className={`relative aspect-[3/4] rounded-kaya overflow-hidden border-2 ${p.useEnhanced ? 'border-kaya-chocolate' : 'border-transparent'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.enhancedUrl} alt="Enhanced" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 text-[9px] font-black bg-kaya-chocolate text-white px-1.5 py-0.5 rounded">{p.framed ? 'Framed ✨' : 'AI ✨'}</span>
                </button>
              </div>
              <p className="text-[10px] text-kaya-sand">Tap a thumbnail to choose which we&apos;ll send.</p>
              {mode === 'scan' && (
                <>
                  <div className="mt-2 flex items-center gap-1.5">
                    {MODES.map((m) => (
                      <button key={m.id} type="button" onClick={() => setPageMode(p.id, m.id)} disabled={busy}
                        className={`flex-1 h-8 rounded-kaya text-[11px] font-bold border disabled:opacity-40 ${p.mode === m.id ? 'border-kaya-chocolate bg-kaya-chocolate/10 text-kaya-chocolate' : 'border-kaya-warm-dark text-kaya-sand'}`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {p.colorBaseTight && (
                    <button type="button" onClick={() => toggleTight(p.id)} disabled={busy}
                      className={`mt-2 w-full h-9 rounded-kaya border font-bold text-[12px] disabled:opacity-40 ${p.tight ? 'border-kaya-chocolate bg-kaya-chocolate/10 text-kaya-chocolate' : 'border-kaya-warm-dark text-kaya-sand'}`}>
                      {p.tight ? '✂️ Cropped to writing · tap for whole page' : '🗒 Whole page · tap to crop tight'}
                    </button>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={() => reCrop(p)} disabled={busy}
                      className="flex-1 h-9 rounded-kaya border border-kaya-warm-dark text-kaya-chocolate font-bold text-[12px] disabled:opacity-40">✂️ Adjust crop</button>
                    <button type="button" onClick={() => rotatePage(p.id)} disabled={busy}
                      className="flex-1 h-9 rounded-kaya border border-kaya-warm-dark text-kaya-chocolate font-bold text-[12px] disabled:opacity-40">⟲ Rotate</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {pages.length === 0 && (
          <div className="rounded-kaya bg-white border border-dashed border-kaya-warm-dark/50 p-6 text-center">
            <div className="text-3xl mb-1">{mode === 'scan' ? '📄' : '📷'}</div>
            <p className="text-[13px] font-bold text-kaya-chocolate">{busy ? 'Loading…' : 'Tap below to open the camera.'}</p>
          </div>
        )}

        {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={addPage} disabled={busy || (mode === 'photo' && pages.length >= 1)}
            className="flex-1 h-11 rounded-kaya bg-white border border-kaya-warm-dark text-kaya-chocolate font-display font-bold text-[13px] disabled:opacity-40">
            {pages.length === 0 ? (mode === 'scan' ? 'Open camera' : 'Open camera') : (mode === 'scan' ? '＋ Add page' : '＋ Retake')}
          </button>
          <button type="button" onClick={send} disabled={busy || pages.length === 0}
            className="flex-1 h-11 rounded-kaya bg-kaya-chocolate text-white font-display font-bold text-[13px] disabled:opacity-40">
            {busy ? 'Working…' : sendLabel}
          </button>
        </div>

        {mode === 'photo' && pages.length >= 1 && (
          <p className="text-[10px] text-kaya-sand mt-2 text-center">One photo per send — tap Retake to swap.</p>
        )}
        {mode === 'scan' && (
          <p className="text-[10px] text-kaya-sand mt-2 text-center">{pages.length}/10 pages · crop each page, then send.</p>
        )}
      </div>
    </div>
    {cropFile && (
      <DocumentCropEditor
        file={cropFile}
        title={mode === 'scan' ? 'Crop the page' : 'Crop'}
        onConfirm={onCropConfirm}
        onCancel={onCropCancel}
      />
    )}
    </>
  );
}
