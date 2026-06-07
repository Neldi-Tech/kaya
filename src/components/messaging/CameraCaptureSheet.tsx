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
import { enhancePhoto, autoFrameScan } from '@/lib/photoEnhance';

type Page = {
  id: string;
  original: File;
  enhanced: File;
  enhancedUrl: string;
  originalUrl: string;
  useEnhanced: boolean;
  /** scan mode: true when the page was auto-framed (vs clean-only fallback). */
  framed: boolean;
};

export default function CameraCaptureSheet({
  open, mode, onClose, onConfirm,
}: {
  open: boolean;
  mode: 'photo' | 'scan';
  onClose: () => void;
  /** Caller persists the chosen files (`useEnhanced` is already applied
   *  here — each File is the variant the kid picked). */
  onConfirm: (files: File[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    }
  }, [open]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';                                       // allow re-capturing
    if (!file) return;
    setBusy(true); setError('');
    try {
      let enhancedFile: File, previewUrl: string, framed = false;
      if (mode === 'scan') {
        const r = await autoFrameScan(file);
        enhancedFile = r.file; previewUrl = r.previewUrl; framed = r.framed;
      } else {
        const r = await enhancePhoto(file);
        enhancedFile = r.file; previewUrl = r.previewUrl;
      }
      const page: Page = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original: file,
        enhanced: enhancedFile,
        enhancedUrl: previewUrl,
        originalUrl: URL.createObjectURL(file),
        useEnhanced: true,                                     // AI on by default
        framed,
      };
      setPages((prev) => [...prev, page]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process the photo.');
    } finally {
      setBusy(false);
    }
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
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
              <p className="text-[10px] text-kaya-sand">Tap to choose which one we'll send.</p>
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
          <p className="text-[10px] text-kaya-sand mt-2 text-center">{pages.length}/10 pages · each goes as its own image (PDF in a follow-up).</p>
        )}
      </div>
    </div>
  );
}
