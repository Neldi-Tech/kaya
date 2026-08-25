// Timeline 2.0 · Note Cards (approved design v2 §3, 2026-08-25).
//
// A day's reflection or diary note, typeset on a themed keepsake card —
// the NOTE is the star, statistics appear nowhere. Rendered as an SVG
// string (variable height for long notes), previewed via a data URL and
// exported as a retina PNG — the same client-side rail Shine Cards and
// Greeting Cards ship on. Locked diary pages never reach this module:
// callers exclude them at the data-mapping layer.

export type NoteTheme = 'classic' | 'scrapbook' | 'starry' | 'sunshine';

export const NOTE_THEMES: Array<{ id: NoteTheme; label: string; emoji: string }> = [
  { id: 'classic', label: 'Classic', emoji: '🕊' },
  { id: 'scrapbook', label: 'Scrapbook', emoji: '🎀' },
  { id: 'starry', label: 'Starry', emoji: '🌙' },
  { id: 'sunshine', label: 'Sunshine', emoji: '🌻' },
];

/** Everything the card needs — pre-localised by the caller. */
export interface NoteCardData {
  kidName: string;       // author's first name
  surfaceLabel: string;  // "My Reflection" / "Tafakari yangu" / "My Diary" …
  dateLabel: string;     // "MON · 04-Aug-2026"
  dateKey: string;       // YYYY-MM-DD (filenames, print handoff)
  feeling?: string;      // emoji
  text: string;          // the note, verbatim (parent may trim the card copy)
  theme: NoteTheme;
}

interface Palette {
  bg: string; edge: string; name: string; date: string; text: string;
  accent: string; rule: string; footer: string; brand: string;
  decor: string; stars?: boolean; washi?: boolean; sun?: boolean;
}

const PALETTES: Record<NoteTheme, Palette> = {
  classic: {
    bg: '#FFFBF5', edge: '#EADFCB', name: '#7A2E5C', date: '#5A6488',
    text: '#0F1F44', accent: '#C05299', rule: '#F5B301', footer: '#5A6488',
    brand: '#C05299', decor: '🕊',
  },
  scrapbook: {
    bg: '#FFFFFF', edge: '#F3D9A5', name: '#7A2E5C', date: '#5A6488',
    text: '#0F1F44', accent: '#E58BC0', rule: '#E58BC0', footer: '#5A6488',
    brand: '#C05299', decor: '🎀', washi: true,
  },
  starry: {
    bg: '#131F3F', edge: '#2A3763', name: '#FFD9F0', date: '#93A0C8',
    text: '#F2EFFF', accent: '#F5B301', rule: '#F5B301', footer: '#93A0C8',
    brand: '#F5B301', decor: '🌙', stars: true,
  },
  sunshine: {
    bg: '#FFE29A', edge: '#F5B301', name: '#7A4A00', date: '#8A6100',
    text: '#4A3200', accent: '#E36F00', rule: '#E36F00', footer: '#8A6100',
    brand: '#B4581B', decor: '🌻', sun: true,
  },
};

/** Read-only palette accessor — the A5 print route styles its sheets
 *  with the same colours the card SVG uses. */
export function notePalette(theme: NoteTheme): Readonly<Palette> {
  return PALETTES[theme];
}

const W = 680;
const PAD = 44;
const LINE_H = 34;
const MAX_CARD_LINES = 18; // longer notes ellipsize — the A5 PDF carries it all

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Word-wrap into ≤maxLines lines of ≤maxChars, ellipsizing the last. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(' ').length;
  if (used < text.replace(/\s+/g, ' ').trim().length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

export function noteCardSvg(d: NoteCardData): string {
  const p = PALETTES[d.theme];
  const lines = wrap(d.text, 42, MAX_CARD_LINES);
  const bodyTop = 196;
  const footTop = bodyTop + Math.max(lines.length, 3) * LINE_H + 26;
  const H = footTop + 64;

  const decorBits: string[] = [];
  if (p.stars) {
    const seeds = [[70, 40], [200, 26], [360, 44], [520, 30], [620, 52], [120, 64], [460, 62]];
    for (const [x, y] of seeds) {
      decorBits.push(`<text x="${x}" y="${y}" font-size="13" fill="${p.accent}" opacity="0.8">✦</text>`);
    }
  }
  if (p.washi) {
    decorBits.push(`<rect x="-24" y="26" width="130" height="26" rx="4" fill="#FFE9F5" opacity="0.9" transform="rotate(-18 40 40)"/>`);
    decorBits.push(`<rect x="${W - 106}" y="20" width="130" height="26" rx="4" fill="#FFF3D6" opacity="0.9" transform="rotate(14 ${W - 40} 33)"/>`);
  }
  if (p.sun) {
    decorBits.push(`<text x="${W - 76}" y="58" font-size="34">☀️</text>`);
  }

  const body = lines.map((ln, i) =>
    `<text x="${PAD}" y="${bodyTop + i * LINE_H}" font-family="Lato, Georgia, serif" font-style="italic" font-size="22" fill="${p.text}">${esc(ln)}</text>`).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="26" fill="${p.bg}"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="23" fill="none" stroke="${p.edge}" stroke-width="2.5"/>
  ${decorBits.join('\n  ')}
  <text x="${PAD}" y="96" font-size="42">${esc(d.feeling || '📝')}</text>
  <text x="112" y="80" font-family="Nunito, Avenir Next, sans-serif" font-weight="900" font-size="25" fill="${p.name}">${esc(d.kidName)} · ${esc(d.surfaceLabel)}</text>
  <text x="112" y="104" font-family="Nunito, Avenir Next, sans-serif" font-weight="700" font-size="15" fill="${p.date}">${esc(d.dateLabel)}</text>
  <rect x="${PAD}" y="132" width="220" height="3" rx="1.5" fill="${p.rule}"/>
  <text x="${PAD - 6}" y="${bodyTop - 26}" font-family="Georgia, serif" font-size="52" fill="${p.accent}">“</text>
  ${body}
  <line x1="${PAD}" y1="${footTop}" x2="${W - PAD}" y2="${footTop}" stroke="${p.edge}" stroke-width="1.5"/>
  <text x="${PAD}" y="${footTop + 34}" font-family="Nunito, Avenir Next, sans-serif" font-weight="800" font-size="14" fill="${p.footer}">Made with <tspan fill="${p.brand}" font-weight="900">Kaya</tspan> 💛</text>
  <text x="${W - PAD}" y="${footTop + 34}" text-anchor="end" font-family="Nunito, Avenir Next, sans-serif" font-weight="800" font-size="14" fill="${p.footer}">ourkaya.com</text>
</svg>`;
}

export function noteCardSvgDataUrl(d: NoteCardData): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(noteCardSvg(d))}`;
}

/** SVG → retina PNG blob (2×), the Shine-Card export pattern. */
export async function noteCardPngBlob(d: NoteCardData): Promise<Blob> {
  const svg = noteCardSvg(d);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 720);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg-load-failed'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = height * 2;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no-canvas');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, W, height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
    if (!blob) throw new Error('png-failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function noteFilename(d: NoteCardData): string {
  return `Kaya-Note-${d.kidName.replace(/\s+/g, '')}-${d.dateKey}.png`;
}

export async function downloadNoteCard(d: NoteCardData): Promise<void> {
  const blob = await noteCardPngBlob(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = noteFilename(d);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Native share with PNG when the device supports it; false = caller
 *  should fall back (e.g. to wa.me text). AbortError = user closed. */
export async function shareNoteCard(d: NoteCardData): Promise<boolean> {
  const blob = await noteCardPngBlob(d);
  const file = new File([blob], noteFilename(d), { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: `${d.kidName} · ${d.surfaceLabel}` }); }
    catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
    return true;
  }
  return false;
}

/** WhatsApp text fallback (wa.me carries no images). */
export function waNoteText(d: NoteCardData): string {
  return `*${d.kidName} · ${d.surfaceLabel}*\n${d.feeling ? `${d.feeling} ` : ''}${d.dateLabel}\n\n_"${d.text}"_\n\n— Made with Kaya 💛 ourkaya.com`;
}

// Remembered theme, per person (the Shine-Card idiom).
export function rememberedNoteTheme(uid: string): NoteTheme {
  try {
    const t = window.localStorage.getItem(`kayaNoteTheme:${uid}`) as NoteTheme | null;
    if (t && PALETTES[t]) return t;
  } catch { /* private mode */ }
  return 'classic';
}
export function rememberNoteTheme(uid: string, theme: NoteTheme): void {
  try { window.localStorage.setItem(`kayaNoteTheme:${uid}`, theme); } catch { /* private mode */ }
}

// ── A5 print handoff (the note-print route reads this) ─────────────
const PRINT_KEY = 'kaya.notePrint.v1';

export interface NotePrintPayload {
  title: string;            // cover title for multi-note books
  theme: NoteTheme;
  notes: Array<Omit<NoteCardData, 'theme'>>;
}

export function stashNotesForPrint(payload: NotePrintPayload): void {
  try { window.localStorage.setItem(PRINT_KEY, JSON.stringify(payload)); } catch { /* full */ }
}
export function readNotesForPrint(): NotePrintPayload | null {
  try {
    const raw = window.localStorage.getItem(PRINT_KEY);
    return raw ? (JSON.parse(raw) as NotePrintPayload) : null;
  } catch { return null; }
}
