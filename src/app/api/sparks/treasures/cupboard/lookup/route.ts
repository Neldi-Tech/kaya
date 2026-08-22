// Kaya Sparks · Treasures 2.0 — 🗄 Cupboard lookups (C2 · D28 · D30).
//
// "Names never get written wrong." A title comes from a lookup or from
// Kaya's read of the front face — never from a child's typing when a
// better source exists. Three actions, all server-side (no CORS, no
// keys in the browser):
//
//   isbn    · EAN-13 starting 978/979 (= ISBN) → Open Library, then
//             Google Books. Gives title · author · cover · pages · year.
//   upc     · any other EAN/UPC → best-effort UPC DB. The barcode is above
//             all the IDENTITY (D29 dedupe); the words come from the box.
//   vision  · a photo of the cover / the box → Kaya reads title + author
//             (books) or title + "Ages 8+ · 2–6 players · 30 min" (games),
//             then the title is looked up to CANONICALISE it.
//
// Every action degrades to { found: false } — never an error that blocks
// a scan. The sheet then offers the next tier (front face → manual ⚠).

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
const GOOGLE_BOOKS_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';

const FETCH_TIMEOUT_MS = 6000;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const GAME_KINDS = ['party', 'strategy', 'cards', 'puzzle', 'outdoor', 'other'];

interface BookHit {
  name: string;
  author?: string;
  pages?: number;
  year?: number;
  publisher?: string;
  coverUrl?: string;
  isbn?: string;
  ageMin?: number;
  /** D43 · "What it's about" — ~2 sentences, spoiler-safe. */
  summary?: string;
  summarySource?: 'googlebooks' | 'openlibrary' | 'kaya';
}

/** D43 · trim a publisher blurb to ~2 sentences, strip HTML. */
function trimBlurb(raw: unknown, maxChars = 320): string {
  const t = String(raw || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
  let out = '';
  for (const sen of sentences) { if ((out + sen).length > maxChars && out) break; out += sen; if (out.split(/[.!?]\s/).length >= 2 && out.length > 120) break; }
  out = out.trim();
  if (!out) out = t.slice(0, maxChars);
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).trim()}…` : out;
}

// ── Helpers ─────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

/** Digits only; ISBN-10 → ISBN-13. Returns '' when it isn't a code. */
function normaliseCode(raw: string): string {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const core = `978${s.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
    return core + String((10 - (sum % 10)) % 10);
  }
  if (s.length === 13 && /^\d{13}$/.test(s)) return s;
  if (s.length === 12 && /^\d{12}$/.test(s)) return s;      // UPC-A
  if (s.length === 8 && /^\d{8}$/.test(s)) return s;        // EAN-8 / UPC-E
  return '';
}

const isIsbnCode = (code: string) => code.length === 13 && /^97[89]/.test(code);

function yearOf(s: unknown): number | undefined {
  const m = String(s || '').match(/(1[5-9]\d\d|20\d\d)/);
  return m ? Number(m[1]) : undefined;
}

function httpsify(u: unknown): string | undefined {
  const s = str(u, 600);
  if (!s) return undefined;
  return s.replace(/^http:\/\//, 'https://');
}

// ── Books ───────────────────────────────────────────────────────────

async function openLibraryByIsbn(isbn: string): Promise<BookHit | null> {
  const data = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`) as
    Record<string, { title?: string; authors?: Array<{ name?: string }>; number_of_pages?: number; publish_date?: string; publishers?: Array<{ name?: string }>; cover?: { medium?: string; large?: string } }> | null;
  const b = data?.[`ISBN:${isbn}`];
  if (!b?.title) return null;
  // D43 · the blurb lives on the WORK, one more keyless call (best-effort).
  let summary = '';
  try {
    const ed = await fetchJson(`https://openlibrary.org/isbn/${isbn}.json`) as { works?: Array<{ key?: string }> } | null;
    const wk = ed?.works?.[0]?.key;
    if (wk) {
      const w = await fetchJson(`https://openlibrary.org${wk}.json`) as { description?: string | { value?: string } } | null;
      const d = typeof w?.description === 'string' ? w.description : w?.description?.value;
      summary = trimBlurb(d);
    }
  } catch { summary = ''; }
  return {
    name: str(b.title, 160),
    ...(summary ? { summary, summarySource: 'openlibrary' as const } : {}),
    author: b.authors?.map((a) => str(a?.name, 80)).filter(Boolean).slice(0, 2).join(', ') || undefined,
    pages: Number(b.number_of_pages) > 0 ? Number(b.number_of_pages) : undefined,
    year: yearOf(b.publish_date),
    publisher: str(b.publishers?.[0]?.name, 80) || undefined,
    coverUrl: httpsify(b.cover?.medium || b.cover?.large),
    isbn,
  };
}

type GVolume = { volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; pageCount?: number; publishedDate?: string; publisher?: string; description?: string; imageLinks?: { thumbnail?: string; smallThumbnail?: string }; industryIdentifiers?: Array<{ type?: string; identifier?: string }> } };

function fromGoogle(v: GVolume | undefined, isbn?: string): BookHit | null {
  const vi = v?.volumeInfo;
  if (!vi?.title) return null;
  const id13 = vi.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier;
  return {
    name: str(vi.title, 160),
    author: vi.authors?.map((a) => str(a, 80)).filter(Boolean).slice(0, 2).join(', ') || undefined,
    pages: Number(vi.pageCount) > 0 ? Number(vi.pageCount) : undefined,
    year: yearOf(vi.publishedDate),
    publisher: str(vi.publisher, 80) || undefined,
    coverUrl: httpsify(vi.imageLinks?.thumbnail || vi.imageLinks?.smallThumbnail),
    isbn: isbn || (id13 ? normaliseCode(id13) : undefined) || undefined,
    ...(trimBlurb(vi.description) ? { summary: trimBlurb(vi.description), summarySource: 'googlebooks' as const } : {}),
  };
}

async function googleBooks(q: string, isbn?: string): Promise<BookHit | null> {
  const key = GOOGLE_BOOKS_KEY ? `&key=${encodeURIComponent(GOOGLE_BOOKS_KEY)}` : '';
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=3${key}`) as { items?: GVolume[] } | null;
  return fromGoogle(data?.items?.[0], isbn);
}

async function lookupIsbn(isbn: string): Promise<{ hit: BookHit | null; source: string }> {
  const ol = await openLibraryByIsbn(isbn);
  if (ol) return { hit: ol, source: 'openlibrary' };
  const g = await googleBooks(`isbn:${isbn}`, isbn);
  if (g) return { hit: g, source: 'googlebooks' };
  return { hit: null, source: 'none' };
}

/** Rough similarity so a vision read is only "canonicalised" to a result
 *  that is actually the same book. */
function similar(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const x = n(a); const y = n(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const xs = new Set(x.split(' ')); const ys = y.split(' ');
  const common = ys.filter((w) => w.length > 2 && xs.has(w)).length;
  return common >= Math.max(2, Math.ceil(Math.min(xs.size, ys.length) * 0.6));
}

// ── Games (UPC best-effort) ─────────────────────────────────────────

async function lookupUpc(code: string): Promise<{ name?: string; source: string }> {
  const data = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`) as { items?: Array<{ title?: string; brand?: string }> } | null;
  const it = data?.items?.[0];
  const title = str(it?.title, 160);
  if (title) return { name: title, source: 'upcitemdb' };
  return { source: 'none' };
}

// ── Vision (front face) ─────────────────────────────────────────────

const VISION_SYSTEM = `You read the FRONT of a book or a board/card game box from a photo, for a family app that catalogues what it owns.

Return JSON:
{
  "kind": "book" | "game" | "unknown",
  "title": string,          // the main title exactly as printed (no subtitle, no series tagline); "" if unreadable
  "author": string,         // books only — author name(s) as printed; "" if none visible
  "ageMin": number,         // games only — the printed "Ages 8+" number; 0 if not visible
  "playersMin": number,     // games only — 0 if not visible
  "playersMax": number,     // games only — 0 if not visible (same as playersMin if a single number)
  "minutes": number,        // games only — the printed play time in minutes (use the upper number of a range); 0 if not visible
  "gameKind": "party" | "strategy" | "cards" | "puzzle" | "outdoor" | "other" | "",   // games only — your best classification
  "confidence": number      // 0..1 — how sure you are of the TITLE
}

Rules:
- Read what is printed. Never invent a title, author, age or player count that is not visible.
- For games, the age / players / minutes icons are usually printed on the front or side of the box; read them when visible.
- If the photo is not a book cover or a game box (a face, a room, a screen), return kind "unknown" with empty strings and 0s.`;

const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'author', 'ageMin', 'playersMin', 'playersMax', 'minutes', 'gameKind', 'confidence'],
  properties: {
    kind: { type: 'string', enum: ['book', 'game', 'unknown'] },
    title: { type: 'string' },
    author: { type: 'string' },
    ageMin: { type: 'number' },
    playersMin: { type: 'number' },
    playersMax: { type: 'number' },
    minutes: { type: 'number' },
    gameKind: { type: 'string', enum: ['party', 'strategy', 'cards', 'puzzle', 'outdoor', 'other', ''] },
    confidence: { type: 'number' },
  },
} as const;

interface VisionRead {
  kind: 'book' | 'game' | 'unknown';
  title: string; author: string;
  ageMin: number; playersMin: number; playersMax: number; minutes: number;
  gameKind: string; confidence: number;
}

async function readFrontFace(imageBase64: string, mediaType: ImgMedia, hintKind: string): Promise<VisionRead | null> {
  if (!anthropic) return null;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 600,
      system: [{ type: 'text', text: VISION_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: VISION_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: hintKind === 'game'
            ? 'This should be the front of a board or card game box. Read it.'
            : hintKind === 'book'
              ? 'This should be the front cover of a book. Read it.'
              : 'Read the front of this book or game box.' },
        ],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const j = JSON.parse(text.text) as VisionRead;
    return j;
  } catch { return null; }
}

// ── D43 · Kaya's words — when no library has a blurb ─────────────────

async function kayaSummary(title: string, author: string, ageYears?: number): Promise<string> {
  if (!anthropic || !title) return '';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 220,
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: 'You write a 1–2 sentence, spoiler-free "what this book is about" line for a family app, pitched for a child reader. If you are not confident you know the book, describe what KIND of book it most likely is from the title/author and say "probably" — never invent plot facts. Plain sentences, no preamble, no quotes.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Book: "${title}"${author ? ` by ${author}` : ''}.${ageYears ? ` Reader is about ${ageYears}.` : ' Reader is a child of about 8–10.'}` }],
    });
    const t = resp.content.find((b) => b.type === 'text');
    return t && t.type === 'text' ? trimBlurb(t.text, 300) : '';
  } catch { return ''; }
}

/** Fill in a summary if the libraries had none — best-effort, never blocks. */
async function withSummary(hit: BookHit): Promise<BookHit> {
  if (hit.summary) return hit;
  const s = await kayaSummary(hit.name, hit.author || '');
  return s ? { ...hit, summary: s, summarySource: 'kaya' } : hit;
}

// ── Route ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }
  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string } | undefined;
  if (!user?.familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = str(body.action, 10);

  // ── barcode → words ──
  if (action === 'isbn' || action === 'upc' || action === 'code') {
    const code = normaliseCode(str(body.code, 40));
    if (!code) return NextResponse.json({ found: false, reason: 'not-a-code' });
    if (isIsbnCode(code) || action === 'isbn') {
      const { hit, source } = await lookupIsbn(code);
      if (hit) return NextResponse.json({ found: true, kind: 'book', code, source, book: await withSummary(hit) });
      // An ISBN-looking code with no match still identifies the item.
      return NextResponse.json({ found: false, kind: 'book', code, source: 'none' });
    }
    const g = await lookupUpc(code);
    if (g.name) return NextResponse.json({ found: true, kind: 'game', code, source: g.source, name: g.name });
    return NextResponse.json({ found: false, kind: 'game', code, source: 'none' });
  }

  // ── D43 · "What it's about" on demand (parent: rewrite for a reader's age) ──
  if (action === 'summary') {
    const title = str(body.title, 160); const author = str(body.author, 120);
    const age = Number(body.ageYears); const ageYears = Number.isFinite(age) && age > 0 && age < 30 ? Math.round(age) : undefined;
    if (!title) return NextResponse.json({ found: false, reason: 'no-title' });
    // Libraries first (cheap), then Kaya's words.
    const g = await googleBooks(`intitle:${title}${author ? ` inauthor:${author}` : ''}`);
    if (g && similar(g.name, title) && g.summary && !ageYears) return NextResponse.json({ found: true, summary: g.summary, summarySource: g.summarySource });
    const s = await kayaSummary(title, author, ageYears);
    if (s) return NextResponse.json({ found: true, summary: s, summarySource: 'kaya' });
    return NextResponse.json({ found: false, reason: anthropic ? 'no-summary' : 'vision-unavailable' });
  }

  // ── front face → words → canonical ──
  if (action === 'vision') {
    const imageBase64 = str(body.imageBase64, 12_000_000);
    const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(str(body.mediaType, 20))
      ? (str(body.mediaType, 20) as ImgMedia) : 'image/jpeg';
    const hintKind = str(body.kind, 10);
    if (!imageBase64) return NextResponse.json({ found: false, reason: 'no-image' });
    if (!anthropic) return NextResponse.json({ found: false, reason: 'vision-unavailable' });

    const read = await readFrontFace(imageBase64, mediaType, hintKind);
    if (!read || read.kind === 'unknown' || !read.title.trim()) {
      return NextResponse.json({ found: false, reason: 'unreadable' });
    }
    const title = str(read.title, 160);
    if (read.kind === 'book') {
      // D28 · canonicalise: the read title is looked up; we only accept a
      // result that is recognisably the same book.
      const q = `intitle:${title}${read.author ? ` inauthor:${str(read.author, 80)}` : ''}`;
      const g = await googleBooks(q);
      if (g && similar(g.name, title)) {
        return NextResponse.json({ found: true, kind: 'book', nameSource: 'lookup', source: 'vision+googlebooks', book: await withSummary(g), confidence: read.confidence });
      }
      const book: BookHit = await withSummary({ name: title, author: str(read.author, 120) || undefined });
      return NextResponse.json({ found: true, kind: 'book', nameSource: 'vision', source: 'vision', book, confidence: read.confidence });
    }
    const game = {
      name: title,
      ageMin: read.ageMin > 0 ? Math.round(read.ageMin) : undefined,
      playersMin: read.playersMin > 0 ? Math.round(read.playersMin) : undefined,
      playersMax: read.playersMax > 0 ? Math.round(read.playersMax) : undefined,
      minutes: read.minutes > 0 ? Math.round(read.minutes) : undefined,
      gameKind: GAME_KINDS.includes(read.gameKind) ? read.gameKind : undefined,
    };
    return NextResponse.json({ found: true, kind: 'game', nameSource: 'vision', source: 'vision', game, confidence: read.confidence });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
