'use client';

// Kaya Sparks · Materials → parent rating sheet (⭐1–5 + feedback note).
//
// A material the kid reads (a scanned page, a PDF, a link) can be rated +
// commented on by a parent — just like a Sparks Project. Deliberately
// simpler than RatingSheet (no percent / revision-points machinery): a
// star row + a note, written via rateMaterial(). Parent-only; the kid sees
// the result read-only on the material card.

import { useEffect, useId, useState } from 'react';
import { rateMaterial } from '@/lib/sparks/materialsFirestore';
import { materialIcon, subjectMeta, type SparksMaterial } from '@/lib/sparks/materials';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  familyId: string;
  material: SparksMaterial | null;
  raterUid: string;
  raterName: string;
}

export default function MaterialRatingSheet({
  open, onClose, onSaved, familyId, material, raterUid, raterName,
}: Props) {
  const formId = useId();
  const [stars, setStars] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from any existing rating when the sheet opens (lets a parent
  // adjust an earlier rating rather than start blank).
  useEffect(() => {
    if (!open) return;
    setStars(material?.rating?.stars ?? null);
    setNote(material?.rating?.note ?? '');
    setSaving(false);
    setError(null);
  }, [open, material?.id, material?.rating?.stars, material?.rating?.note]);

  if (!open || !material) return null;

  const meta = subjectMeta(material.subject);

  const onSave = async () => {
    if (stars === null) { setError('Pick a star rating'); return; }
    setSaving(true); setError(null);
    try {
      await rateMaterial(familyId, material.id, {
        stars, note, by: raterUid, byName: raterName || 'Parent',
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rating. Try again?');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-labelledby={`${formId}-title`}
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
      >
        {/* Head — purple Sparks register */}
        <div className="px-5 pt-5 pb-4" style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)', color: '#fff' }}>
          <div className="text-[12px] opacity-85 flex items-center gap-1.5">
            <span>{materialIcon(material)}</span>
            <span>{meta.emoji} {material.subject}</span>
          </div>
          <h2 id={`${formId}-title`} className="font-display font-extrabold text-[19px] m-0 mt-0.5 truncate">
            Rate · {material.title}
          </h2>
        </div>

        <div className="p-5 space-y-5">
          {/* ⭐ Stars */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-2">
              How is it? <span className="font-normal normal-case">· quality &amp; effort</span>
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

          {/* Feedback note */}
          <div>
            <label htmlFor={`${formId}-note`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Feedback <span className="text-[#5A6488] font-normal normal-case">· the kid reads this</span>
            </label>
            <textarea
              id={`${formId}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you love? What could grow?"
              rows={3}
              maxLength={500}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] resize-none"
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
              disabled={saving || stars === null}
              className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              {saving ? 'Saving…' : material.rating ? 'Update rating' : 'Save rating'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
