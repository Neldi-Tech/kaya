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
  /** Pass '' (empty) to fire the Slice 7h "what is this image about?"
   *  variant — the API switches prompts and proposes a concept the
   *  kid can confirm or rewrite. With a non-empty title, the API
   *  writes a description around it (original behaviour). */
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

// ── Extract (per-area OCR · achievement · academic · home/school/sports) ─

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
/** School-project scan returns title + description + (optional) subject hint. */
export interface SchoolProjectExtract {
  title: string;
  description: string;
  subject: string;
}
/** Home-project + sports-subscription scans return title + description. */
export interface GenericCaptureExtract {
  title: string;
  description: string;
}
export type ExtractKind =
  | 'achievement'
  | 'academic'
  | 'school_project'
  | 'home_project'
  | 'sports_subscription';
export type ExtractResult<K extends ExtractKind> =
  | { ok: true;  data:
        K extends 'achievement'      ? AchievementExtract :
        K extends 'academic'         ? AcademicExtract :
        K extends 'school_project'   ? SchoolProjectExtract :
        GenericCaptureExtract }
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

// ── Home Practice · Materials describe (Slice 7d) ───────────────────

export interface DescribeMaterialArgs {
  files: File[];          // 1-4 image files (PDFs can't be sent to Claude vision via this route)
  title?: string;
  subject?: string;
  kidNames?: string[];
}

export interface DescribeMaterialResult {
  description: string;
  skipped: boolean;
  error?: string;
}

/** Generate a parent-friendly description for a study material upload.
 *  Returns `skipped: true` when the AI key is absent on this preview;
 *  caller should let the parent fall back to typing the description. */
export async function describeMaterial(args: DescribeMaterialArgs): Promise<DescribeMaterialResult> {
  try {
    if (args.files.length === 0) {
      return { description: '', skipped: false, error: 'Add an image-mode material first.' };
    }
    const imageBase64s: string[] = [];
    let mediaType = 'image/jpeg';
    for (const f of args.files.slice(0, 4)) {
      // Skip non-image files (PDFs etc.) — the route only accepts images.
      if (!f.type.startsWith('image/')) continue;
      const { base64, mediaType: mt } = await fileToAiBase64(f);
      imageBase64s.push(base64);
      mediaType = mt;
    }
    if (imageBase64s.length === 0) {
      return { description: '', skipped: false, error: 'AI describe currently supports image materials only — type a quick description below.' };
    }
    const res = await fetch('/api/sparks/ai/describe-material', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64s,
        mediaType,
        title: args.title,
        subject: args.subject,
        kidNames: args.kidNames,
      }),
    });
    if (!res.ok) {
      return { description: '', skipped: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data?.skipped) return { description: '', skipped: true };
    return { description: String(data?.description || '').trim(), skipped: false };
  } catch (e) {
    return { description: '', skipped: false, error: e instanceof Error ? e.message : 'Material describe failed' };
  }
}

// ── Home Revisions (Slice 7) ─────────────────────────────────────────

export type RevisionMode = 'answers' | 'questions';

/** Slice 7i · structured per-question breakdown returned alongside the
 *  scalar score. UI renders this as Strengths / Areas to revisit /
 *  full Q-by-Q coverage. Legacy `notes` is kept as a fallback summary. */
export interface RevisionStructured {
  coverage: { read: number; total: number };
  strengths: string[];
  areas: Array<{
    question_ref?: string;
    topic: string;
    what_happened: string;
    tip?: string;
  }>;
  qbq: Array<{
    question_ref: string;
    topic: string;
    status: 'correct' | 'partial' | 'wrong';
  }>;
}

export interface RevisionScore {
  mode: RevisionMode;
  subject: string;
  gradeLevel: string;
  /** 0-100 in answers mode; 0 in questions mode. */
  score: number;
  breakdown: { correct: number; partial: number; wrong: number };
  notes: string;
  /** Populated in questions mode — verbatim questions Claude read off the page. */
  parsedQuestions: string[];
  /** Slice 7i · structured per-question breakdown (answers mode only). */
  structured?: RevisionStructured;
}

export interface ScoreRevisionArgs {
  files: File[];
  kidName: string;
  /** 'answers' (default) = score the work · 'questions' = parse the page. */
  mode?: RevisionMode;
  focusSubjects?: string[];
  /** Question paper / worksheet page URLs so the AI marks the answers
   *  against the real questions (Scanning 2.0 · PR 5). */
  questionPaperUrls?: string[];
}

/** Re-evaluate ALREADY-uploaded work (no re-capture): the server fetches the
 *  existing answer images + question paper by URL and re-scores with the
 *  kid/parent clarification. Powers the revision re-evaluation chat. */
export interface ReEvaluateRevisionArgs {
  imageUrls: string[];
  kidName: string;
  clarification: string;
  questionPaperUrls?: string[];
  focusSubjects?: string[];
}

/** Normalise a raw /revision-score response into a safe RevisionScore.
 *  Shared by scoreRevision (fresh files) + reEvaluateRevision (URLs). */
export function normalizeRevisionScore(data: unknown): RevisionScore {
  const d = (data ?? {}) as Record<string, unknown>;
  const rawStructured = d.structured as Record<string, unknown> | undefined;
  const cov = rawStructured?.coverage as Record<string, unknown> | undefined;
  const structured: RevisionStructured | undefined = rawStructured && typeof rawStructured === 'object'
    ? {
        coverage: { read: Number(cov?.read ?? 0), total: Number(cov?.total ?? 0) },
        strengths: Array.isArray(rawStructured.strengths)
          ? (rawStructured.strengths as unknown[]).filter((s): s is string => typeof s === 'string')
          : [],
        areas: Array.isArray(rawStructured.areas)
          ? (rawStructured.areas as unknown[])
              .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
              .map((a) => ({
                question_ref: typeof a.question_ref === 'string' ? a.question_ref : undefined,
                topic: String(a.topic ?? ''),
                what_happened: String(a.what_happened ?? ''),
                tip: typeof a.tip === 'string' && a.tip.length > 0 ? a.tip : undefined,
              }))
              .filter((a) => a.topic.length > 0 && a.what_happened.length > 0)
          : [],
        qbq: Array.isArray(rawStructured.qbq)
          ? (rawStructured.qbq as unknown[])
              .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
              .map((q) => ({
                question_ref: String(q.question_ref ?? ''),
                topic: String(q.topic ?? ''),
                status: (q.status === 'correct' || q.status === 'partial' || q.status === 'wrong')
                  ? q.status as 'correct' | 'partial' | 'wrong'
                  : 'partial',
              }))
              .filter((q) => q.question_ref.length > 0)
          : [],
      }
    : undefined;
  return {
    mode: (d.mode === 'questions' ? 'questions' : 'answers') as RevisionMode,
    subject: String(d.subject ?? 'Other'),
    gradeLevel: String(d.gradeLevel ?? ''),
    score: Number(d.score ?? 0),
    breakdown: {
      correct: Number((d.breakdown as Record<string, unknown>)?.correct ?? 0),
      partial: Number((d.breakdown as Record<string, unknown>)?.partial ?? 0),
      wrong: Number((d.breakdown as Record<string, unknown>)?.wrong ?? 0),
    },
    notes: String(d.notes ?? ''),
    parsedQuestions: Array.isArray(d.parsedQuestions) ? (d.parsedQuestions as string[]) : [],
    ...(structured ? { structured } : {}),
  };
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
        mode: args.mode ?? 'answers',
        focusSubjects: args.focusSubjects,
        questionPaperUrls: args.questionPaperUrls,
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    return { ok: true, data: normalizeRevisionScore(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Revision score failed' };
  }
}

/** Re-score already-uploaded work with a clarification — no re-capture. The
 *  server fetches the existing answer + question-paper images by URL. */
export async function reEvaluateRevision(
  args: ReEvaluateRevisionArgs,
): Promise<{ ok: true; data: RevisionScore } | { ok: false; skipped?: boolean; error?: string }> {
  try {
    const imageUrls = args.imageUrls.filter((u) => typeof u === 'string' && u);
    if (imageUrls.length === 0) return { ok: false, error: 'No work to re-evaluate' };
    const res = await fetch('/api/sparks/ai/revision-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrls,
        questionPaperUrls: args.questionPaperUrls,
        clarification: args.clarification,
        kidName: args.kidName,
        mode: 'answers',
        focusSubjects: args.focusSubjects,
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data?.skipped) return { ok: false, skipped: true };
    return { ok: true, data: normalizeRevisionScore(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Re-evaluation failed' };
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
