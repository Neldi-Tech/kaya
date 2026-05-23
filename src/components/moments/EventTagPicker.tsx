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
// A ✨ Claude suggestion chip is layered on in a follow-up; this file is
// the single place it'll live.
'use client';

import { useEffect, useState } from 'react';
import {
  EventTag, listEventTagUsage, rankedEventTags, eventTagId,
  CUSTOM_TAG_EMOJI, CUSTOM_TAG_MAX_LEN,
} from '@/lib/moments';

export default function EventTagPicker({ familyId, value, onChange, disabled }: {
  familyId: string;
  value: EventTag | undefined;
  onChange: (t: EventTag | undefined) => void;
  disabled?: boolean;
}) {
  const [ranked, setRanked] = useState<EventTag[] | null>(null);
  // Customs typed this session — shown straight away, before the next load.
  const [extra, setExtra] = useState<EventTag[]>([]);
  const [customEditing, setCustomEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

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
