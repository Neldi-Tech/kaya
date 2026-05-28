'use client';

// Kaya · in-app document viewer.
//
// Renders a full-screen overlay with the document's content inline:
//   • PDFs   → <iframe> over the storage URL (browser-native PDF viewer)
//   • Images → object-contain <img>
//   • Other  → friendly "preview not supported" + download CTA
//
// Used by chat (message thread doc attachments) and by Home Practice
// Materials. Both surfaces also expose a "Download" action via the
// sibling DocActionSheet — so the kid / parent can choose.

import { useEffect } from 'react';

export interface DocViewerProps {
  open: boolean;
  doc: { url: string; name?: string; mime?: string } | null;
  onClose: () => void;
  /** Triggered from the top bar — typically a fetch-blob + saveAs. */
  onDownload?: () => void;
}

function classifyMime(mime?: string): 'pdf' | 'image' | 'other' {
  if (!mime) return 'other';
  const m = mime.toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  return 'other';
}

export default function DocViewer({ open, doc, onClose, onDownload }: DocViewerProps) {
  // Lock body scroll while the viewer is up so a long PDF doesn't tug
  // the underlying chat / materials list around.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape closes the viewer — keyboard users + desktop preview.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !doc) return null;
  const kind = classifyMime(doc.mime);
  const safeName = doc.name || 'Document';

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Top bar — close + title + download */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/80 text-white">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-[12px] font-bold"
        >
          ← Close
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold truncate">{safeName}</div>
          <div className="text-[10.5px] opacity-70 truncate">{doc.mime || ''}</div>
        </div>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            aria-label="Download"
            className="rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-[12px] font-bold"
          >
            ⬇ Download
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        {kind === 'pdf' && (
          <iframe
            src={doc.url}
            title={safeName}
            className="absolute inset-0 w-full h-full border-0 bg-white"
          />
        )}
        {kind === 'image' && (
          <div className="absolute inset-0 grid place-items-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doc.url} alt={safeName} className="max-w-full max-h-full object-contain" />
          </div>
        )}
        {kind === 'other' && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
              <div className="text-5xl mb-2" aria-hidden>📎</div>
              <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">Preview not supported</div>
              <div className="text-[12.5px] text-[#5A6488] mt-1.5 leading-snug">
                {doc.mime ? `Kaya can't render ${doc.mime} files inline — please download to view.` : 'This file type can\'t be previewed inline — please download to view.'}
              </div>
              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#5A3CB8] text-white px-4 py-2 text-[13px] font-extrabold"
                >
                  ⬇ Download
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
