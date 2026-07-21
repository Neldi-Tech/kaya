'use client';

// Kaya Sparks · markdown-lite renderer for ✨ polished pages (Slice 8h).
//
// Renders the small subset /api/sparks/ai/polish emits — # Title,
// paragraphs, "- " bullets, "1. " numbers, **bold** — and offers a
// ↺ view-original flip. No external markdown dep (that subset is tiny
// and we control the producer). Bold is the only inline markup.

import { useState, type ReactNode } from 'react';

/** Split a line into text + **bold** runs. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={k++} className="font-extrabold">{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Render markdown-lite as themed blocks. */
export function renderMarkdownLite(md: string): ReactNode[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const nodes: ReactNode[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  let key = 0;
  const flush = () => {
    if (bullets.length) {
      nodes.push(
        <ul key={`u${key++}`} className="my-1.5 pl-5 list-disc space-y-0.5">
          {bullets.map((b, i) => <li key={i} className="leading-snug">{inline(b)}</li>)}
        </ul>,
      );
      bullets = [];
    }
    if (numbers.length) {
      nodes.push(
        <ol key={`o${key++}`} className="my-1.5 pl-5 list-decimal space-y-0.5">
          {numbers.map((b, i) => <li key={i} className="leading-snug">{inline(b)}</li>)}
        </ol>,
      );
      numbers = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    const b = /^[-*]\s+(.*)$/.exec(line);
    const n = /^\d+\.\s+(.*)$/.exec(line);
    if (h) { flush(); nodes.push(<div key={`h${key++}`} className="font-display font-extrabold text-[15px] text-[#7A2E5C] mt-1 mb-1">{inline(h[1])}</div>); }
    else if (b) { numbers.length && flush(); bullets.push(b[1]); }
    else if (n) { bullets.length && flush(); numbers.push(n[1]); }
    else { flush(); nodes.push(<p key={`p${key++}`} className="my-1 leading-relaxed">{inline(line)}</p>); }
  }
  flush();
  return nodes;
}

/** A polished page with a ↺ view-original flip. `original` is the raw
 *  text; `polished` is the markdown-lite. */
export function PolishedText({
  polished, original, sw,
}: {
  polished: string;
  original: string;
  sw?: boolean;
}) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div>
      {showRaw ? (
        <div className="text-[13px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">{original}</div>
      ) : (
        <div className="text-[13px] text-[#0F1F44]">{renderMarkdownLite(polished)}</div>
      )}
      <button type="button" onClick={() => setShowRaw((v) => !v)}
        className="mt-1.5 text-[10.5px] font-extrabold text-[#7A2E5C] underline underline-offset-2">
        {showRaw
          ? (sw ? '✨ Onyesha iliyoboreshwa' : '✨ Show polished')
          : (sw ? '↺ Ona maandishi ya asili' : '↺ View original')}
      </button>
    </div>
  );
}

/** Compact ✨ Polish control: button → preview → Use / Keep-mine.
 *  `getText` returns the current raw text; `onAccept` receives the
 *  polished markdown to store. */
export function PolishControl({
  getText, onAccept, sw, disabled,
}: {
  getText: () => string;
  onAccept: (polished: string) => void;
  sw?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ raw: string; polished: string } | null>(null);
  const [err, setErr] = useState('');

  const run = async () => {
    const raw = getText().trim();
    if (!raw) return;
    setBusy(true); setErr('');
    try {
      const { polishText } = await import('@/lib/sparks/diary');
      const polished = await polishText(raw);
      if (polished) setPreview({ raw, polished });
      else setErr(sw ? 'AI haiwezi kuboresha sasa.' : 'Polish is off right now — your words are saved as they are.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={run} disabled={busy || disabled}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-extrabold px-2.5 py-1.5 rounded-full bg-[#E5D6FF] text-[#5A3CB8] disabled:opacity-50">
        ✨ {busy ? (sw ? 'Inaboresha…' : 'Polishing…') : (sw ? 'Boresha ukurasa' : 'Polish my page')}
      </button>
      {err && <span className="text-[10.5px] text-[#A33A2A] ml-2">{err}</span>}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <button type="button" aria-label="Close" onClick={() => setPreview(null)} className="absolute inset-0 bg-black/40" />
          <div className="relative w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
            <div className="px-5 pt-4 pb-3 text-white sticky top-0" style={{ background: 'linear-gradient(135deg, #5A3CB8, #8E7BE0)' }}>
              <div className="font-display font-extrabold text-[16px]">✨ {sw ? 'Ukurasa ulioboreshwa' : 'Your polished page'}</div>
              <div className="text-[10.5px] opacity-90">{sw ? 'Maana ile ile — nadhifu tu.' : 'Same meaning — just tidied. Nothing added.'}</div>
            </div>
            <div className="p-4">
              <div className="rounded-xl border-2 border-[#8E7BE0] bg-[#F6EFFF] p-3 text-[13px] text-[#0F1F44]">
                {renderMarkdownLite(preview.polished)}
              </div>
              <details className="mt-2">
                <summary className="text-[11px] font-extrabold text-[#5A6488] cursor-pointer">{sw ? '↺ Ona maandishi yangu ya asili' : '↺ View my original'}</summary>
                <div className="mt-1.5 rounded-lg bg-[#FBF7EE] border border-[#ECE4D3] p-3 text-[12.5px] text-[#0F1F44] leading-relaxed whitespace-pre-wrap">{preview.raw}</div>
              </details>
              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => { onAccept(preview.polished); setPreview(null); }}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-extrabold text-white" style={{ background: '#5A3CB8' }}>
                  ✨ {sw ? 'Tumia iliyoboreshwa' : 'Use polished'}
                </button>
                <button type="button" onClick={() => setPreview(null)}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-extrabold bg-white border-2 border-[#5A3CB8] text-[#5A3CB8]">
                  {sw ? 'Weka yangu' : 'Keep mine'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
