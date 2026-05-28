'use client';

// Kaya Sparks · rating sheet — single source for rating a sparks_item.
//
// Modes (per spec § 3 · Workplan Wiring → Parent rating):
//   stars   → ⭐ 1–5 only (quality / effort / creativity)
//   percent → 0–100 only (correctness / accuracy / logic)
//   both    → ⭐ + % (the default for Home Projects — quality AND logic)
//   custom  → labelled buckets (parent-defined; not exposed in Slice 3)
//
// Slice 3   shipped star + percent + notes via `createItemRating()`.
// Slice 7   added the lightbox + thumb strip on the photo.
// Slice 7b  (2026-05-28) — when reviewing a REVISION item, save ALSO
//           awards Kaya Points (via `giveAward()`) if the parent's
//           percent score qualifies per the family's RevisionSettings,
//           and flips `revision_data.points_awarded` so re-saves don't
//           double-fire.

import { useEffect, useId, useMemo, useState } from 'react';
import {
  createItemRating, subscribeToSparksProfile, todayYmd, updateSparksItem,
} from '@/lib/sparks/firestore';
import {
  DEFAULT_REVISION_SETTINGS, SPARKS_AREA_META, type SparksItem,
  type SparksProfile, type SparksRatingMode,
} from '@/lib/sparks/schema';
import { giveAward, type AwardKind } from '@/lib/firestore';
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
  /** Optional kid display name — used to label whose revision_settings
   *  the points suggestion is drawn from. Falls back to "this kid"
   *  when missing. */
  kidName?: string;
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
  familyId, item, parentUid, mode, kidName,
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
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [awardResult, setAwardResult] = useState<{ points: number; bonus: boolean } | null>(null);
  /** Slice 7e · explicit parent decision on whether to award points.
   *  Default OFF — parents must actively check the box to award even
   *  when the AI score qualifies. Holds the points by default. */
  const [awardPoints, setAwardPoints] = useState(false);
  /** Slice 7f · parent-editable override of the suggested points. We
   *  default to the tier suggestion; the parent can nudge within
   *  ±points_override_cap. Stored as a draft string so the field can
   *  be cleared while typing (mirrors the NumberKnob fix). */
  const [pointsDraft, setPointsDraft] = useState<string>('');

  const photos = item.photo_urls ?? [];
  const isRevision = item.area === 'revision' && !!item.revision_data;
  const alreadyAwarded = !!item.revision_data?.points_awarded;

  // Resolve effective revision settings for THIS kid. Loads the
  // kid's sparks_profile (revision_settings + subjects) on open when
  // the item is a revision — non-revision flows skip the read.
  useEffect(() => {
    if (!open || !isRevision) return;
    return subscribeToSparksProfile(familyId, item.kid_id, setProfile);
  }, [open, isRevision, familyId, item.kid_id]);

  const revisionSettings = useMemo(() => ({
    ...DEFAULT_REVISION_SETTINGS,
    ...(profile?.revision_settings ?? {}),
  }), [profile]);
  // True when this kid has no saved revision_settings — we're falling
  // back to DEFAULT_REVISION_SETTINGS. Surfaced to the parent so they
  // know to head to /sparks/setup if they want to tune the bar for
  // THIS kid specifically.
  const usingDefaults = !profile?.revision_settings || Object.keys(profile.revision_settings).length === 0;

  // Seed the percent slider with the AI score on revision items so the
  // parent's starting point is the AI's read — they nudge from there.
  // Default 80 for non-revision items (the existing UX). Re-seed when
  // the sheet opens or the item changes.
  useEffect(() => {
    if (!open) return;
    setStars(null);
    setPercent(
      showPercent
        ? (isRevision ? (item.revision_data?.ai_score ?? 80) : 80)
        : 0,
    );
    setNotes('');
    setSaving(false);
    setError(null);
    setAwardResult(null);
    setAwardPoints(false);
    setPointsDraft('');
  }, [open, showPercent, isRevision, item.revision_data?.ai_score]);

  // Whether the current rating would qualify for points + how many.
  // Only meaningful for revision items where points haven't been awarded.
  const wouldQualify = useMemo(() => {
    if (!isRevision || alreadyAwarded || !showPercent) return false;
    return percent >= revisionSettings.qualifying_score;
  }, [isRevision, alreadyAwarded, showPercent, percent, revisionSettings.qualifying_score]);

  const wouldBonus = useMemo(() =>
    wouldQualify && percent >= revisionSettings.bonus_threshold,
    [wouldQualify, percent, revisionSettings.bonus_threshold],
  );

  const suggestedPoints = wouldQualify
    ? (wouldBonus ? revisionSettings.bonus_points : revisionSettings.base_points)
    : 0;

  // Override range — parent can nudge ±cap around the suggestion. 0
  // disables editing (cap === 0 → field is read-only at the suggestion).
  // The parent-side policy `allow_points_override` is the master switch
  // (configured in /sparks/setup) — when OFF, the stepper never renders
  // and pendingPoints is forced to the suggestion exactly.
  const overrideAllowed = revisionSettings.allow_points_override !== false;
  const overrideCap = overrideAllowed ? Math.max(0, revisionSettings.points_override_cap | 0) : 0;
  const pointsMin = Math.max(0, suggestedPoints - overrideCap);
  const pointsMax = suggestedPoints + overrideCap;

  // Parse the draft → clamp to range. Empty / non-numeric falls back
  // to the suggestion so the rest of the UI has a stable number.
  const parsedDraft = pointsDraft.trim() === '' ? NaN : Number(pointsDraft);
  const pendingPoints = overrideAllowed && Number.isFinite(parsedDraft)
    ? Math.max(pointsMin, Math.min(pointsMax, Math.round(parsedDraft)))
    : suggestedPoints;

  // Seed the override draft to the suggestion every time the suggestion
  // changes (percent slider moves, bonus tier flips). Only when the
  // parent hasn't already toggled award ON — otherwise we'd overwrite
  // their in-progress edit.
  useEffect(() => {
    if (!awardPoints) setPointsDraft(String(suggestedPoints));
  }, [awardPoints, suggestedPoints]);

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

      // Revision-only follow-up: if the parent's percent qualifies +
      // points haven't been awarded yet, give the kid points + flip
      // the points_awarded gate on the item. The award fires under
      // the parent's auth (RatingSheet is parent-only), so it goes
      // through the standard awards rule. Failures degrade gracefully —
      // the rating still saved; the parent can re-try with a higher %.
      if (awardPoints && wouldQualify && !alreadyAwarded) {
        try {
          const reason = wouldBonus
            ? `Bonus revision — ${item.revision_data?.subject ?? 'subject'} · ${percent}%`
            : `Revision — ${item.revision_data?.subject ?? 'subject'} · ${percent}%`;
          const kind: AwardKind = 'regular';
          await giveAward(familyId, {
            childId: item.kid_id,
            kind,
            points: pendingPoints,
            reason,
            category: 'sparks-revision',
            awardedBy: parentUid,
            // Parent name unknown in this context — the awards UI shows
            // 'awardedByName' fallback "Parent" when missing. Future:
            // pass parentName as a prop from RevisionsPage.
            awardedByName: 'Parent',
            senderRole: 'parent',
          });
          await updateSparksItem(familyId, item.id, {
            revision_data: {
              ...(item.revision_data ?? {}),
              points_awarded: true,
            },
          });
          setAwardResult({ points: pendingPoints, bonus: wouldBonus });
        } catch (awardErr) {
          // Don't fail the whole save — the rating landed. Surface a
          // soft error so the parent knows the award didn't fire.
          setError(
            awardErr instanceof Error
              ? `Rating saved · award failed: ${awardErr.message}`
              : 'Rating saved · award failed. Try the Kaya awards screen.',
          );
          setSaving(false);
          return;
        }
      }

      onSaved?.();
      // When the parent actually awarded points (toggle ON + qualifying
      // + not already awarded), keep the sheet open with the success
      // state so they see the award confirmation. Otherwise close.
      if (awardPoints && wouldQualify && !alreadyAwarded) {
        setSaving(false);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rating. Try again?');
    } finally {
      // Guard against double-set when we kept the sheet open above.
      setSaving((cur) => (cur ? false : cur));
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
        className="relative w-full sm:max-w-xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
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

          {/* Revision points-award control (Slice 7e + 7f). Parents
              tick to release the award AND can nudge the suggested
              points within ±override_cap (Slice 7f). Defaults to OFF
              so qualifying revisions DO NOT auto-award. */}
          {isRevision && !alreadyAwarded && !awardResult && (
            <div
              className={`rounded-xl px-3.5 py-3 text-[12.5px] border-2 transition-colors ${
                awardPoints
                  ? wouldBonus
                    ? 'bg-[#FFF1C9] border-[#D4A847]'
                    : 'bg-[#E5D6FF] border-[#5A3CB8]'
                  : 'bg-[#FBF7EE] border-[#ECE4D3] hover:border-[#5A3CB8]/40'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={awardPoints}
                  onChange={(e) => setAwardPoints(e.target.checked)}
                  disabled={!wouldQualify}
                  className="w-5 h-5 mt-0.5 shrink-0 disabled:opacity-40"
                />
                <div className="flex-1">
                  <div className="font-extrabold text-[#0F1F44]">
                    {wouldQualify
                      ? <>🎯 Award <span style={{ color: wouldBonus ? '#8A6800' : '#5A3CB8' }}>+{pendingPoints}</span> Kaya Points{wouldBonus ? ' · bonus tier' : ''}</>
                      : `🎯 Award Kaya Points (needs ≥ ${revisionSettings.qualifying_score}%)`}
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-0.5 leading-snug">
                    {awardPoints
                      ? `Award fires on save · once per revision. Suggestion is ${suggestedPoints}${overrideAllowed && overrideCap > 0 ? ` (use the ± stepper below to adjust within ±${overrideCap})` : ' · locked by setup'}.`
                      : wouldQualify
                        ? `Off by default — tick to release the award now. Suggestion is ${suggestedPoints}${overrideAllowed && overrideCap > 0 ? `; adjust ±${overrideCap} below` : ' · locked by setup'}. Leave unticked to hold.`
                        : `Bump the score above ${revisionSettings.qualifying_score}% to enable.`}
                    {wouldQualify && (
                      <span className="block mt-1">
                        {usingDefaults ? (
                          <>📋 Using <strong>defaults</strong> — {kidName ?? 'this kid'} has no saved settings. <a href="/sparks/setup" className="underline text-[#5A3CB8] font-bold">Configure →</a></>
                        ) : (
                          <>✓ From <strong>{kidName ?? 'this kid'}&apos;s</strong> saved settings.</>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </label>

              {/* Override toggle + stepper — only visible once award is
                  ticked AND the parent can actually nudge (cap > 0). The
                  toggle is OFF by default so the suggestion ships as-is;
                  parents who want to adjust opt in explicitly. Cap = 0
                  locks the suggestion exactly. */}
              {awardPoints && wouldQualify && overrideAllowed && overrideCap > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-[#0F1F44]/10 flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">Override</span>
                  <button
                    type="button"
                    onClick={() => setPointsDraft(String(Math.max(pointsMin, pendingPoints - 1)))}
                    disabled={pendingPoints <= pointsMin}
                    className="w-7 h-7 rounded-full bg-white border border-[#0F1F44]/15 text-[#0F1F44] font-extrabold text-[14px] grid place-items-center disabled:opacity-30"
                    aria-label="Decrease points"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={pointsMin}
                    max={pointsMax}
                    step={1}
                    value={pointsDraft}
                    onChange={(e) => setPointsDraft(e.target.value)}
                    onBlur={() => {
                      if (pointsDraft.trim() === '') { setPointsDraft(String(suggestedPoints)); return; }
                      const n = Number(pointsDraft);
                      if (!Number.isFinite(n)) { setPointsDraft(String(suggestedPoints)); return; }
                      setPointsDraft(String(Math.max(pointsMin, Math.min(pointsMax, Math.round(n)))));
                    }}
                    className="w-16 bg-white border border-[#0F1F44]/15 rounded-lg px-2 py-1 text-center text-[14px] font-extrabold text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8]"
                  />
                  <button
                    type="button"
                    onClick={() => setPointsDraft(String(Math.min(pointsMax, pendingPoints + 1)))}
                    disabled={pendingPoints >= pointsMax}
                    className="w-7 h-7 rounded-full bg-white border border-[#0F1F44]/15 text-[#0F1F44] font-extrabold text-[14px] grid place-items-center disabled:opacity-30"
                    aria-label="Increase points"
                  >
                    +
                  </button>
                  <span className="text-[10.5px] text-[#5A6488] ml-1">
                    {pointsMin}–{pointsMax}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Already awarded — show a static badge so the parent knows
              points landed earlier (or via auto-award on submit). */}
          {isRevision && alreadyAwarded && !awardResult && (
            <div className="rounded-xl px-3.5 py-2.5 text-[12.5px] bg-[#DDF5DF] border border-[#2E7D34]/30 text-[#2E7D34] font-bold">
              ✓ Kaya Points already awarded for this revision
            </div>
          )}

          {/* Success state — sheet stays open after a qualifying save
              so the parent sees the award confirmation before closing. */}
          {awardResult && (
            <div
              className="rounded-xl px-4 py-4 text-center"
              style={{ background: 'linear-gradient(135deg, #FFF4D6, #FFE8E5)' }}
            >
              <div className="text-3xl mb-1" aria-hidden>🎉</div>
              <div className="font-display font-extrabold text-[16px] text-[#0F1F44]">
                +{awardResult.points} Kaya Points awarded
              </div>
              {awardResult.bonus && (
                <div className="text-[12px] font-bold text-[#5A3CB8] mt-1">
                  Bonus tier · {revisionSettings.bonus_threshold}%+ revision ⭐
                </div>
              )}
              <div className="text-[11.5px] text-[#5A6488] mt-1.5">
                The kid&apos;s running total updated. House standings follow next sync.
              </div>
            </div>
          )}

          {error && (
            <div className="bg-[#FFE7E0] border border-[#E85C5C]/40 text-[#A33A2A] rounded-xl px-3.5 py-2.5 text-[12.5px]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {!awardResult && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE]"
              >
                Cancel
              </button>
            )}
            {awardResult ? (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold"
                style={{ background: '#D4A847', color: '#0F1F44' }}
              >
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={onSave}
                disabled={!canSave}
                className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40"
                style={{ background: '#D4A847', color: '#0F1F44' }}
              >
                {saving
                  ? 'Saving…'
                  : isRevision && awardPoints && wouldQualify && !alreadyAwarded
                  ? `Save · +${pendingPoints} pts`
                  : 'Save rating'}
              </button>
            )}
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
