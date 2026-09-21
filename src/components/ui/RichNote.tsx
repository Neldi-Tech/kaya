'use client';

// 📝 RichNote — Kaya's prose box (Elia's standing rule: every prose field is
// a rich text box with an AI draft — never a bare <input>).
//
// A toolbar (B · I · • list · 1. list) + an AI button on the right, over a
// textarea. Formatting is stored as light, human-readable marks inside the
// plain string — **bold**, _italic_, "• " and "1. " line starts — so every
// existing consumer that treats notes as plain text (bells, emails, award
// cards) still reads naturally, and <RichNoteText> renders the marks where
// we control the surface. No HTML is ever stored or injected.
//
// `tone`: 'dark' for the chocolate meeting screens, 'light' for app pages.

import { useRef, type ReactNode } from 'react';

export interface RichNoteProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  tone?: 'dark' | 'light';
  /** Label of the AI button (e.g. "✨ Draft with AI", "✨ Help me say it"). */
  aiLabel?: string;
  onAi?: () => void;
  aiBusy?: boolean;
  aiDisabled?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function RichNote({
  value, onChange, placeholder, maxLength = 600, rows = 3, tone = 'light',
  aiLabel, onAi, aiBusy = false, aiDisabled = false, disabled = false, ariaLabel,
}: RichNoteProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const dark = tone === 'dark';

  const commit = (next: string, selStart: number, selEnd: number) => {
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(Math.min(selStart, maxLength), Math.min(selEnd, maxLength));
    });
  };

  // Wrap the selection in a mark (or drop an empty pair at the caret).
  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b);
    const already = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2;
    const inner = already ? sel.slice(mark.length, sel.length - mark.length) : sel;
    const out = already ? inner : `${mark}${inner}${mark}`;
    commit(value.slice(0, a) + out + value.slice(b), already ? a : a + mark.length, already ? a + inner.length : a + mark.length + inner.length);
  };

  // Turn the selected lines into a list (or back).
  const list = (kind: 'ul' | 'ol') => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const from = value.lastIndexOf('\n', Math.max(0, a - 1)) + 1;
    const toIdx = value.indexOf('\n', b);
    const to = toIdx === -1 ? value.length : toIdx;
    const lines = value.slice(from, to).split('\n');
    const isList = (l: string) => /^(•\s|\d+\.\s)/.test(l);
    const allListed = lines.every((l) => !l.trim() || isList(l));
    const out = lines.map((l, i) => {
      const bare = l.replace(/^(•\s|\d+\.\s)/, '');
      if (allListed) return bare;
      if (!bare.trim()) return bare;
      return kind === 'ul' ? `• ${bare}` : `${i + 1}. ${bare}`;
    }).join('\n');
    commit(value.slice(0, from) + out + value.slice(to), from, from + out.length);
  };

  const tbBtn = `w-7 h-7 rounded-md grid place-items-center text-[12px] transition-colors disabled:opacity-40 ${
    dark ? 'bg-white/10 hover:bg-white/20 text-white/85' : 'bg-white hover:bg-kaya-warm border border-kaya-warm-dark text-kaya-chocolate'
  }`;

  return (
    <div className={`rounded-xl overflow-hidden border-[1.5px] ${dark ? 'border-white/20 bg-white/[0.04]' : 'border-kaya-warm-dark bg-white'}`}>
      <div className={`flex items-center gap-1 px-2 py-1.5 border-b ${dark ? 'border-white/10' : 'border-kaya-warm-dark bg-kaya-cream/60'}`}>
        <button type="button" className={tbBtn} onClick={() => wrap('**')} disabled={disabled} aria-label="Bold" title="Bold"><b>B</b></button>
        <button type="button" className={tbBtn} onClick={() => wrap('_')} disabled={disabled} aria-label="Italic" title="Italic"><i>I</i></button>
        <button type="button" className={tbBtn} onClick={() => list('ul')} disabled={disabled} aria-label="Bulleted list" title="Bulleted list">•</button>
        <button type="button" className={tbBtn} onClick={() => list('ol')} disabled={disabled} aria-label="Numbered list" title="Numbered list">1.</button>
        {aiLabel && onAi && (
          <button
            type="button"
            onClick={onAi}
            disabled={disabled || aiBusy || aiDisabled}
            className={`ml-auto h-7 px-2.5 rounded-full text-[11px] font-black transition-colors disabled:opacity-50 ${
              dark ? 'bg-purple-500/30 hover:bg-purple-500/40 text-purple-100' : 'bg-[#EFE8FF] hover:bg-[#E3D8FF] text-[#5A3CB8]'
            }`}
          >
            {aiBusy ? '✨ Writing…' : aiLabel}
          </button>
        )}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        aria-label={ariaLabel || placeholder || 'Note'}
        className={`block w-full resize-y bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none ${
          dark ? 'text-white placeholder:text-white/35' : 'text-kaya-chocolate placeholder:text-kaya-sand'
        }`}
      />
    </div>
  );
}

// ── Display ──────────────────────────────────────────────────────────
// Renders the light marks as real formatting. Pure JSX — never innerHTML.

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith('**')
      ? <b key={`${keyBase}-b${i}`}>{tok.slice(2, -2)}</b>
      : <i key={`${keyBase}-i${i}`}>{tok.slice(1, -1)}</i>);
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichNoteText({ text, className = '' }: { text: string; className?: string }) {
  const lines = (text || '').split('\n');
  return (
    <span className={className}>
      {lines.map((l, i) => {
        const bullet = /^•\s/.test(l);
        const num = /^(\d+)\.\s/.exec(l);
        const body = bullet ? l.slice(2) : num ? l.slice(num[0].length) : l;
        return (
          <span key={i} className={bullet || num ? 'flex gap-1.5' : 'block'}>
            {bullet && <span aria-hidden>•</span>}
            {num && <span aria-hidden>{num[1]}.</span>}
            <span>{inline(body, `l${i}`)}</span>
          </span>
        );
      })}
    </span>
  );
}

/** The note with its marks stripped — for plain-text surfaces (bells, push). */
export function richNotePlain(text: string): string {
  return (text || '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/_([^_\n]+)_/g, '$1').trim();
}
