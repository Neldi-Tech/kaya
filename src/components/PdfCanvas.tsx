'use client';

// Kaya · in-app PDF renderer (PDF.js → <canvas>).
//
// Why this exists: iOS WKWebView — especially an installed home-screen PWA —
// will NOT render a PDF inside an <iframe>; it just shows a blank/white area.
// (That was the "opens but blank" bug after the storage-proxy fix.) Drawing
// each page to a <canvas> with PDF.js renders reliably everywhere, in-app, so
// the kid never leaves Kaya and the profile/session is never disturbed.
//
// Wiring notes:
//  • pdfjs-dist is loaded with a dynamic import inside useEffect so it only
//    runs in the browser (it touches DOMMatrix/canvas — never on the server).
//  • The worker is served same-origin from /public/pdf.worker.min.mjs (copied
//    from pdfjs-dist/build at the pinned version) — avoids the import.meta.url
//    / cross-origin CDN worker pitfalls that break under the PWA.
//  • The url passed in is already our same-origin proxy URL
//    (/api/sparks/material-file?...&mode=inline), so the fetch is same-origin
//    and CORS-safe.

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Same-origin URL to the PDF bytes (the material-file proxy URL). */
  url: string;
}

export default function PdfCanvas({ url }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: { destroy: () => void; numPages: number; getPage: (n: number) => Promise<unknown> } | null = null;

    (async () => {
      setStatus('loading');
      setErrMsg('');
      try {
        // Dynamic import → browser-only. The .mjs build is the one Next can
        // bundle for the client.
        const pdfjs = await import('pdfjs-dist');
        // Same-origin worker (see file header).
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const loadingTask = pdfjs.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) { pdf.destroy(); return; }
        doc = pdf as unknown as typeof doc;
        setPageCount(pdf.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        // Render every page top-to-bottom (revision PDFs are short). Width is
        // capped to the container so it fits the phone; DPR scaling keeps it
        // crisp on retina.
        const containerWidth = container.clientWidth || 360;
        const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = (containerWidth - 16) / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 10px';
          canvas.style.borderRadius = '6px';
          canvas.style.background = 'white';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.scale(dpr, dpr);
          container.appendChild(canvas);

          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setErrMsg(e instanceof Error ? e.message : 'Could not open this PDF.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try { doc?.destroy(); } catch { /* noop */ }
    };
  }, [url]);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#3A3A3A]">
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center text-white/80">
          <div className="text-center">
            <div className="inline-block w-6 h-6 rounded-full border-2 border-white/40 border-t-white animate-spin mb-3" aria-hidden />
            <div className="text-[13px] font-bold">Opening…</div>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="bg-white rounded-2xl p-6 max-w-sm text-center">
            <div className="text-5xl mb-2" aria-hidden>📄</div>
            <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">Couldn&apos;t open this PDF</div>
            <div className="text-[12.5px] text-[#5A6488] mt-1.5 leading-snug">{errMsg}</div>
            <div className="text-[11px] text-[#5A6488] mt-2 leading-snug">Try the Download button at the top.</div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="mx-auto max-w-[820px] px-2 py-3"
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
        aria-label={pageCount ? `PDF, ${pageCount} page${pageCount === 1 ? '' : 's'}` : 'PDF'}
      />
    </div>
  );
}
