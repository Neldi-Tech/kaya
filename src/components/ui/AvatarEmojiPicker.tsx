'use client';

// ── Avatar Emoji Picker (approved design, 2026-07-20) ───────────────────
// The ONE shared picker for choosing a member's avatar emoji — used by
// Settings (edit any kid), the Add-child page, and the House picker's
// custom builder. 8 categories · 144 curated choices, plus a "type your
// own" box that accepts ANY emoji — effectively unlimited.
//
// Controlled component: { value, onChange }. `AvatarEmojiPickerModal`
// wraps it in a dialog for tap-to-edit flows (Settings kid rows).

import { useState } from 'react';
import { AVATAR_EMOJI_CATEGORIES } from '@/lib/avatarEmojis';

export default function AvatarEmojiPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (emoji: string) => void;
  /** Tighter paddings for embedding inside an existing form. */
  compact?: boolean;
}) {
  const [cat, setCat] = useState(0);
  const [own, setOwn] = useState('');

  const useOwn = () => {
    const v = own.trim();
    if (v) { onChange(v); setOwn(''); }
  };

  return (
    <div className={compact ? '' : 'space-y-1'}>
      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {AVATAR_EMOJI_CATEGORIES.map((c, i) => (
          <button
            type="button"
            key={c.key}
            onClick={() => setCat(i)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 font-display font-extrabold text-[11px] border-2 transition-colors ${
              i === cat
                ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate'
                : 'bg-white text-kaya-chocolate border-kaya-warm-dark hover:bg-kaya-warm'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className={`grid grid-cols-6 ${compact ? 'gap-1' : 'gap-1.5'} mt-2`}>
        {AVATAR_EMOJI_CATEGORIES[cat].emojis.map((em) => (
          <button
            type="button"
            key={em}
            onClick={() => onChange(em)}
            aria-label={`Choose ${em}`}
            aria-pressed={value === em}
            className={`aspect-square grid place-items-center rounded-xl border-2 transition-all hover:scale-105 ${
              compact ? 'text-lg' : 'text-2xl'
            } ${
              value === em
                ? 'bg-kaya-gold/15 border-kaya-gold shadow-sm'
                : 'bg-white border-kaya-warm-dark hover:border-kaya-gold/60'
            }`}
          >
            {em}
          </button>
        ))}
      </div>

      {/* Type your own — any emoji works */}
      <div className="mt-2.5 rounded-xl border-2 border-dashed border-kaya-gold/60 bg-white p-2.5">
        <p className="font-display font-extrabold text-[10.5px] uppercase tracking-wider text-kaya-gold-dark">
          ⌨️ Or type your own — any emoji works
        </p>
        <div className="flex gap-2 mt-1.5">
          <input
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useOwn(); } }}
            placeholder="🦖"
            maxLength={8}
            className="flex-1 h-10 text-center text-xl bg-kaya-cream border border-kaya-warm-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
          <button
            type="button"
            onClick={useOwn}
            disabled={!own.trim()}
            className="h-10 px-4 rounded-lg bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-[12px] disabled:opacity-40"
          >
            Use it
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dialog wrapper — tap-to-edit flows (e.g. Settings kid rows). */
export function AvatarEmojiPickerModal({
  title,
  value,
  onSave,
  onClose,
  saving = false,
}: {
  title: string;
  value: string;
  onSave: (emoji: string) => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const [picked, setPicked] = useState(value);
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-kaya-chocolate/50 p-0 lg:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-kaya-cream rounded-t-3xl lg:rounded-3xl p-5 pb-7 max-h-[88vh] overflow-y-auto">
        <div className="w-11 h-1.5 rounded-full bg-kaya-warm-dark mx-auto mb-3 lg:hidden" />
        <div className="flex items-center gap-3 mb-3">
          <span className="w-12 h-12 rounded-2xl grid place-items-center text-3xl" style={{ background: 'linear-gradient(150deg,#FFF7E2,#FDEFC9)' }}>
            {picked || '🙂'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-black text-[15px] text-kaya-chocolate truncate">{title}</p>
            <p className="text-[11px] text-kaya-sand">This shows next to their name everywhere in Kaya.</p>
          </div>
        </div>
        <AvatarEmojiPicker value={picked} onChange={setPicked} compact />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-4 rounded-kaya bg-white border-2 border-kaya-warm-dark text-kaya-chocolate font-display font-extrabold text-[12.5px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(picked)}
            disabled={saving || !picked.trim()}
            className="flex-1 h-11 rounded-kaya bg-kaya-chocolate text-kaya-gold-light font-display font-extrabold text-[13px] disabled:opacity-50"
          >
            {saving ? 'Saving…' : '💾 Save avatar'}
          </button>
        </div>
      </div>
    </div>
  );
}
