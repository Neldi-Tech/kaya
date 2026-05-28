'use client';

// Kaya Sparks · rating sheet — single source for rating a sparks_item.
//
// Modes (per spec § 3 · Workplan Wiring → Parent rating):
//   stars   → ⭐ 1–5 only (quality / effort / creativity)
//   percent → 0–100 only (correctness / accuracy / logic)
//   both    → ⭐ + % (the default for Home Projects — quality AND logic)
//   custom  → labelled buckets (parent-defined; not exposed in Slice 3)
//
// Slice 3 (2026-05-27) wires star + percent + notes via
// `createItemRating()`. Custom mode lands when the per-task method
// picker arrives in Slice 3b.

import { useEffect, useId, useState } from 'react';
import {
  createItemRating, todayYmd,
} from '@/lib/sparks/firestore';
import {
  SPARKS_AREA_META, type SparksItem, type SparksRatingMode,
} from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import PhotoLightbox from './PhotoLightbox';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  familyId: string;
  item: SparksItem;
  parentUid: string;
  /** Defaults: home_project + school_project → 'both'; achievement +
   *  sports_subscription → 'stars'. Caller can override per area. */
  mode?: SparksRatingMode;
}

const AREA_HEAD_GRADIENT: Record<SparksItem['area'], string> = {
  school_project:      'linear-gradient(135deg, #FF6B6B 0%, #FF8E72 100%)',
  home_project:        'linear-gradient(135deg, #FFB627 0%, #FFD93D 100%)',
  achievement:         'linear-gradient(135deg, #6BCB77 0%, #9DE0A6 100%)',
  sports_subscription: 'linear-gradient(135deg, #4ECDC4 0%, #6FE5DC 100%)',
  revision:            'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)',
};
const AREA_HEAD_FG: Record<SparksItem['area'], string> = {
  school_project: '#fff', home_project: '#0F1F44', achievement: '#fff',
  sports_subscription: '#fff', revision: '#fff',
};
const AREA_DEFAULT_MODE: Record<SparksItem['area'], SparksRatingMode> = {
  school_project:      'both',
  home_project:        'both',
  achievement:         'stars',
  sports_subscription: 'stars',
  revision:            'both', // Revisions get ⭐ + % when the parent reviews
};

export default function RatingSheet({
  open, onClose, onSaved,
  familyId, item, parentUid, mode,
}: Props) {
  const meta = SPARKS_AREA_META[item.area];
  const formId = useId();
  const effectiveMode: SparksRatingMode = mode ?? AREA_DEFAULT_MODE[item.area];
  const showStars   = effectiveMode === 'stars'   || effectiveMode === 'both';
  const showPercent = effectiveMode === 'percent' || effectiveMode === 'both';

  const [stars, setStars] = useState<number | null>(null);
  const [percent, setPercent] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const photos = item.photo_urls ?? [];

  useEffect(() => {
    if (!open) return;
    setStars(null);
    setPercent(showPercent ? 80 : 0);
    setNotes('');
    setSaving(false);
    setError(null);
  }, [open, showPercent]);

  const canSave =
    !saving
    && (
      (showStars && stars !== null)
      || (showPercent && percent >= 0)
    );

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await createItemRating(
        familyId,
        {
          kid_id: item.kid_id,
          item_id: item.id,
          date: item.date || todayYmd(),
          stars: showStars && stars !== null ? stars : undefined,
          percent: showPercent ? percent : undefined,
          notes: notes.trim() || undefined,
        },
        parentUid,
      );
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rating. Try again?');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-labelledby={`${formId}-title`}
        className="relative w-full sm:max-w-md max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
      >
        {/* Coloured head — matches the area's detail-head gradient */}
        <div
          className="px-5 pt-5 pb-4"
          style={{ background: AREA_HEAD_GRADIENT[item.area], color: AREA_HEAD_FG[item.area] }}
        >
          <div className="text-[12px] opacity-85">
            {meta.label} · {toDisplayDate(item.date)}
          </div>
          <h2 id={`${formId}-title`} className="font-display font-extrabold text-[19px] m-0 mt-0.5 truncate">
            Rate · {item.title}
          </h2>
        </div>

        <div className="p-5 space-y-5">
          {photos.length > 0 && (
            <div className="rounded-2xl overflow-hidden bg-[#FBF7EE] border border-[#ECE4D3] relative">
              <button
                type="button"
                onClick={() => setLightboxIndex(0)}
                className="block w-full p-0 border-0 cursor-zoom-in bg-transparent"
                aria-label="Open photo full screen"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photos[0]}
                  alt={item.title}
                  className="w-full max-h-72 lg:max-h-96 object-contain"
                />
              </button>
              {/* Thumb strip for multi-photo items — tap to switch lightbox start. */}
              {photos.length > 1 && (
                <div className="bg-white/95 border-t border-[#ECE4D3] px-2 py-2 flex items-center gap-1.5 overflow-x-auto">
                  {photos.map((url, idx) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setLightboxIndex(idx)}
                      className="shrink-0 w-12 h-12 rounded-md overflow-hidden border border-[#ECE4D3] hover:border-[#D4A847] cursor-zoom-in p-0 bg-transparent"
                      aria-label={`Open photo ${idx + 1} full screen`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`${item.title} photo ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {/* Hint chip */}
              <span className="absolute top-2 right-2 bg-[rgba(15,31,68,0.85)] text-white text-[10px] font-bold px-2 py-1 rounded-md pointer-events-none">
                🔍 Tap for full size
              </span>
            </div>
          )}

          {/* ⭐ Quality */}
          {showStars && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-2">
                Quality <span className="text-[#5A6488] font-normal normal-case">· effort, creativity</span>
              </label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = stars !== null && n <= stars;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStars(n === stars ? null : n)}
                      aria-label={`${n} star${n === 1 ? '' : 's'}`}
                      className="text-3xl leading-none transition-transform hover:scale-110 active:scale-95"
                      style={{ filter: active ? 'none' : 'grayscale(1) opacity(0.3)' }}
                    >
                      ⭐
                    </button>
                  );
                })}
                {stars !== null && (
                  <span className="text-[12px] font-extrabold text-[#8A6800] bg-[#FFF1C9] rounded-full px-2.5 py-1 ml-2">
                    {stars}.0
                  </span>
                )}
              </div>
            </div>
          )}

          {/* % Logic */}
          {showPercent && (
            <div>
              <label htmlFor={`${formId}-pct`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-2 flex items-center justify-between">
                <span>Logic / correctness <span className="font-normal normal-case">· accuracy</span></span>
                <span
                  className="text-[12px] font-extrabold rounded-full px-2.5 py-0.5"
                  style={{ background: '#E5D6FF', color: '#5A3CB8' }}
                >
                  {percent}%
                </span>
              </label>
              <input
                id={`${formId}-pct`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="w-full accent-[#5A3CB8]"
              />
              {/* Coral → green gradient bar mirrors the mockup's progress fill. */}
              <div className="h-1.5 rounded-full overflow-hidden mt-1 bg-[#FBF7EE]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${percent}%`,
                    background: 'linear-gradient(90deg, #FF6B6B, #6BCB77)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor={`${formId}-notes`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Notes <span className="text-[#5A6488] font-normal normal-case">· optional</span>
            </label>
            <textarea
              id={`${formId}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you love? What could grow?"
              rows={3}
              maxLength={500}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847] resize-none"
            />
          </div>

          {error && (
            <div className="bg-[#FFE7E0] border border-[#E85C5C]/40 text-[#A33A2A] rounded-xl px-3.5 py-2.5 text-[12.5px]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              {saving ? 'Saving…' : 'Save rating'}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox — parent taps the photo (or a thumb on multi-photo
          items) to view full screen while the rating sheet stays
          mounted underneath. */}
      {lightboxIndex !== null && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          caption={item.title}
          subCaption={toDisplayDate(item.date)}
        />
      )}
    </div>
  );
}
