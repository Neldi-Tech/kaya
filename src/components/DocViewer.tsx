'use client';

// Kaya · in-app document viewer.
//
// Renders a full-screen overlay with the document's content inline:
//   • PDFs            → <iframe> over the storage URL (native browser viewer)
//   • Images          → object-contain <img>
//   • Office docs     → Microsoft Office Online viewer iframe
//                       (docx · xlsx · pptx · doc · xls · ppt)
//   • Other           → friendly "preview not supported" + download CTA
//
// Used by chat (message thread doc attachments) and by Home Practice
// Materials. Both surfaces also expose a "Download" action via the
// sibling DocActionSheet — so the kid / parent can choose.
//
// Office viewer note (2026-05-28): Microsoft's view.officeapps.live.com
// is a free, no-auth embed that renders Office documents as HTML. It
// needs a publicly fetchable URL — Firebase Storage download URLs come
// with an `?alt=media&token=…` query that lets the service fetch the
// file without our user being signed in to anything Microsoft-related.
// This is the same pattern WhatsApp Web / Slack use for Office previews.

import { useEffect, useMemo } from 'react';

export interface DocViewerProps {
  open: boolean;
  doc: { url: string; name?: string; mime?: string } | null;
  onClose: () => void;
  /** Triggered from the top bar — typically a fetch-blob + saveAs. */
  onDownload?: () => void;
}

type ViewerKind = 'pdf' | 'image' | 'office' | 'other';

/** Trailing slice after the last "." (or the empty string). */
function extOf(name?: string): string {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

const OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.ms-word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

function classify(mime?: string, name?: string): ViewerKind {
  const m = (mime || '').toLowerCase();
  const e = extOf(name);
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(e)) return 'image';
  if (OFFICE_MIMES.has(m) || OFFICE_EXTS.has(e)) return 'office';
  return 'other';
}

/** Build a Microsoft Office Online viewer URL for the given file URL. */
function officeViewerSrc(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
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

  // Hooks must come BEFORE the early-return so the order is stable
  // across renders.
  const kind = useMemo<ViewerKind>(() => classify(doc?.mime, doc?.name), [doc?.mime, doc?.name]);
  const officeSrc = useMemo(() => doc?.url ? officeViewerSrc(doc.url) : '', [doc?.url]);

  if (!open || !doc) return null;
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
        {kind === 'office' && (
          <iframe
            src={officeSrc}
            title={safeName}
            // sandbox + referrerPolicy keep this iframe defensive — the
            // viewer only needs the file URL it can already fetch.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full border-0 bg-white"
          />
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
