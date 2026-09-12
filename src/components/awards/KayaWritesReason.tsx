'use client';

// ✨ Kaya Writes · Award Points — the "Tell them why" drafting block.
//
// Sits under the reason textarea (mobile + desktop layouts share it). One
// tap asks /api/awards/draft-reason for THREE short kid-facing lines built
// from what the parent already picked on the page — kid(s), category,
// points type + amount — and whatever they typed so far (shaped, never
// discarded). "Use" drops a line into the textarea; the parent edits
// freely. Refine chips re-ask with a nudge. Honours the family's Kaya
// Writes switch (greetingConfig.kayaWrites — absent = on) via `enabled`.

import { useState } from 'react';
import type { AwardKind } from '@/lib/firestore';

const GOLD = '#B8860B';
const GOLD_SOFT = '#FFF1C9';
const GOLD_DK = '#8A6800';

export interface KayaWritesReasonProps {
  /** First names of the selected kid(s). */
  kidNames: string[];
  /** Category label as shown on the page ("Kindness"); '' until picked. */
  category: string;
  kind: AwardKind;
  /** Signed points (0 for kudos / improvement notes). */
  points: number;
  /** The current textarea value — Kaya shapes it. */
  hint: string;
  lang: 'en' | 'sw';
  /** Family switch — when false the block renders nothing. */
  enabled: boolean;
  onUse: (text: string) => void;
}

export default function KayaWritesReason({ kidNames, category, kind, points, hint, lang, enabled, onUse }: KayaWritesReasonProps) {
  const [busy, setBusy] = useState(false);
  const [sugs, setSugs] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [off, setOff] = useState(false);
  const [lastRefine, setLastRefine] = useState('');

  if (!enabled || off) return null;

  const ready = kidNames.length > 0 && !!category;

  async function write(refine?: string) {
    if (!ready || busy) return;
    setBusy(true); setNote(''); setLastRefine(refine || '');
    try {
      const res = await fetch('/api/awards/draft-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kidNames, category, kind, points, hint: hint.trim(), lang, ...(refine ? { refine } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.skipped) { setOff(true); return; } // no key on this environment — stay silent
      if (!res.ok || data?.error || !Array.isArray(data?.suggestions)) {
        setNote(typeof data?.error === 'string' ? data.error : 'Kaya couldn’t write just now.');
        setSugs([]);
        return;
      }
      setSugs(data.suggestions as string[]);
    } catch {
      setNote('Kaya couldn’t write just now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2.5" data-testid="kaya-writes-reason">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-kaya-sand leading-snug">
          {ready
            ? (hint.trim() ? 'Kaya can tidy your words into a note they’ll love.' : 'Not sure how to say it? Kaya drafts three lines from what you picked.')
            : 'Pick a child and a category, then Kaya can draft the note.'}
        </p>
        <button
          type="button"
          onClick={() => void write()}
          disabled={!ready || busy}
          className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-50 shrink-0"
          style={{ background: GOLD }}
        >
          {busy ? '✨ Writing…' : sugs.length ? '🔄 Write again' : '✨ Kaya Writes'}
        </button>
      </div>

      {busy && (
        <div className="space-y-1.5 mt-2" aria-live="polite">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-kaya-sm border border-kaya-warm-dark bg-white px-3 py-2 animate-pulse">
              <div className="h-3 w-5/6 rounded bg-kaya-warm mb-1.5" /><div className="h-3 w-2/3 rounded bg-kaya-warm" />
            </div>
          ))}
          <div className="text-[11px] text-kaya-sand">Kaya is writing three notes{lastRefine ? ` — ${lastRefine.toLowerCase()}` : ''}…</div>
        </div>
      )}

      {note && !busy && (
        <div className="text-[11px] text-red-600 font-bold mt-1.5">
          {note} <button type="button" onClick={() => void write()} className="underline">Try again</button>
        </div>
      )}

      {sugs.length > 0 && !busy && (
        <div className="space-y-1.5 mt-2">
          {sugs.map((s, i) => {
            const using = hint.trim() === s;
            return (
              <div key={i} className="rounded-kaya-sm border border-kaya-warm-dark bg-white pl-3 pr-16 py-2 relative">
                <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: GOLD_DK }}>Draft {i + 1}</div>
                <div className="text-[13px] text-kaya-chocolate leading-snug">{s}</div>
                <button
                  type="button"
                  onClick={() => onUse(s)}
                  className="absolute top-2 right-2 rounded-kaya-sm px-2.5 py-1 text-[11px] font-extrabold text-white"
                  style={{ background: using ? '#2E7D34' : GOLD }}
                >
                  {using ? '✓ Using' : 'Use'}
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1.5">
            {['Shorter', 'Warmer', 'More specific', '🔄 Another 3'].map((r) => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => void write(r === '🔄 Another 3' ? 'different angle' : r)}
                className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                style={{ background: GOLD_SOFT, color: GOLD_DK }}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="text-[10.5px] text-kaya-sand">Using a draft puts it in the box above — edit it freely before you award.</p>
        </div>
      )}
    </div>
  );
}
