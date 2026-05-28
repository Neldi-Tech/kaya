'use client';

// Kaya Sparks · capture sheet — single source for adding a sparks_items
// entry to any of the 4 capture areas (school projects · home projects ·
// achievements · sports subscriptions). Academic records have their own
// surface (per-term grades), so they don't route through here.
//
// UX (refreshed 2026-05-28 — Scan + auto-describe):
//   • Three input tiles — 📄 Scan · 📷 Photo · 📁 Upload. Scan + Photo
//     open the in-app CameraCaptureSheet (auto-enhance + multi-page
//     for scan, single shot for photo). Upload opens the gallery.
//   • Scan auto-fires AI extract on the first page and seeds:
//       - title       (only when empty — never overwrites kid input)
//       - description (only when empty)
//       - subject     (school_project only, when it matches a profile subject)
//       - date        (achievement only, when a date is read off the certificate)
//     Auto-filled fields get a "✨ AI" badge. If the kid edits the
//     value, a "Restore AI suggestion" link appears so they can flip
//     back. Edits always win — Save uses whatever's in the field.
//   • Manual "✨ Help me describe" still available for Photo / Upload
//     flows, and a manual Scan-this-cert button stays on achievement.
//   • Save → reserve a sparks_items docId, upload all photos in
//     parallel, write doc with the array of feedUrls.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { collection, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  createSparksItem, todayYmd,
} from '@/lib/sparks/firestore';
import {
  uploadSparksPhotos, type SparksPhotoUrls,
} from '@/lib/sparks/uploadPhoto';
import {
  SPARKS_AREA_META, type SparksItemArea, type SparksProfile,
} from '@/lib/sparks/schema';
import { describeItem, extractFromImage } from '@/lib/sparks/ai';
import { toDisplayDate } from '@/lib/dates';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';

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
  // Revision uses its own dedicated RevisionFlow sheet; this entry
  // exists so the generic CaptureSheet stays type-safe over all
  // SparksItemArea values.
  revision:            'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)',
};

const AREA_HEAD_TEXT: Record<SparksItemArea, string> = {
  school_project: '#fff',
  home_project:   '#0F1F44', // yellow head reads better with navy text
  achievement:    '#fff',
  sports_subscription: '#fff',
  revision:       '#fff',
};

// Local fallback description template — used when the AI route returns
// `skipped` (no ANTHROPIC_API_KEY) or when there's no photo to scan.
// Slice 4 wires real Claude Sonnet vision via /api/sparks/ai/describe;
// this template is just the safety net.
function draftDescription(args: {
  area: SparksItemArea;
  title: string;
  subject?: string;
  date: string;
  kidName: string;
  photoCount: number;
}): string {
  const { area, title, subject, date, kidName, photoCount } = args;
  const niceDate = toDisplayDate(date);
  const photos = photoCount === 0 ? '' : photoCount === 1 ? '1 photo · ' : `${photoCount} photos · `;
  const base =
    area === 'school_project'      ? `${kidName}'s ${subject ? subject + ' project — ' : ''}${title}`
    : area === 'home_project'      ? `${kidName} made ${title} at home`
    : area === 'achievement'       ? `${kidName} earned: ${title}`
    : `${kidName} signed up for ${title}`;
  return `${photos}${base}. Captured ${niceDate}.`;
}

export default function CaptureSheet({
  open, onClose, onSaved,
  familyId, kidId, kidName, area, profile, uid,
}: Props) {
  const meta = SPARKS_AREA_META[area];
  const formId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [subject, setSubject] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descTouched, setDescTouched] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null); // small "AI is off" / "from template" hint
  // Active in-app camera mode — null means closed.
  const [cameraMode, setCameraMode] = useState<'scan' | 'photo' | null>(null);
  // Most recent AI suggestion per field. Drives the "✨ AI" badge (when
  // the field still equals the suggestion) and the "Restore" link (when
  // the kid has edited away from it).
  const [aiSuggested, setAiSuggested] = useState<{
    title?: string;
    description?: string;
    subject?: string;
  }>({});
  // Slice 7h · auto-suggested concept ("what is this image about?") fired
  // automatically when photos exist + description is empty. Surfaces as a
  // card with ✓ Confirm / ✏️ Write my own — never overwrites the kid's
  // typing. `conceptDismissed` keeps the card hidden once the kid acts.
  const [aiConcept, setAiConcept] = useState<string | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptDismissed, setConceptDismissed] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // Reset on open/close so a previous draft doesn't leak into the next session.
  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setTitle('');
    setDescription('');
    setDate(todayYmd());
    setSubject('');
    setSaving(false);
    setError(null);
    setDescTouched(false);
    setDescribing(false);
    setScanning(false);
    setAiNote(null);
    setCameraMode(null);
    setAiSuggested({});
    setAiConcept(null);
    setConceptLoading(false);
    setConceptDismissed(false);
  }, [open]);

  // Object-URL lifecycle for the photo previews. Re-create on photos[]
  // change; revoke when the component unmounts or photos change.
  const previewUrls = useMemo(
    () => photos.map((f) => URL.createObjectURL(f)),
    [photos],
  );
  useEffect(() => {
    return () => { previewUrls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [previewUrls]);

  // Slice 7h · auto AI-concept suggestion. When photos exist + the
  // description is still empty + nothing else has filled it in, ask
  // Claude what the image is about so the kid can ✓ confirm or ✏️
  // rewrite. Skipped on scan-flows since the Scan path already drops
  // an extracted description in. Fires once per session — kid actions
  // set `conceptDismissed`, photo changes don't re-fire.
  useEffect(() => {
    if (!open) return;
    if (photos.length === 0) return;
    if (description.trim().length > 0) return;
    if (descTouched) return;
    if (aiSuggested.description) return;
    if (aiConcept || conceptLoading || conceptDismissed) return;
    let cancelled = false;
    setConceptLoading(true);
    (async () => {
      try {
        const out = await describeItem({
          files: photos, area, kidName,
          title: '', // triggers the no-title prompt in the API
          subject: subject || undefined,
          date,
        });
        if (cancelled) return;
        if (!out.skipped && out.description) setAiConcept(out.description);
      } finally {
        if (!cancelled) setConceptLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, photos, description, descTouched, aiSuggested.description, aiConcept, conceptLoading, conceptDismissed, area, kidName, subject, date]);

  const onPickPhotos: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setPhotos((prev) => [...prev, ...picked]);
    // Reset the input so picking the same file again still fires onChange.
    if (fileRef.current) fileRef.current.value = '';
  };
  const removePhotoAt = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const showSubject = area === 'school_project' && (profile?.subjects?.length ?? 0) > 0;

  /** Real AI draft via /api/sparks/ai/describe — falls back to the
   *  local template if the key is missing or the call errors. Keeps
   *  the parent in control: result lands in the textarea, fully
   *  editable. Title is required (the AI needs context). */
  const fillDescription = async () => {
    if (!title.trim() || describing) return;
    setDescribing(true);
    setAiNote(null);
    try {
      const out = await describeItem({
        files: photos,
        area,
        kidName,
        title: title.trim(),
        subject: subject || undefined,
        date,
      });
      if (out.skipped) {
        setDescription(draftDescription({
          area, title, subject: subject || undefined, date, kidName,
          photoCount: photos.length,
        }));
        setAiNote('AI is off in this preview — used a template seed.');
      } else if (out.error || !out.description) {
        setDescription(draftDescription({
          area, title, subject: subject || undefined, date, kidName,
          photoCount: photos.length,
        }));
        setAiNote('AI hiccup — used a template seed. Edit freely.');
      } else {
        setDescription(out.description);
        setAiNote('✨ Drafted by Claude · edit anything you like.');
      }
      setDescTouched(true);
    } finally {
      setDescribing(false);
    }
  };

  /** Generic AI auto-fill from a single photo. Used:
   *   • on Scan-tile confirm (first scanned page only)
   *   • on the manual "Scan certificate" button for Achievements
   *  NEVER overwrites a value the kid already typed. Tracks the AI
   *  suggestion so we can render the badge + Restore link. */
  const autoExtractFromScan = async (file: File) => {
    if (scanning) return;
    setScanning(true);
    setAiNote(null);
    try {
      if (area === 'achievement') {
        const out = await extractFromImage(file, 'achievement');
        if ('skipped' in out && out.skipped) {
          setAiNote('AI is off in this preview — fill in title + date yourself.');
          return;
        }
        if (!out.ok) {
          setAiNote(out.error || 'Scan failed — fill in title + date yourself.');
          return;
        }
        const { awardName, issuer, date: extractedDate } = out.data;
        const newDesc = issuer
          ? `From ${issuer}${extractedDate ? ` · ${toDisplayDate(extractedDate)}` : ''}.`
          : '';
        const next: typeof aiSuggested = {};
        if (awardName && !title.trim()) {
          setTitle(awardName);
          next.title = awardName;
        }
        if (extractedDate) setDate(extractedDate);
        if (newDesc && !description.trim()) {
          setDescription(newDesc);
          setDescTouched(true);
          next.description = newDesc;
        }
        setAiSuggested((prev) => ({ ...prev, ...next }));
        if (next.title || next.description) {
          setAiNote('✨ Scanned · review + edit before saving.');
        } else {
          setAiNote('Couldn\'t read much from that scan — fill it in yourself.');
        }
      } else if (area === 'school_project') {
        const out = await extractFromImage(file, 'school_project');
        if ('skipped' in out && out.skipped) {
          setAiNote('AI is off in this preview — fill in title + details yourself.');
          return;
        }
        if (!out.ok) {
          setAiNote(out.error || 'Scan failed — fill in title + details yourself.');
          return;
        }
        const { title: t, description: d, subject: s } = out.data;
        const next: typeof aiSuggested = {};
        if (t && !title.trim()) {
          setTitle(t);
          next.title = t;
        }
        if (d && !description.trim()) {
          setDescription(d);
          setDescTouched(true);
          next.description = d;
        }
        if (s && !subject && showSubject) {
          // Match case-insensitive against the kid's profile subjects.
          const matched = (profile?.subjects ?? []).find(
            (x) => x.name.toLowerCase() === s.toLowerCase(),
          );
          if (matched) {
            setSubject(matched.name);
            next.subject = matched.name;
          }
        }
        setAiSuggested((prev) => ({ ...prev, ...next }));
        if (next.title || next.description || next.subject) {
          setAiNote('✨ Scanned · review + edit before saving.');
        } else {
          setAiNote('Couldn\'t read much from that scan — fill it in yourself.');
        }
      } else if (area === 'home_project' || area === 'sports_subscription') {
        const out = await extractFromImage(file, area);
        if ('skipped' in out && out.skipped) {
          setAiNote('AI is off in this preview — fill in title + details yourself.');
          return;
        }
        if (!out.ok) {
          setAiNote(out.error || 'Scan failed — fill in title + details yourself.');
          return;
        }
        const { title: t, description: d } = out.data;
        const next: typeof aiSuggested = {};
        if (t && !title.trim()) {
          setTitle(t);
          next.title = t;
        }
        if (d && !description.trim()) {
          setDescription(d);
          setDescTouched(true);
          next.description = d;
        }
        setAiSuggested((prev) => ({ ...prev, ...next }));
        if (next.title || next.description) {
          setAiNote('✨ Scanned · review + edit before saving.');
        } else {
          setAiNote('Couldn\'t read much from that scan — fill it in yourself.');
        }
      }
    } finally {
      setScanning(false);
    }
  };

  /** Achievement-only manual trigger: re-scan the first uploaded photo
   *  (e.g. when the kid uploaded via Photo / Upload tile instead of
   *  Scan, and now wants the AI fill anyway). */
  const scanCertificate = async () => {
    if (photos.length === 0 || scanning) return;
    await autoExtractFromScan(photos[0]);
  };

  /** CameraCaptureSheet confirm handler. Adds the captured files to
   *  the photos array. If the kid was in SCAN mode, kick off the AI
   *  auto-extract against the FIRST page. */
  const onCameraConfirm = async (files: File[]) => {
    if (files.length === 0) return;
    const wasScan = cameraMode === 'scan';
    setPhotos((prev) => [...prev, ...files]);
    setCameraMode(null);
    if (wasScan) {
      // Only auto-extract when this scan is the first photo on the
      // form — otherwise the kid is just adding more pages.
      const isFirstPhoto = photos.length === 0;
      if (isFirstPhoto) {
        await autoExtractFromScan(files[0]);
      }
    }
  };

  const canSave = !!title.trim() && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      // Reserve the itemId client-side so the photo writes + the
      // Firestore write share the same path. Orphan storage blobs
      // only happen if the final setDoc fails — rare.
      const reservedRef = doc(collection(db, 'families', familyId, 'sparks_items'));
      const itemId = reservedRef.id;

      let urls: SparksPhotoUrls[] = [];
      if (photos.length > 0) {
        urls = await uploadSparksPhotos(familyId, itemId, photos);
      }

      let finalItemId: string;
      if (urls.length > 0) {
        // Use setDoc against the reserved id so storage path lines up.
        const { setDoc, serverTimestamp } = await import('firebase/firestore');
        await setDoc(reservedRef, {
          kid_id: kidId,
          area,
          title: title.trim(),
          description: description.trim() || undefined,
          photo_urls: urls.map((u) => u.feedUrl),
          date,
          subject: showSubject && subject ? subject : undefined,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          created_by: uid,
        });
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

      {/* Sheet — phone-style on mobile, comfortable modal on desktop */}
      <div
        role="dialog"
        aria-labelledby={`${formId}-title`}
        className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
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
          {/* Multi-photo picker */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                Photos {photos.length > 0 && <span className="text-[#0F1F44]">· {photos.length}</span>}
              </label>
              {photos.length > 0 && area === 'achievement' && (
                <button
                  type="button"
                  onClick={scanCertificate}
                  disabled={scanning}
                  className="text-[10px] font-extrabold uppercase tracking-wider bg-[#E5D6FF] hover:bg-[#D4BEFF] text-[#5A3CB8] rounded-full px-2.5 py-1 transition-colors disabled:opacity-60"
                  title="Re-read issuer, award name, and date from the first photo."
                >
                  {scanning ? '✨ Scanning…' : '✨ Scan certificate'}
                </button>
              )}
            </div>

            {/* 3-tile input row — Scan (AI auto-fill) · Photo · Upload */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCameraMode('scan')}
                className="rounded-2xl border-2 border-dashed border-[#E5D6FF] bg-[#F6EFFF] hover:border-[#5A3CB8] hover:bg-[#EFE3FF] transition-colors py-4 px-2 text-center"
                title="Scan a page — AI fills in the title + details for you."
              >
                <div className="text-2xl mb-0.5" aria-hidden>📄</div>
                <div className="text-[12px] font-extrabold text-[#5A3CB8]">Scan</div>
                <div className="text-[10px] text-[#5A6488] mt-0.5">AI fills it in</div>
              </button>
              <button
                type="button"
                onClick={() => setCameraMode('photo')}
                className="rounded-2xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-4 px-2 text-center"
                title="Take a fresh photo — auto-brightened + sharpened."
              >
                <div className="text-2xl mb-0.5" aria-hidden>📷</div>
                <div className="text-[12px] font-extrabold text-[#0F1F44]">Photo</div>
                <div className="text-[10px] text-[#5A6488] mt-0.5">Camera + clean</div>
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-2xl border-2 border-dashed border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#D4A847] hover:bg-[#FFFBF5] transition-colors py-4 px-2 text-center"
                title="Pick photos from the gallery."
              >
                <div className="text-2xl mb-0.5" aria-hidden>📁</div>
                <div className="text-[12px] font-extrabold text-[#0F1F44]">Upload</div>
                <div className="text-[10px] text-[#5A6488] mt-0.5">From gallery</div>
              </button>
            </div>

            {/* Thumbnails — shown once at least one photo is attached. */}
            {photos.length > 0 && (
              <div className="mt-2.5 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {previewUrls.map((url, idx) => (
                  <div
                    key={url}
                    className="relative aspect-square rounded-xl overflow-hidden bg-[#FBF7EE] border border-[#ECE4D3]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhotoAt(idx)}
                      aria-label={`Remove photo ${idx + 1}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/95 text-[#E85C5C] font-bold text-[12px] grid place-items-center shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {scanning && (
              <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-[#5A3CB8]">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-[#5A3CB8] border-t-transparent animate-spin" aria-hidden />
                Reading your scan…
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickPhotos}
              className="hidden"
            />
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={`${formId}-title-input`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                Title <span className="text-[#E85C5C]">·</span> required
              </label>
              {aiSuggested.title && title === aiSuggested.title && (
                <span className="text-[9px] font-extrabold uppercase tracking-wider bg-[#E5D6FF] text-[#5A3CB8] rounded-full px-2 py-0.5">
                  ✨ AI
                </span>
              )}
              {aiSuggested.title && title !== aiSuggested.title && (
                <button
                  type="button"
                  onClick={() => setTitle(aiSuggested.title!)}
                  className="text-[10px] font-extrabold text-[#5A3CB8] hover:underline"
                  title="Restore the AI suggestion"
                >
                  ↩︎ Restore AI
                </button>
              )}
            </div>
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
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor={`${formId}-subject`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                  Subject
                </label>
                {aiSuggested.subject && subject === aiSuggested.subject && (
                  <span className="text-[9px] font-extrabold uppercase tracking-wider bg-[#E5D6FF] text-[#5A3CB8] rounded-full px-2 py-0.5">
                    ✨ AI
                  </span>
                )}
                {aiSuggested.subject && subject !== aiSuggested.subject && (
                  <button
                    type="button"
                    onClick={() => setSubject(aiSuggested.subject!)}
                    className="text-[10px] font-extrabold text-[#5A3CB8] hover:underline"
                    title="Restore the AI suggestion"
                  >
                    ↩︎ Restore AI
                  </button>
                )}
              </div>
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

          {/* Slice 7h · AI concept card. Fires after photos are picked
              and the description is still blank. Two paths:
                ✓ "Yes, that's it" → fills the textarea with the AI text.
                ✏️ "I'll describe it" → dismisses the card and focuses
                                       the textarea so the kid writes
                                       in their own words.
              Either way the textarea is editable. The kid has to make
              the call — that's the logical-thinking moment. */}
          {(conceptLoading || (aiConcept && !conceptDismissed)) && (
            <div className="rounded-2xl border-2 border-[#5A3CB8]/30 bg-[#F6EFFF] px-3.5 py-3">
              <div className="text-[10.5px] font-extrabold uppercase tracking-[0.6px] text-[#5A3CB8] mb-1">
                🤖 AI sees this as…
              </div>
              {conceptLoading && !aiConcept ? (
                <div className="text-[13px] italic text-[#5A6488]">Reading the image…</div>
              ) : (
                <>
                  <div className="text-[13.5px] text-[#1B1547] mb-2.5 leading-snug">{aiConcept}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        if (!aiConcept) return;
                        setDescription(aiConcept);
                        setDescTouched(true);
                        setAiSuggested((prev) => ({ ...prev, description: aiConcept }));
                        setConceptDismissed(true);
                      }}
                      className="px-3 py-1.5 rounded-xl text-[12px] font-extrabold text-white"
                      style={{ background: '#5A3CB8' }}
                    >
                      ✓ Yes, that&apos;s it
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConceptDismissed(true);
                        setDescTouched(true);
                        // Focus the textarea so the kid can start typing.
                        setTimeout(() => descRef.current?.focus(), 0);
                      }}
                      className="px-3 py-1.5 rounded-xl text-[12px] font-extrabold bg-white border-2 border-[#5A3CB8] text-[#5A3CB8]"
                    >
                      ✏️ I&apos;ll describe in my own words
                    </button>
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-2">
                    Your call — describe it your way to help your grown-ups see the concept.
                  </div>
                </>
              )}
            </div>
          )}

          {/* Description with AI draft helper */}
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
              <label htmlFor={`${formId}-desc`} className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                Description
              </label>
              <div className="flex items-center gap-2">
                {aiSuggested.description && description === aiSuggested.description && (
                  <span className="text-[9px] font-extrabold uppercase tracking-wider bg-[#E5D6FF] text-[#5A3CB8] rounded-full px-2 py-0.5">
                    ✨ AI
                  </span>
                )}
                {aiSuggested.description && description !== aiSuggested.description && (
                  <button
                    type="button"
                    onClick={() => { setDescription(aiSuggested.description!); setDescTouched(true); }}
                    className="text-[10px] font-extrabold text-[#5A3CB8] hover:underline"
                    title="Restore the AI suggestion"
                  >
                    ↩︎ Restore AI
                  </button>
                )}
                <button
                  type="button"
                  onClick={fillDescription}
                  disabled={!title.trim() || describing}
                  className="text-[10.5px] font-extrabold tracking-wide rounded-full px-2.5 py-1 disabled:opacity-40"
                  style={{ background: '#E5D6FF', color: '#5A3CB8' }}
                  title="Claude reads your photos + title and drafts a description for you to edit."
                >
                  {describing ? '✨ Drafting…' : '✨ Help me describe'}
                </button>
              </div>
            </div>
            <textarea
              ref={descRef}
              id={`${formId}-desc`}
              value={description}
              onChange={(e) => { setDescription(e.target.value); setDescTouched(true); }}
              placeholder={`What's this about? Add details — or tap "Help me describe" to start with a draft you can edit.`}
              rows={4}
              maxLength={800}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#D4A847] resize-none"
            />
            {aiNote && (
              <div className="text-[10.5px] text-[#5A3CB8] font-bold mt-1">
                {aiNote}
              </div>
            )}
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

      {/* In-app camera (Scan / Photo). Renders above this sheet. */}
      <CameraCaptureSheet
        open={cameraMode !== null}
        mode={cameraMode ?? 'photo'}
        onClose={() => setCameraMode(null)}
        onConfirm={onCameraConfirm}
      />
    </div>
  );
}
