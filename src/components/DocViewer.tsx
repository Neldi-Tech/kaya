'use client';

// Kaya · in-app document viewer.
//
// Renders a full-screen overlay with the document's content inline:
//   • PDFs            → <iframe> over the storage URL (native browser viewer)
//   • Images          → object-contain <img>
//   • .docx           → mammoth.js in-browser conversion to HTML
//                       (Microsoft's free Office Online embed kept
//                        returning "File not found" against Firebase
//                        Storage URLs on iOS — switched to client-side
//                        conversion to remove the external dependency.)
//   • Other           → friendly "preview not supported" + download CTA
//
// Used by chat (message thread doc attachments) and by Home Practice
// Materials. Both surfaces also expose a "Download" action via the
// sibling DocActionSheet — so the kid / parent can choose.

import { useEffect, useMemo, useState } from 'react';
import PdfCanvas from '@/components/PdfCanvas';
import ZoomableImage from '@/components/ZoomableImage';

export interface DocViewerProps {
  open: boolean;
  doc: { url: string; name?: string; mime?: string } | null;
  onClose: () => void;
  /** Triggered from the top bar — typically a fetch-blob + saveAs. */
  onDownload?: () => void;
  /** Optional same-origin URL to render the PDF iframe / image from, instead
   *  of `doc.url`. Used by Sparks Materials to route inline viewing through a
   *  proxy (iOS hijacks a cross-origin storage URL in an iframe and breaks
   *  navigation). The docx path always uses `doc.url` (server-side render). */
  viewerUrl?: string;
}

type ViewerKind = 'pdf' | 'image' | 'docx' | 'other';

/** Trailing slice after the last "." (or the empty string). */
function extOf(name?: string): string {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function classify(mime?: string, name?: string): ViewerKind {
  const m = (mime || '').toLowerCase();
  const e = extOf(name);
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(e)) return 'image';
  if (m === DOCX_MIME || e === 'docx') return 'docx';
  return 'other';
}

/** Inline .docx renderer. Calls `/api/docx-render` which fetches the
 *  Firebase Storage file server-side and runs mammoth there — keeps
 *  the heavy library out of the browser bundle AND sidesteps CORS
 *  (browsers can't `fetch()` Firebase Storage URLs cross-origin
 *  without explicit bucket-level CORS config). */
function DocxBody({ url, name }: { url: string; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setHtml(null);
    (async () => {
      try {
        const res = await fetch(`/api/docx-render?url=${encodeURIComponent(url)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `Render service returned ${res.status}`);
        }
        if (cancelled) return;
        setHtml((data?.html as string | undefined) || '<p><em>This document is empty.</em></p>');
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Could not read the document.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (loading) {
    return (
      <div className="absolute inset-0 grid place-items-center text-white/80">
        <div className="text-center">
          <div className="inline-block w-6 h-6 rounded-full border-2 border-white/40 border-t-white animate-spin mb-3" aria-hidden />
          <div className="text-[13px] font-bold">Reading {name}…</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6">
        <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
          <div className="text-5xl mb-2" aria-hidden>📄</div>
          <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">Couldn&apos;t render this document</div>
          <div className="text-[12.5px] text-[#5A6488] mt-1.5 leading-snug">{err}</div>
          <div className="text-[11px] text-[#5A6488] mt-2 leading-snug">Try Download to view in your device&apos;s Word app.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-white">
      <div
        className="mx-auto max-w-[760px] px-5 py-6 text-[14px] text-[#0F1F44] leading-relaxed kaya-docx"
        // mammoth output is well-known + comes from a file the user
        // chose to upload + render — safe to dangerouslySetInnerHTML.
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
      <style jsx>{`
        :global(.kaya-docx h1) { font-size: 22px; font-weight: 800; margin: 18px 0 10px; }
        :global(.kaya-docx h2) { font-size: 18px; font-weight: 800; margin: 14px 0 8px; }
        :global(.kaya-docx h3) { font-size: 15px; font-weight: 800; margin: 12px 0 6px; }
        :global(.kaya-docx p)  { margin: 0 0 10px; }
        :global(.kaya-docx ul), :global(.kaya-docx ol) { padding-left: 22px; margin: 0 0 10px; }
        :global(.kaya-docx li) { margin: 2px 0; }
        :global(.kaya-docx table) { border-collapse: collapse; margin: 10px 0; }
        :global(.kaya-docx th), :global(.kaya-docx td) { border: 1px solid #ECE4D3; padding: 6px 10px; }
        :global(.kaya-docx img) { max-width: 100%; height: auto; }
        :global(.kaya-docx a) { color: #5A3CB8; text-decoration: underline; }
      `}</style>
    </div>
  );
}

export default function DocViewer({ open, doc, onClose, onDownload, viewerUrl }: DocViewerProps) {
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
          // When a same-origin viewerUrl is supplied (Sparks Materials via the
          // material-file proxy), render with PDF.js → <canvas>: an <iframe>
          // shows BLANK for PDFs in an iOS home-screen PWA. Other callers
          // (e.g. chat) keep the native iframe viewer.
          viewerUrl ? (
            <PdfCanvas url={viewerUrl} />
          ) : (
            <iframe
              src={doc.url}
              title={safeName}
              className="absolute inset-0 w-full h-full border-0 bg-white"
            />
          )
        )}
        {kind === 'image' && (
          <div className="absolute inset-0 p-2">
            <ZoomableImage src={viewerUrl || doc.url} alt={safeName} />
          </div>
        )}
        {kind === 'docx' && (
          <DocxBody url={doc.url} name={safeName} />
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
