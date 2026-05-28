// Kaya Sparks · client-side AI helpers.
//
// Wraps the /api/sparks/ai/* routes (server-side Claude Sonnet vision)
// with a friendly Promise interface that the CaptureSheet + area pages
// can call. All routes return `{ skipped: true }` when ANTHROPIC_API_KEY
// is missing (Vercel preview without the env); callers should treat
// that as "AI is off — fall back to manual entry".

'use client';

import type { SparksItemArea } from './schema';

const MAX_LONG_EDGE_AI = 1280; // px — keeps base64 payload small
const JPEG_Q = 0.85;

// ── Image conversion ─────────────────────────────────────────────────

/** Read a File into a base64 string + a media type. Resizes to a long
 *  edge of 1280 px for AI calls — Claude reads fine at this size, the
 *  network payload is ~10× smaller than the 25 MB raw cap, and the
 *  user's full-res photo is already uploaded separately to Storage. */
export async function fileToAiBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_LONG_EDGE_AI / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available.');
  ctx.drawImage(img, 0, 0, w, h);

  // dataURL is "data:image/jpeg;base64,XXXX..." — strip the prefix.
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q);
  const base64 = dataUrl.split(',', 2)[1] ?? '';
  return { base64, mediaType: 'image/jpeg' };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
    img.src = url;
  });
}

// ── Describe (CaptureSheet "✨ Help me describe") ────────────────────

export interface DescribeArgs {
  files: File[];          // 0–4 photos; 0 = describe from title alone
  area: SparksItemArea;
  kidName: string;
  title: string;
  subject?: string;
  date?: string;          // YYYY-MM-DD
}

export interface DescribeResult {
  description: string;
  skipped: boolean;
  /** Surfaced when the user-visible error matters (network / 500). */
  error?: string;
}

/** Generate a description draft. Returns the empty-string + skipped=true
 *  when the AI key is missing — caller should fall back to the local
 *  template (`draftDescription` in CaptureSheet). */
export async function describeItem(args: DescribeArgs): Promise<DescribeResult> {
  try {
    const imageBase64s: string[] = [];
    let mediaType = 'image/jpeg';
    for (const f of args.files.slice(0, 4)) {
      const { base64, mediaType: mt } = await fileToAiBase64(f);
      imageBase64s.push(base64);
      mediaType = mt;
    }
    const res = await fetch('/api/sparks/ai/describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64s,
        mediaType,
        area: args.area,
        kidName: args.kidName,
        title: args.title,
        subject: args.subject,
        date: args.date,
      }),
    });
    if (!res.ok) {
      return { description: '', skipped: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data?.skipped) return { description: '', skipped: true };
    return { description: String(data?.description || '').trim(), skipped: false };
  } catch (e) {
    return {
      description: '',
      skipped: false,
      error: e instanceof Error ? e.message : 'Description failed',
    };
  }
}

// ── Extract (achievement OCR · academic report card OCR) ─────────────

export interface AchievementExtract {
  awardName: string;
  issuer: string;
  date: string;
  category: 'academic' | 'sports' | 'arts' | 'service' | 'other';
}
export interface AcademicExtract {
  term: 'T1' | 'T2' | 'T3' | '';
  year: number;
  subjects: Array<{ name: string; grade: string; percent: number | null }>;
  teacherNotes: string;
}
export type ExtractKind = 'achievement' | 'academic';
export type ExtractResult<K extends ExtractKind> =
  | { ok: true;  data: K extends 'achievement' ? AchievementExtract : AcademicExtract }
  | { ok: false; skipped?: boolean; error?: string };

// ── Insights (dashboard) ─────────────────────────────────────────────

export interface InsightCard { title: string; body: string }
export interface SparksInsights {
  strength: InsightCard;
  watch:    InsightCard;
  trend:    InsightCard;
  suggest:  InsightCard;
}

export interface GetInsightsArgs {
  kidName: string;
  windowLabel: string;
  itemCountsByArea: Record<string, number>;
  recentRatings: Array<{
    date: string; area: string; title: string;
    stars?: number; percent?: number; notes?: string;
  }>;
  recentItemTitles: Array<{ area: string; title: string; date: string }>;
  academicSnapshot: Array<{
    term: string; year: number;
    subjects: Array<{ name: string; grade?: string; percent?: number }>;
  }>;
}

/** Fetch the 4-card AI insights for the dashboard. Returns
 *  { skipped: true } when the AI route is off — caller renders a
 *  graceful empty state instead. */
export async function getSparksInsights(
  args: GetInsightsArgs,
): Promise<{ ok: true; data: SparksInsights } | { ok: false; skipped?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/sparks/ai/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    return { ok: true, data: data as SparksInsights };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Insights failed' };
  }
}

export async function extractFromImage<K extends ExtractKind>(
  file: File,
  kind: K,
): Promise<ExtractResult<K>> {
  try {
    const { base64, mediaType } = await fileToAiBase64(file);
    const res = await fetch('/api/sparks/ai/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mediaType, kind }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    return { ok: true, data } as ExtractResult<K>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Extract failed' };
  }
}

// ── Home Revisions (Slice 7) ─────────────────────────────────────────

export interface RevisionScore {
  subject: string;
  gradeLevel: string;
  score: number;
  breakdown: { correct: number; partial: number; wrong: number };
  notes: string;
}

export interface ScoreRevisionArgs {
  files: File[];
  kidName: string;
  focusSubjects?: string[];
}

export async function scoreRevision(
  args: ScoreRevisionArgs,
): Promise<{ ok: true; data: RevisionScore } | { ok: false; skipped?: boolean; error?: string }> {
  try {
    if (args.files.length === 0) {
      return { ok: false, error: 'No photos to score' };
    }
    const imageBase64s: string[] = [];
    let mediaType = 'image/jpeg';
    for (const f of args.files.slice(0, 4)) {
      const { base64, mediaType: mt } = await fileToAiBase64(f);
      imageBase64s.push(base64);
      mediaType = mt;
    }
    const res = await fetch('/api/sparks/ai/revision-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64s,
        mediaType,
        kidName: args.kidName,
        focusSubjects: args.focusSubjects,
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    return { ok: true, data: data as RevisionScore };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Revision score failed' };
  }
}

export interface SuggestNextArgs {
  kidName: string;
  subject: string;
  gradeLevel: string;
  score: number;
  notes?: string;
  recentRounds?: Array<{ subject: string; ai_notes?: string }>;
}

export async function suggestNextQuestions(
  args: SuggestNextArgs,
): Promise<{ ok: true; questions: string[] } | { ok: false; skipped?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/sparks/ai/revision-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    const qs = (data?.questions ?? []) as string[];
    if (!Array.isArray(qs) || qs.length === 0) return { ok: false, error: 'No questions returned' };
    return { ok: true, questions: qs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Next-questions failed' };
  }
}
