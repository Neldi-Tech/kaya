'use client';

// Kaya Sparks · Home Practice → Add / edit Materials sheet.
//
// Parent (or helper with sparks-act) uploads a reference doc, picks a
// subject, and chooses to share it with all kids or specific kids.
// Reuses the in-app CameraCaptureSheet for Scan + Photo. Edit mode
// (passed `existing`) populates the fields and skips the file picker —
// you can change title / subject / share-with without re-uploading.

import { useEffect, useMemo, useRef, useState } from 'react';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import {
  COMMON_SUBJECTS, mergeSubjects, subjectMeta, type SparksMaterial,
} from '@/lib/sparks/materials';
import {
  createMaterial, newMaterialId, updateMaterial, uploadMaterialFile,
} from '@/lib/sparks/materialsFirestore';
import { describeMaterial } from '@/lib/sparks/ai';

interface KidOption { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (materialId: string) => void;
  familyId: string;
  uid: string;
  uploaderName: string;
  /** All kids in the family — drives the "Pick kids" picker. */
  kids: KidOption[];
  /** Subjects already in use across existing materials — merged into
   *  the chip grid so the parent doesn't see duplicates. */
  inUseSubjects?: string[];
  /** Custom subjects pulled from any kid's sparks_profile. */
  profileSubjects?: string[];
  /** When present, the sheet renders in edit mode. */
  existing?: SparksMaterial | null;
}

export default function AddMaterialSheet({
  open, onClose, onSaved, familyId, uid, uploaderName, kids,
  inUseSubjects, profileSubjects, existing,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<string>('');
  const [customSubject, setCustomSubject] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [shareAll, setShareAll] = useState(true);
  const [pickedKidIds, setPickedKidIds] = useState<string[]>([]);
  const [cameraMode, setCameraMode] = useState<'scan' | 'photo' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // Reset on open. In edit mode, hydrate from `existing`.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setCameraMode(null);
    setDescribing(false);
    setAiNote(null);
    if (existing) {
      setTitle(existing.title);
      setSubject(existing.subject);
      setShowCustom(!COMMON_SUBJECTS.some((s) => s.key.toLowerCase() === existing.subject.toLowerCase()));
      setCustomSubject(
        COMMON_SUBJECTS.some((s) => s.key.toLowerCase() === existing.subject.toLowerCase())
          ? ''
          : existing.subject,
      );
      setDescription(existing.description ?? '');
      setKind(existing.kind);
      setFile(null);
      setLinkUrl(existing.link_url ?? '');
      const all = existing.shared_with === 'all_kids';
      setShareAll(all);
      setPickedKidIds(all ? [] : (existing.shared_with as string[]));
    } else {
      setTitle('');
      setSubject('');
      setShowCustom(false);
      setCustomSubject('');
      setDescription('');
      setKind('file');
      setFile(null);
      setLinkUrl('');
      setShareAll(true);
      setPickedKidIds([]);
    }
  }, [open, existing]);

  const subjects = useMemo(
    () => mergeSubjects({ inUseSubjects, profileSubjects }),
    [inUseSubjects, profileSubjects],
  );

  const isEdit = !!existing;

  const effectiveSubject = showCustom ? customSubject.trim() : subject;
  const canSave =
    title.trim().length > 0
    && effectiveSubject.length > 0
    && !saving
    && (
      isEdit
      || (kind === 'file' && !!file)
      || (kind === 'link' && /^https?:\/\//i.test(linkUrl.trim()))
    );

  const togglePickKid = (id: string) =>
    setPickedKidIds((prev) => prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]);

  const onCameraConfirm = (files: File[]) => {
    // v1: take the first captured page as the material file. Multi-page
    // PDF assembly is a deferred follow-up.
    if (files.length === 0) return;
    setFile(files[0]);
    setKind('file');
    setCameraMode(null);
  };

  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = e.target.files?.[0];
    if (picked) {
      setFile(picked);
      setKind('file');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  /** Slice 7d · AI describe button. Reads the uploaded IMAGE material
   *  and drafts a parent-friendly description that gets dropped into
   *  the textarea below. Image-only — PDFs fall through to a friendly
   *  inline hint. */
  const onSuggestDescription = async () => {
    if (describing) return;
    if (!file || !file.type.startsWith('image/')) {
      setAiNote("AI describe works on photo / scan materials. Type your own for PDF / link uploads.");
      return;
    }
    setDescribing(true);
    setAiNote(null);
    try {
      const kidNames = shareAll
        ? kids.map((k) => k.name)
        : kids.filter((k) => pickedKidIds.includes(k.id)).map((k) => k.name);
      const finalSubject = (showCustom ? customSubject : subject).trim();
      const out = await describeMaterial({
        files: [file],
        title: title.trim() || undefined,
        subject: finalSubject || undefined,
        kidNames,
      });
      if (out.skipped) {
        setAiNote('AI is off in this preview — type a short description.');
        return;
      }
      if (out.error || !out.description) {
        setAiNote(out.error || "Couldn't read the material — try a clearer photo, or type your own.");
        return;
      }
      setDescription(out.description);
      setAiNote('✨ Drafted by Claude · edit anything you like.');
    } finally {
      setDescribing(false);
    }
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const shared = shareAll
        ? ('all_kids' as const)
        : pickedKidIds.length > 0 ? pickedKidIds : ('all_kids' as const); // safety fallback
      if (isEdit) {
        await updateMaterial(familyId, existing!.id, {
          title: title.trim(),
          subject: effectiveSubject,
          description: description.trim() || undefined,
          shared_with: shared,
        });
        onSaved?.(existing!.id);
        onClose();
        return;
      }
      const id = newMaterialId(familyId);
      if (kind === 'file' && file) {
        const up = await uploadMaterialFile(familyId, id, file);
        await createMaterial(familyId, {
          id,
          title: title.trim(),
          subject: effectiveSubject,
          description: description.trim() || undefined,
          kind: 'file',
          file_url: up.url,
          file_name: up.storedName,
          file_size_bytes: up.sizeBytes,
          file_mime: up.mime,
          shared_with: shared,
          uploaded_by: uid,
          uploaded_by_name: uploaderName,
        });
      } else if (kind === 'link') {
        await createMaterial(familyId, {
          id,
          title: title.trim(),
          subject: effectiveSubject,
          description: description.trim() || undefined,
          kind: 'link',
          link_url: linkUrl.trim(),
          shared_with: shared,
          uploaded_by: uid,
          uploaded_by_name: uploaderName,
        });
      }
      onSaved?.(id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the material. Try again?');
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
        aria-label={isEdit ? 'Edit material' : 'Add material'}
        className="relative w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl"
      >
        <div
          className="px-5 pt-5 pb-4 text-white"
          style={{ background: 'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)' }}
        >
          <div className="text-[12px] opacity-85">Home Practice · Parent</div>
          <h2 className="font-display font-extrabold text-[20px] m-0 mt-0.5">
            {isEdit ? '✏️ Edit material' : '📚 Add material'}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Title <span className="text-[#E85C5C]">·</span> required
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Year 4 End of Year Revisions"
              maxLength={120}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2.5 text-[14px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8]"
            />
          </div>

          {/* Subject grid */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Subject <span className="text-[#E85C5C]">·</span> required
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {subjects.map((s) => {
                const selected = !showCustom && subject === s.key;
                return (
                  <button
                    type="button"
                    key={s.key}
                    onClick={() => { setSubject(s.key); setShowCustom(false); setCustomSubject(''); }}
                    className={`rounded-xl px-2 py-2 text-[11px] font-extrabold text-center border-[1.5px] transition ${selected ? '' : 'opacity-95 border-transparent'}`}
                    style={{
                      background: s.bg,
                      color: s.color,
                      borderColor: selected ? s.color : 'transparent',
                      boxShadow: selected ? '0 0 0 3px rgba(90, 60, 184, 0.10)' : undefined,
                    }}
                    aria-pressed={selected}
                  >
                    {s.emoji} {s.key}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setShowCustom(true); setSubject(''); }}
                className={`rounded-xl px-2 py-2 text-[11px] font-extrabold text-center border-[1.5px] ${showCustom ? 'border-[#5A3CB8] bg-[#E5D6FF] text-[#5A3CB8]' : 'border-dashed border-[#ECE4D3] bg-[#FBF7EE] text-[#5A6488]'}`}
                aria-pressed={showCustom}
              >
                ＋ Custom
              </button>
            </div>
            {showCustom && (
              <input
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="e.g. Kiswahili, Robotics"
                maxLength={32}
                className="mt-2 w-full bg-white border border-[#5A3CB8] rounded-xl px-3.5 py-2 text-[13px] text-[#0F1F44] focus:outline-none"
                autoFocus
              />
            )}
          </div>

          {/* Source — file / scan / link */}
          {!isEdit && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
                File or link
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { setKind('file'); fileRef.current?.click(); }}
                  className={`rounded-2xl border-2 border-dashed py-4 px-2 text-center transition ${kind === 'file' && file ? 'border-[#5A3CB8] bg-[#F6EFFF]' : 'border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#5A3CB8]'}`}
                  title="Pick a PDF / docx / pptx / xlsx / image from this device."
                >
                  <div className="text-2xl mb-0.5" aria-hidden>📄</div>
                  <div className="text-[12px] font-extrabold text-[#0F1F44]">Pick file</div>
                  <div className="text-[10px] text-[#5A6488] mt-0.5">PDF · docx · img</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCameraMode('scan')}
                  className={`rounded-2xl border-2 border-dashed py-4 px-2 text-center transition ${cameraMode === 'scan' ? 'border-[#5A3CB8] bg-[#F6EFFF]' : 'border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#5A3CB8]'}`}
                  title="Scan with the in-app camera — auto-cleaned for sharp text."
                >
                  <div className="text-2xl mb-0.5" aria-hidden>📷</div>
                  <div className="text-[12px] font-extrabold text-[#0F1F44]">Scan</div>
                  <div className="text-[10px] text-[#5A6488] mt-0.5">Camera + clean</div>
                </button>
                <button
                  type="button"
                  onClick={() => { setKind('link'); setFile(null); }}
                  className={`rounded-2xl border-2 border-dashed py-4 px-2 text-center transition ${kind === 'link' ? 'border-[#5A3CB8] bg-[#F6EFFF]' : 'border-[#ECE4D3] bg-[#FBF7EE] hover:border-[#5A3CB8]'}`}
                  title="Paste a URL — Khan Academy, YouTube, Sporcle, etc."
                >
                  <div className="text-2xl mb-0.5" aria-hidden>🔗</div>
                  <div className="text-[12px] font-extrabold text-[#0F1F44]">Link</div>
                  <div className="text-[10px] text-[#5A6488] mt-0.5">URL</div>
                </button>
              </div>
              {kind === 'file' && file && (
                <div className="mt-2 text-[11.5px] text-[#0F1F44] font-bold">
                  <span className="text-[#5A3CB8]">✓</span> {file.name}
                  <span className="text-[#5A6488] font-normal ml-1.5">· {Math.round((file.size || 0) / 1024)} KB</span>
                </div>
              )}
              {kind === 'link' && (
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://www.khanacademy.org/…"
                  className="mt-2 w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2 text-[13px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8]"
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf,image/*"
                onChange={onFilePicked}
                className="hidden"
              />
            </div>
          )}

          {/* Description (optional) — AI describe button (Slice 7d) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488]">
                Description (optional)
              </label>
              <button
                type="button"
                onClick={onSuggestDescription}
                disabled={describing || !file}
                className="text-[10.5px] font-extrabold tracking-wide rounded-full px-2.5 py-1 disabled:opacity-40"
                style={{ background: '#E5D6FF', color: '#5A3CB8' }}
                title={!file ? 'Add a material first' : 'Claude reads the photo + drafts a description for you to edit.'}
              >
                {describing ? '✨ Drafting…' : '✨ Help me describe'}
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's in this material? When should the kid look here?"
              rows={2}
              maxLength={400}
              className="w-full bg-white border border-[#ECE4D3] rounded-xl px-3.5 py-2 text-[13.5px] text-[#0F1F44] focus:outline-none focus:border-[#5A3CB8] resize-none"
            />
            {aiNote && (
              <div className="text-[10.5px] text-[#5A3CB8] font-bold mt-1">{aiNote}</div>
            )}
          </div>

          {/* Share with */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5A6488] block mb-1.5">
              Share with
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShareAll(true)}
                className={`rounded-xl border-[1.5px] py-2.5 text-center transition ${shareAll ? 'border-[#5A3CB8] bg-[#E5D6FF] text-[#5A3CB8]' : 'border-[#ECE4D3] bg-white text-[#5A6488]'}`}
                aria-pressed={shareAll}
              >
                <div className="text-[12px] font-extrabold">👨‍👩‍👧‍👦 All kids</div>
                <div className="text-[10px] mt-0.5 opacity-90">Every kid sees it</div>
              </button>
              <button
                type="button"
                onClick={() => setShareAll(false)}
                className={`rounded-xl border-[1.5px] py-2.5 text-center transition ${!shareAll ? 'border-[#5A3CB8] bg-[#E5D6FF] text-[#5A3CB8]' : 'border-[#ECE4D3] bg-white text-[#5A6488]'}`}
                aria-pressed={!shareAll}
              >
                <div className="text-[12px] font-extrabold">🎯 Pick kids</div>
                <div className="text-[10px] mt-0.5 opacity-90">Choose specific</div>
              </button>
            </div>
            {!shareAll && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {kids.map((k) => {
                  const picked = pickedKidIds.includes(k.id);
                  return (
                    <button
                      type="button"
                      key={k.id}
                      onClick={() => togglePickKid(k.id)}
                      className={`rounded-full px-3 py-1 text-[11.5px] font-bold border-[1.5px] transition ${picked ? 'border-[#5A3CB8] bg-[#E5D6FF] text-[#5A3CB8]' : 'border-[#ECE4D3] bg-white text-[#5A6488]'}`}
                      aria-pressed={picked}
                    >
                      {picked ? '✓ ' : ''}{k.name}
                    </button>
                  );
                })}
                {kids.length === 0 && (
                  <span className="text-[11px] text-[#5A6488]">No kids in this family yet.</span>
                )}
              </div>
            )}
            <div className="text-[10.5px] text-[#5A6488] mt-1.5 leading-snug">
              One upload, one place — no duplicates across profiles.
            </div>
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
              className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-[#5A6488] hover:bg-[#FBF7EE] transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#5A3CB8' }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : '📚 Save material'}
            </button>
          </div>
        </div>
      </div>

      <CameraCaptureSheet
        open={cameraMode !== null}
        mode={cameraMode ?? 'photo'}
        onClose={() => setCameraMode(null)}
        onConfirm={onCameraConfirm}
      />
    </div>
  );
}
