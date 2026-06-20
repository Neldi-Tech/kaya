// Kaya Sparks · Home Practice → Materials
//
// Reference docs that parents (or helpers with Sparks-act) upload for
// kids to refer back to during revisions. Subject-tagged, colour-coded,
// and multi-kid shareable from a single upload.
//
// Storage shape:
//   /families/{familyId}/sparks_materials/{materialId}        Firestore doc
//   /families/{familyId}/sparks_materials/{materialId}/<file> Storage object
//
// Rules live in firestore.rules (sparks_materials block) and
// storage.rules (sparks_materials prefix).

import type { Timestamp } from 'firebase/firestore';

/** Canonical pre-populated subjects shown in every parent upload sheet
 *  + every kid filter chip row. The kid's own `sparks_profile.subjects`
 *  list is merged on top of this so any custom subject (e.g. "Kiswahili",
 *  "Robotics Club") also gets a chip. */
export interface SubjectMeta {
  key: string;     // canonical name — stored on the material as `subject`
  emoji: string;
  /** Foreground colour (hex). */
  color: string;
  /** Background colour (hex). */
  bg: string;
}

export const COMMON_SUBJECTS: SubjectMeta[] = [
  { key: 'Math',      emoji: '📐', color: '#F2A93B', bg: '#FFF1D6' },
  { key: 'English',   emoji: '📖', color: '#4E7AC7', bg: '#DDE7FA' },
  { key: 'Science',   emoji: '🔬', color: '#2E9D5E', bg: '#D7F0DF' },
  { key: 'Geography', emoji: '🌍', color: '#8E5BC7', bg: '#ECDFFB' },
  { key: 'History',   emoji: '🏛', color: '#C9606B', bg: '#FBDEE1' },
  { key: 'Art',       emoji: '🎨', color: '#E58A4B', bg: '#FBE2CF' },
  { key: 'Music',     emoji: '🎵', color: '#3FAFB7', bg: '#D2F0F2' },
  { key: 'Language',  emoji: '🗣', color: '#B7567B', bg: '#F8DDE7' },
  { key: 'Other',     emoji: '📚', color: '#6E7A98', bg: '#E5E7EE' },
];

/** Fallback palette for custom subjects (anything not in the canonical
 *  list). Hashes the subject key into the palette so the SAME custom
 *  subject always reads the same colour. */
const CUSTOM_PALETTE: Array<{ color: string; bg: string }> = [
  { color: '#7B5CD6', bg: '#E5D6FF' },
  { color: '#3FAFB7', bg: '#D2F0F2' },
  { color: '#C9606B', bg: '#FBDEE1' },
  { color: '#2E9D5E', bg: '#D7F0DF' },
  { color: '#F2A93B', bg: '#FFF1D6' },
];

/** Look up subject metadata (emoji + colours) by name. Falls back to a
 *  stable hash-coloured "Other"-shaped meta for custom subjects. */
export function subjectMeta(key: string): SubjectMeta {
  const hit = COMMON_SUBJECTS.find((s) => s.key.toLowerCase() === key.toLowerCase());
  if (hit) return hit;
  // Stable colour assignment for custom subject names.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  const palette = CUSTOM_PALETTE[h % CUSTOM_PALETTE.length];
  return { key, emoji: '📘', ...palette };
}

/** What kind of upload a material represents. */
export type MaterialKind = 'file' | 'link';

/** Parent's rating + feedback on a material — mirrors the Sparks Projects
 *  rating (⭐1–5 + a feedback note), so a scanned doc a kid reads can be
 *  rated + commented on by a parent and the kid sees it. */
export interface MaterialRating {
  stars: number;            // 1–5
  note?: string;            // parent feedback the kid reads
  rated_by: string;         // parent (or sparks-act helper) uid
  rated_by_name: string;    // display name at rating time
  rated_at: number;         // ms epoch
}

export interface SparksMaterial {
  id: string;
  /** Required — kid-readable short title. */
  title: string;
  /** Canonical subject key (one of COMMON_SUBJECTS.key or a custom one). */
  subject: string;
  /** Optional longer description from the uploading parent. */
  description?: string;

  kind: MaterialKind;

  // file ------------------------------------------------
  /** Storage download URL (file kind only). */
  file_url?: string;
  /** Original filename as picked / scanned. */
  file_name?: string;
  /** Bytes of the stored file. */
  file_size_bytes?: number;
  /** MIME type at upload time (e.g. application/pdf, image/jpeg). */
  file_mime?: string;

  // link ------------------------------------------------
  /** External URL (link kind only). */
  link_url?: string;

  /** Who in the family this material is shared with.
   *  - 'all_kids'       → every kid in the family sees it
   *  - string[]         → only the listed kid ids see it */
  shared_with: 'all_kids' | string[];

  // provenance ------------------------------------------
  uploaded_by: string;       // parent (or helper) uid
  uploaded_by_name: string;  // display name at upload time
  created_at: Timestamp;
  updated_at: Timestamp;

  /** Parent rating + feedback (absent until a parent rates it). */
  rating?: MaterialRating;
}

/** Materials feed visible to a given kid — applies the sharing filter
 *  client-side after the Firestore subscription. */
export function visibleToKid(material: SparksMaterial, kidId: string): boolean {
  if (material.shared_with === 'all_kids') return true;
  return Array.isArray(material.shared_with) && material.shared_with.includes(kidId);
}

/** Group a list of materials by subject for the kid filter view +
 *  per-subject counts on the filter pills. */
export function countsBySubject(items: SparksMaterial[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of items) out[m.subject] = (out[m.subject] ?? 0) + 1;
  return out;
}

/** Combine the canonical subjects + any custom subjects pulled in from
 *  (a) the kid's sparks_profile and (b) subjects already in use on
 *  existing materials. De-duped, preserves the canonical order, then
 *  appends customs at the end. */
export function mergeSubjects(args: {
  profileSubjects?: string[];        // from sparks_profile.subjects[*].name
  inUseSubjects?: string[];          // pulled from existing materials
}): SubjectMeta[] {
  const seen = new Set<string>();
  const out: SubjectMeta[] = [];
  for (const s of COMMON_SUBJECTS) {
    out.push(s);
    seen.add(s.key.toLowerCase());
  }
  const extras = [
    ...(args.profileSubjects ?? []),
    ...(args.inUseSubjects ?? []),
  ];
  for (const raw of extras) {
    const k = raw.trim();
    if (!k) continue;
    if (seen.has(k.toLowerCase())) continue;
    out.push(subjectMeta(k));
    seen.add(k.toLowerCase());
  }
  return out;
}

/** Pretty file-size for material card meta line. */
export function prettyBytes(n?: number): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pick a kid-friendly icon for a material card from its mime type. */
export function materialIcon(m: SparksMaterial): string {
  if (m.kind === 'link') return '🔗';
  const mime = (m.file_mime || '').toLowerCase();
  if (mime.startsWith('image/'))      return '🖼';
  if (mime === 'application/pdf')     return '📄';
  if (mime.includes('word')   || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '📝';
  if (mime.includes('sheet')  || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')        return '📊';
  if (mime.includes('presentation') || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '🖥';
  return '📎';
}
