'use client';

// Kaya Sparks · capture sheet — single source for adding a sparks_items
// entry to any of the 4 capture areas (school projects · home projects ·
// achievements · sports subscriptions). Academic records have their own
// surface (per-term grades), so they don't route through here.
//
// UX:
//   • Photo picker (single photo for v1; multi-photo lands later)
//   • Title (required)
//   • Description (optional)
//   • Date (defaults to today)
//   • Subject dropdown (only for school_project; sourced from
//     sparks_profiles.subjects via prop)
//   • Save → reserve a sparks_items docId, upload photo, write doc.
//     Surface inline errors; never lose the user's typed input on
//     failure.

import { useEffect, useId, useRef, useState } from 'react';
import { collection, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  createSparksItem, todayYmd,
} from '@/lib/sparks/firestore';
import {
  uploadSparksPhoto, type SparksPhotoUrls,
} from '@/lib/sparks/uploadPhoto';
import {
  SPARKS_AREA_META, type SparksItemArea, type SparksProfile,
} from '@/lib/sparks/schema';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (itemId: string) => void;
  familyId: string;
  kidId: string;
  kidName: string;
  area: SparksItemArea;
  /** Pulled from the kid's sparks_profile (Slice 2 fetches this in the
   *  parent area page). Optional — when missing, the subject input is
   *  hidden for school_project and the user can save without it. */
  profile?: SparksProfile | null;
  /** Authoring uid — typically the parent / kid / helper saving the item. */
  uid: string;
}

const AREA_HEAD_GRADIENT: Record<SparksItemArea, string> = {
  school_project:      'linear-gradient(135deg, #FF6B6B 0%, #FF8E72 100%)', // head-coral
  home_project:        'linear-gradient(135deg, #FFB627 0%, #FFD93D 100%)', // head-yellow
  achievement:         'linear-gradient(135deg, #6BCB77 0%, #9DE0A6 100%)', // head-green
  sports_subscription: 'linear-gradient(135deg, #4ECDC4 0%, #6FE5DC 100%)', // head-mint
};

const AREA_HEAD_TEXT: Record<SparksItemArea, string> = {
  school_project: '#fff',
  home_project:   '#0F1F44', // yellow head reads better with navy text
  achievement:    '#fff',
  sports_subscription: '#fff',
};

export default function CaptureSheet({
  open, onClose, onSaved,
  familyId, kidId, kidName, area, profile, uid,
}: Props) {
  const meta = SPARKS_AREA_META[area];
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [subject, setSubject] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open/close so a previous draft doesn't leak into the next session.
  useEffect(() => {
    if (!open) return;
    setPhoto(null);
    setPreviewUrl(null);
    setTitle('');
    setDescription('');
    setDate(todayYmd());
    setSubject('');
    setSaving(false);
    setError(null);
  }, [open]);

  // Manage the object-URL lifecycle so we don't leak blobs.
  useEffect(() => {
    if (!photo) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const onPickPhoto: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) setPhoto(f);
  };

  const showSubject = area === 'school_project' && (profile?.subjects?.length ?? 0) > 0;

  const canSave = !!title.trim() && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Reserve the itemId client-side so the photo write + the
      // Firestore write share the same path (orphan storage blobs only
      // happen if the final setDoc fails — rare).
      const reservedRef = doc(collection(db, 'families', familyId, 'sparks_items'));
      const itemId = reservedRef.id;

      let urls: SparksPhotoUrls | null = null;
      if (photo) {
        urls = await uploadSparksPhoto(familyId, itemId, photo);
      }

      // Use createSparksItem so timestamps + audit fields are stamped
      // consistently with non-photo writes. NB: this calls `addDoc`
      // which generates ITS OWN id — we discard the reserved one when
      // there's no photo. With a photo, we re-route to setDoc with the
      // reserved id so the storage path matches.
      let finalItemId: string;
      if (urls) {
        // Write the doc using the reserved id so storage path lines up.
        await import('firebase/firestore').then(({ setDoc, serverTimestamp }) =>
          setDoc(reservedRef, {
            kid_id: kidId,
            area,
            title: title.trim(),
            description: description.trim() || undefined,
            photo_urls: [urls!.feedUrl],
            date,
            subject: showSubject && subject ? subject : undefined,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            created_by: uid,
          }),
        );
        finalItemId = itemId;
      } else {
        finalItemId = await createSparksItem(
          familyId,
          {
            kid_id: kidId,
            area,
            title: title.trim(),
            description: description.trim() || undefined,
            photo_urls: [],
            date,
            subject: showSubject && subject ? subject : undefined,
          },
          uid,
        );
      }
      onSaved?.(finalItemId);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong while saving. Try again?';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-labelledby={`${formId}-title`}
        className="relative w-full sm:max-w-md max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
      >
        {/* Coloured head — matches the area's detail-head gradient. */}
        <div
          className="px-5 pt-5 pb-4"
          style={{ background: AREA_HEAD_GRADIENT[area], color: AREA_HEAD_TEXT[area] }}
        >
          <div className="text-[12px] opacity-85">
            {kidName} · {meta.label}
          </div>
          <h2 id={`${formId}-title`} className="font-display font-extrabold text-[20px] m-0 mt-0.5">
            Add a {meta.shortLabel.toLowerCase()}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Photo picker */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Photo
            </label>
            {previewUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-[#ECE4D3] bg-[#FBF7EE]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Selected" className="w-full max-h-64 object-contain" />
                <button
                  type="button"
                  onClick={() => { setPhoto(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="absolute top-2 right-2 bg-white/95 text-[#0F1F44] text-[11px] font-bold rounded-full px-2.5 py-1 shadow"
                >
                  Replace
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] rounded-2xl py-8 text-center hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors"
              >
                <div className="text-3xl mb-1" aria-hidden>📷</div>
                <div className="text-[13px] font-bold text-[#0F1F44]">Tap to add a photo</div>
                <div className="text-[11px] text-[#5A6488] mt-0.5">JPG / PNG · up to 25 MB · resized automatically</div>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="hidden"
            />
          </div>

          {/* Title */}
          <div>
            <label htmlFor={`${formId}-title-input`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Title <span className="text-[#E85C5C]">·</span> required
            </label>
            <input
              id={`${formId}-title-input`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                area === 'school_project'      ? 'Africa map · Geography'
                : area === 'home_project'      ? 'Paper plane v3'
                : area === 'achievement'       ? 'Best in Mathematics'
                : 'Football Academy'
              }
              maxLength={120}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847]"
            />
          </div>

          {/* Subject (school_project only, when subjects exist) */}
          {showSubject && (
            <div>
              <label htmlFor={`${formId}-subject`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
                Subject
              </label>
              <select
                id={`${formId}-subject`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847]"
              >
                <option value="">— pick a subject (optional) —</option>
                {(profile?.subjects ?? []).map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div>
            <label htmlFor={`${formId}-date`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Date
            </label>
            <input
              id={`${formId}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayYmd()}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847]"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor={`${formId}-desc`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Description
            </label>
            <textarea
              id={`${formId}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`What's this about? (optional)`}
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

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
