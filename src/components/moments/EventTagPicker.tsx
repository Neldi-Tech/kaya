// EventTagPicker — the "When / What" chip row, shared by the new- and
// edit-moment composers (2026-05-23).
//
// Smart behaviour:
//   • loads the family's tag usage and ranks chips frequency-first
//     (presets always shown; top custom tags surfaced, long tail hidden)
//   • lets you add a custom tag inline; it shows immediately + is saved
//     on post (the composer calls recordEventTagUse)
//   • always renders the current value as a selected chip, even if it's
//     a legacy custom that isn't in the ranked list
//
// A ✨ Claude suggestion chip reads the caption and proposes a tag —
// preferring an existing one, else a fresh {emoji,label} to accept.
'use client';

import { useEffect, useState } from 'react';
import {
  EventTag, listEventTagUsage, rankedEventTags, eventTagId,
  CUSTOM_TAG_EMOJI, CUSTOM_TAG_MAX_LEN,
} from '@/lib/moments';

export default function EventTagPicker({ familyId, value, onChange, disabled, caption }: {
  familyId: string;
  value: EventTag | undefined;
  onChange: (t: EventTag | undefined) => void;
  disabled?: boolean;
  /** Current caption — drives the ✨ Claude suggestion. */
  caption?: string;
}) {
  const [ranked, setRanked] = useState<EventTag[] | null>(null);
  // Customs typed this session — shown straight away, before the next load.
  const [extra, setExtra] = useState<EventTag[]>([]);
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  // ✨ AI suggestion — null until fetched; shown as a gold chip to accept.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<EventTag | null>(null);

  useEffect(() => {
    if (!familyId) { setRanked([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const usage = await listEventTagUsage(familyId);
        if (!cancelled) setRanked(rankedEventTags(usage));
      } catch {
        if (!cancelled) setRanked([]); // presets still get added below
      }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  // Build the chip list: current value first (so it's always visible),
  // then this-session customs, then the ranked tags — de-duped by id.
  const chips: EventTag[] = [];
  const seen = new Set<string>();
  const push = (t?: EventTag) => {
    if (!t) return;
    const key = t.id || `label:${t.label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(t);
  };
  push(value);
  extra.forEach(push);
  (ranked ?? []).forEach(push);

  const isSel = (t: EventTag) =>
    !!value && (value.id === t.id || value.label.toLowerCase() === t.label.toLowerCase());

  const commitCustom = () => {
    const label = customDraft.trim().replace(/\s+/g, ' ').slice(0, CUSTOM_TAG_MAX_LEN);
    if (!label) { setCustomEditing(false); return; }
    const tag: EventTag = {
      id: eventTagId({ id: 'custom', emoji: CUSTOM_TAG_EMOJI, label }),
      emoji: CUSTOM_TAG_EMOJI,
      label,
    };
    setExtra((prev) => [tag, ...prev.filter((t) => t.id !== tag.id)]);
    onChange(tag);
    setCustomDraft('');
    setCustomEditing(false);
  };

  const captionText = (caption || '').trim();

  const runSuggest = async () => {
    if (!captionText || suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch('/api/moments-tag-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: captionText, tags: chips.map((c) => ({ emoji: c.emoji, label: c.label })) }),
      });
      const data = await res.json();
      const s = data?.suggestion;
      if (s?.label) {
        // Reuse an existing chip if the label matches; else a fresh custom.
        const existing = chips.find((c) => c.label.toLowerCase() === String(s.label).toLowerCase());
        setSuggestion(existing ?? {
          id: eventTagId({ id: 'custom', emoji: s.emoji || CUSTOM_TAG_EMOJI, label: s.label }),
          emoji: s.emoji || CUSTOM_TAG_EMOJI,
          label: s.label,
        });
      }
    } catch { /* silent — picker still works without the suggestion */ }
    finally { setSuggesting(false); }
  };

  const acceptSuggestion = () => {
    if (!suggestion) return;
    const already = chips.some((c) => c.id === suggestion.id || c.label.toLowerCase() === suggestion.label.toLowerCase());
    if (!already) setExtra((prev) => [suggestion, ...prev]);
    onChange(suggestion);
    setSuggestion(null);
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {chips.map((t) => {
        const sel = isSel(t);
        return (
          <button
            key={t.id || t.label}
            type="button"
            onClick={() => onChange(sel ? undefined : t)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              sel ? 'bg-kaya-chocolate text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate'
            }`}
          >
            {t.emoji} {t.label}
          </button>
        );
      })}

      {/* ✨ Claude suggestion — only when there's a caption to read. */}
      {captionText && (
        suggestion ? (
          <span className="inline-flex items-center rounded-full border border-kaya-gold bg-[#FBF3DF] text-xs font-bold text-kaya-gold-dark">
            <button type="button" onClick={acceptSuggestion} disabled={disabled} className="px-3 py-1.5">
              ✨ {suggestion.emoji} {suggestion.label}
            </button>
            <button type="button" onClick={() => setSuggestion(null)} disabled={disabled} className="pr-2 pl-0.5 text-kaya-sand" aria-label="Dismiss suggestion">✕</button>
          </span>
        ) : (
          <button
            type="button"
            onClick={runSuggest}
            disabled={disabled || suggesting}
            className="px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-kaya-gold bg-[#FBF3DF] text-kaya-gold-dark hover:bg-[#F8ECCB] disabled:opacity-50 transition-colors"
          >
            {suggesting ? '✨ Thinking…' : '✨ Suggest a tag'}
          </button>
        )
      )}

      {customEditing ? (
        <div className="flex items-center gap-1 px-2 py-1 rounded-full border border-kaya-chocolate bg-white">
          <input
            autoFocus
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitCustom(); }
              if (e.key === 'Escape') { setCustomEditing(false); setCustomDraft(''); }
            }}
            maxLength={CUSTOM_TAG_MAX_LEN}
            placeholder="e.g. Sleepover"
            className="text-xs font-bold bg-transparent focus:outline-none w-28"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={commitCustom}
            disabled={disabled || !customDraft.trim()}
            className="text-kaya-chocolate font-bold disabled:opacity-30 px-1"
            aria-label="Add custom tag"
          >✓</button>
          <button
            type="button"
            onClick={() => { setCustomEditing(false); setCustomDraft(''); }}
            className="text-kaya-sand px-1"
            aria-label="Cancel"
          >✕</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCustomEditing(true)}
          disabled={disabled}
          className="px-3 py-1.5 rounded-full text-xs font-bold border border-dashed border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-chocolate hover:text-kaya-chocolate transition-colors"
        >
          + Custom
        </button>
      )}
    </div>
  );
}
