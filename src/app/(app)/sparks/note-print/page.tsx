'use client';

// Timeline 2.0 · 📄 A5 note print (approved design v2 §3, 2026-08-25).
//
// Print-styled route for a day's note — or a whole month as a mini-book
// with a cover. PDF is browser-native (window.print → "Save as PDF"),
// the purchase-printable pattern with @page A5. The Note Studio hands
// the notes over via localStorage (kaya.notePrint.v1) — no server round
// trip and nothing sensitive in the URL.

import { useState } from 'react';
import Link from 'next/link';
import {
  type NotePrintPayload, readNotesForPrint, notePalette,
} from '@/lib/noteCards';

export default function NotePrintPage() {
  const [payload] = useState<NotePrintPayload | null>(() => readNotesForPrint());

  if (!payload || payload.notes.length === 0) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-center px-6">
        <div>
          <p className="text-[14px] text-[#5A6488] mb-3">
            Nothing staged to print — open a note and tap 📄 A5 PDF.
          </p>
          <Link href="/sparks" className="font-nunito font-extrabold text-[13px] text-[#7A2E5C] underline">
            ‹ Back to Sparks
          </Link>
        </div>
      </div>
    );
  }

  const p = notePalette(payload.theme);
  const book = payload.notes.length > 1;

  return (
    <div className="min-h-screen bg-[#F6F1E8]">
      {/* controls — hidden in print */}
      <div className="no-print sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#EDE6DA] px-4 py-3 flex items-center gap-3">
        <Link href="/sparks" className="font-nunito font-extrabold text-[12.5px] text-[#5A6488]">‹ Sparks</Link>
        <span className="font-nunito font-black text-[14px] text-[#0F1F44]">
          📄 {payload.title} {book ? `· ${payload.notes.length} notes` : ''}
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => window.print()}
            className="rounded-xl bg-[#7A2E5C] px-4 py-2 font-nunito font-extrabold text-[12.5px] text-white">
            ⬇︎ Save as PDF
          </button>
          <button type="button" onClick={() => window.print()}
            className="rounded-xl border-[1.5px] border-[#EDE6DA] bg-white px-4 py-2 font-nunito font-extrabold text-[12.5px] text-[#7A2E5C]">
            🖨 Print
          </button>
        </div>
      </div>
      <p className="no-print text-center text-[11px] text-[#5A6488] mt-2">
        Pick “A5” as the paper size in the print dialog if it isn’t preselected.
      </p>

      <div id="note-print-sheets" className="mx-auto max-w-[420px] py-6 space-y-6">
        {/* cover page for a multi-note book */}
        {book && (
          <div className="note-sheet rounded-2xl shadow-lg flex flex-col items-center justify-center text-center px-8"
            style={{ background: p.bg, border: `2.5px solid ${p.edge}`, minHeight: 560 }}>
            <div className="text-[52px] mb-3">{p.decor}</div>
            <div className="font-display font-extrabold text-[26px]" style={{ color: p.name }}>
              {payload.notes[0]?.kidName}’s Notes
            </div>
            <div className="font-nunito font-extrabold text-[15px] mt-1" style={{ color: p.date }}>
              {payload.title} · {payload.notes.length} days
            </div>
            <div className="mt-8 font-nunito font-extrabold text-[12px]" style={{ color: p.footer }}>
              Made with <span style={{ color: p.brand, fontWeight: 900 }}>Kaya</span> 💛 · ourkaya.com
            </div>
          </div>
        )}

        {payload.notes.map((n) => (
          <div key={n.dateKey} className="note-sheet rounded-2xl shadow-lg px-7 py-7 flex flex-col"
            style={{ background: p.bg, border: `2.5px solid ${p.edge}`, minHeight: 560 }}>
            <div className="flex items-center gap-3">
              <span className="text-[34px] leading-none">{n.feeling || '📝'}</span>
              <div>
                <div className="font-display font-extrabold text-[17px]" style={{ color: p.name }}>
                  {n.kidName} · {n.surfaceLabel}
                </div>
                <div className="font-nunito font-bold text-[11.5px]" style={{ color: p.date }}>{n.dateLabel}</div>
              </div>
            </div>
            <div className="h-[3px] w-[130px] rounded-full mt-3 mb-4" style={{ background: p.rule }} />
            <div className="text-[14px] leading-[1.8] italic whitespace-pre-wrap grow"
              style={{ color: p.text, fontFamily: 'Lato, Georgia, serif' }}>
              “{n.text}”
            </div>
            <div className="mt-5 pt-3 flex justify-between font-nunito font-extrabold text-[10.5px]"
              style={{ color: p.footer, borderTop: `1.5px solid ${p.edge}` }}>
              <span>Made with <span style={{ color: p.brand, fontWeight: 900 }}>Kaya</span> 💛</span>
              <span>ourkaya.com</span>
            </div>
          </div>
        ))}
      </div>

      {/* the purchase-printable pattern, A5 flavour */}
      <style>{`
        @media print {
          body { visibility: hidden !important; }
          #note-print-sheets, #note-print-sheets * { visibility: visible !important; }
          #note-print-sheets { position: absolute; left: 0; top: 0; width: 100%; max-width: none; padding: 0; }
          .no-print { display: none !important; }
          .note-sheet {
            box-shadow: none !important; border-radius: 0 !important;
            page-break-after: always; break-after: page; min-height: auto !important;
          }
          @page { size: A5; margin: 10mm; }
        }
        #note-print-sheets { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>
    </div>
  );
}
