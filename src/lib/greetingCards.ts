// ✉️ Greeting Cards (Reminders 2.0, approved 22-Aug-2026 — Card Designs v2).
// One card per event OCCURRENCE (`{eventId}_{dateKey}`), built in the Card
// Studio, delivered by the greeting-cards cron (email / WhatsApp tap-to-send),
// shared everywhere (Moments · chat · WhatsApp · email · link · PNG), and
// readable on a public no-login page. Model + theming + SVG→PNG rendering +
// thin client wrappers around the Admin gateway `/api/reminders/cards`.
//
// PURE except the fetch wrappers at the bottom (same split as shineCards.ts).
// Server-side email HTML lives in greetingCardEmail.ts.

import type { GreetTo, ReminderType } from './reminders';
import { ordinal } from './reminders';

// ── Types ──────────────────────────────────────────────────────────────────

export type CardTheme = 'classic' | 'kitenge' | 'night' | 'bloom' | 'confetti' | 'safari' | 'ocean' | 'crayon';

export const CARD_THEMES: Array<{ id: CardTheme; label: string; emoji: string }> = [
  { id: 'classic', label: 'Golden Classic', emoji: '✨' },
  { id: 'kitenge', label: 'Kitenge', emoji: '🌺' },
  { id: 'night', label: 'Midnight Sparkle', emoji: '✦' },
  { id: 'bloom', label: 'Garden Bloom', emoji: '🌸' },
  { id: 'confetti', label: 'Confetti Pop', emoji: '🎈' },
  { id: 'safari', label: 'Safari Morning', emoji: '🦁' },
  { id: 'ocean', label: 'Ocean Breeze', emoji: '🌊' },
  { id: 'crayon', label: 'Crayon Kid', emoji: '🖍️' },
];

/** Accent swatches — all from existing Kaya tokens (kaya · brand · hive · pantry · pulse · house). */
export const CARD_ACCENTS = ['#D4A017', '#F39C2F', '#E85C5C', '#5B6CC8', '#3FAF9E', '#5BA88C', '#9B8EC4', '#1F2D3D'];

export interface StickerPack {
  id: string;
  label: string;
  stickers: string[];
  /** Locked packs unlock via the award rail (bonus innovation). */
  unlock?: { points: number; label: string };
}

export const STICKER_PACKS: StickerPack[] = [
  { id: 'party', label: 'Party', stickers: ['🎉', '🎈', '🎊', '🎁', '🎂', '🥳'] },
  { id: 'flowers', label: 'Flowers', stickers: ['🌹', '🌺', '🌸', '🌼', '🌷', '💐'] },
  { id: 'safari', label: 'Safari', stickers: ['🦁', '🐘', '🦒', '🌿', '🌳', '🦓'] },
  { id: 'kitenge', label: 'Kitenge', stickers: ['🪡', '🧵', '🌍', '☀️', '🥁', '🪘'] },
  { id: 'hearts', label: 'Love', stickers: ['❤️', '💛', '💜', '💞', '🥰', '😘'] },
  { id: 'sparkle', label: 'Sparkle', stickers: ['✨', '⭐', '🌟', '💫', '🎇', '🏆'] },
  { id: 'space', label: 'Space', stickers: ['🚀', '🪐', '🌙', '👩‍🚀', '🛸', '☄️'], unlock: { points: 300, label: 'Explorer' } },
  { id: 'dino', label: 'Dino', stickers: ['🦖', '🦕', '🌋', '🥚', '🦴', '🌈'], unlock: { points: 500, label: 'Dino' } },
  { id: 'unicorn', label: 'Magic', stickers: ['🦄', '🧚', '🪄', '🌈', '🔮', '🧜'], unlock: { points: 800, label: 'Magic' } },
];

export type CardStatus = 'draft' | 'ready' | 'pending_parent' | 'sent' | 'belated' | 'expired';
export type CardLang = 'en' | 'sw';

export interface CardLine {
  uid: string;
  name: string;
  text: string;
  at: number;
  /** Rendered in the warm italic "kid" style. */
  kid?: boolean;
}

export type DeliveryChannel = 'email' | 'whatsapp' | 'chat' | 'moments' | 'link' | 'download' | 'share' | 'nudge';

export interface CardDelivery {
  channel: DeliveryChannel;
  at: number;
  ok: boolean;
  to?: string;
  by?: string;
  error?: string;
  /** 'auto' = the cron · 'manual' = a person tapped. */
  mode?: 'auto' | 'manual';
}

export interface CardThanks {
  reaction?: string;
  text?: string;
  at: number;
}

export interface GreetingCard {
  id: string;          // `${eventId}_${dateKey}`
  familyId: string;
  eventId: string;
  dateKey: string;     // YYYY-MM-DD occurrence
  type: ReminderType;
  /** Spoken event title at that occurrence ("Mama Rose's 70th birthday"). */
  eventTitle: string;
  /** Nth (70, 25) when the event carries an originDate; drives headline copy. */
  nth?: number | null;
  honoree: GreetTo;
  theme: CardTheme;
  accent?: string;
  stickers: string[];
  photoUrl?: string;
  oneLiner: string;
  message: string;
  lines: CardLine[];
  lang: CardLang;
  signatureLine: string;
  signatureRoster?: string;
  status: CardStatus;
  authorUid: string;
  authorName: string;
  authorRole: 'parent' | 'helper' | 'kid';
  /** Rendered PNG uploaded by the client on save (chat / Moments / email image). */
  imageUrl?: string;
  /** Public no-login page token (shareTokens/{token}). */
  publicToken?: string;
  publicTokenAt?: number;
  /** Delivery idempotency — `${dateKey}:auto-email`, `${dateKey}:nudge-3`… */
  sentKeys?: string[];
  deliveries?: CardDelivery[];
  momentsPostId?: string;
  thanks?: CardThanks[];
  /** Kaya's untouched default (auto-send fallback). */
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const ONE_LINER_MAX = 70;
export const MESSAGE_MAX = 600;
export const LINE_MAX = 160;

export function cardIdFor(eventId: string, dateKey: string): string {
  return `${eventId.replace(/[^A-Za-z0-9:_-]/g, '_')}_${dateKey}`;
}

// ── Copy helpers ───────────────────────────────────────────────────────────

/** The front headline: "Happy 70th Birthday" · "Silver Anniversary" · "Congratulations". */
export function cardHeadline(type: ReminderType, nth: number | null | undefined, lang: CardLang, eventTitle?: string): string {
  const n = nth && nth > 0 ? nth : null;
  if (lang === 'sw') {
    if (type === 'birthday') return n ? `Heri ya kuzaliwa ya ${n}!` : 'Heri ya kuzaliwa!';
    if (type === 'anniversary') return n ? `Heri ya maadhimisho ya miaka ${n}` : 'Heri ya maadhimisho';
    return 'Hongera!';
  }
  if (type === 'birthday') return n ? `Happy ${ordinal(n)} Birthday` : 'Happy Birthday';
  if (type === 'anniversary') {
    if (n === 25) return 'Silver Anniversary';
    if (n === 50) return 'Golden Anniversary';
    if (n === 60) return 'Diamond Anniversary';
    return n ? `Happy ${ordinal(n)} Anniversary` : 'Happy Anniversary';
  }
  return eventTitle && /gradu/i.test(eventTitle) ? 'Congratulations' : (eventTitle ? 'Congratulations' : 'Celebrating you');
}

const HONORIFICS = new Set(['mama','baba','bibi','babu','mzee','uncle','aunt','auntie','aunty','grandma','grandpa','granny','nana','mr','mrs','ms','dr','cousin','coach','teacher','sir','madam','pastor','rev','shangazi','mjomba','dada','kaka','mwalimu']);
/** "Mama Rose" → "Mama Rose" (honorific kept), "Joseph Mwangi" → "Joseph". */
export function shortName(full: string | undefined): string {
  const raw = (full || '').trim();
  // Couples / pairs keep the whole name ("Aunt Alice and Uncle Prince").
  if (/\s(and|&|na)\s/i.test(raw)) return raw;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 2 && HONORIFICS.has(parts[0].toLowerCase().replace(/\.$/, ''))) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

export function typeEmoji(type: ReminderType): string {
  return type === 'birthday' ? '🎂' : type === 'anniversary' ? '💍' : '🎉';
}

/** Kaya's default one-liner when nobody drafted one (never embarrassing). */
export function defaultOneLiner(card: Pick<GreetingCard, 'type' | 'nth' | 'lang' | 'honoree'>): string {
  const first = shortName(card.honoree.name);
  if (card.lang === 'sw') {
    if (card.type === 'birthday') return `Siku njema kabisa kwako, ${first}. Tunakupenda!`;
    if (card.type === 'anniversary') return 'Upendo unaodumu — hongera sana.';
    return `Tunajivunia wewe, ${first}.`;
  }
  if (card.type === 'birthday') return card.nth ? `${card.nth} years of you — and we're so glad.` : `Here's to you, ${first} — today and always.`;
  if (card.type === 'anniversary') return card.nth ? `${card.nth} years, still choosing each other.` : 'Still choosing each other — happy anniversary.';
  return `We're so proud of you, ${first}.`;
}

export function defaultMessage(card: Pick<GreetingCard, 'type' | 'nth' | 'lang' | 'honoree'>, _signature?: string): string {
  void _signature; // the signature block is rendered separately (Elia, 22-Aug)
  const first = shortName(card.honoree.name);
  if (card.lang === 'sw') {
    return card.type === 'birthday'
      ? `Mpendwa ${first}, heri ya kuzaliwa! Tunakutakia furaha, afya na baraka tele. Tunakupenda sana.`
      : `Mpendwa ${first}, hongera sana! Tunakutakia kila la heri na upendo usioisha.`;
  }
  if (card.type === 'birthday') return `Dear ${first}, wishing you a day as wonderful as you are — full of laughter, cake and the people you love.`;
  if (card.type === 'anniversary') return `Dear ${first}, happy anniversary! Thank you for showing us what love that lasts looks like.`;
  return `Dear ${first}, congratulations! We're cheering for you today and always.`;
}

function escRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Splits "Dear X, rest…" into a greeting line + body, and strips a trailing
 *  "With love, {signature}." the author may have typed (the card signs itself). */
export function splitMessage(message: string, signatureLine: string): { greeting: string; body: string } {
  let m = (message || '').trim();
  if (signatureLine) {
    const sigRe = new RegExp(`\\s*(with love|kwa upendo|love|warmly|yours)[,\\s]*${escRe(signatureLine)}\\.?\\s*$`, 'i');
    m = m.replace(sigRe, '').trim();
  }
  const g = /^((?:Dear|Dearest|Mpendwa|Hi|Hello)\s[^,!\n]{0,60}[,!])\s*/i.exec(m);
  if (g) return { greeting: g[1].trim(), body: m.slice(g[0].length).trim() };
  return { greeting: '', body: m };
}

// ── Theme palettes (the 8 approved fronts) ────────────────────────────────

interface Palette {
  bg: string;          // base fill
  bg2?: string;        // gradient end (radial/linear)
  frame: string;
  ink: string;
  sub: string;
  accent: string;      // default accent (title + band)
  pattern?: 'stripes' | 'dots' | 'stars' | 'waves' | 'dashed' | 'horizon';
  dark?: boolean;
}

const PALETTES: Record<CardTheme, Palette> = {
  classic:  { bg: '#FFF7DD', bg2: '#FDFBF7', frame: '#D9C48C', ink: '#3D241A', sub: '#6B5636', accent: '#D4A017' },
  kitenge:  { bg: '#FFF8EC', frame: '#F39C2F', ink: '#1F2D3D', sub: '#5C6975', accent: '#F39C2F', pattern: 'stripes' },
  night:    { bg: '#101A33', bg2: '#3d5290', frame: '#3d5290', ink: '#F8F2E2', sub: '#E8DFC9', accent: '#F3D06A', pattern: 'stars', dark: true },
  bloom:    { bg: '#FFF4F1', bg2: '#FDE9E7', frame: '#E7A7B4', ink: '#4a2530', sub: '#7a4a55', accent: '#C2588F' },
  confetti: { bg: '#FFFBF4', frame: '#C9A5F0', ink: '#241a34', sub: '#5a4a72', accent: '#8b5cd6', pattern: 'dots' },
  safari:   { bg: '#FBF6EA', bg2: '#F2E3C6', frame: '#B98A4A', ink: '#2e2010', sub: '#5a4628', accent: '#B9812A', pattern: 'horizon' },
  ocean:    { bg: '#F4FBFA', bg2: '#CDEFF0', frame: '#3FAF9E', ink: '#0F3D44', sub: '#2c5f66', accent: '#3FAF9E', pattern: 'waves' },
  crayon:   { bg: '#FFFDF5', frame: '#F39C2F', ink: '#3D241A', sub: '#6b4a1a', accent: '#F39C2F', pattern: 'dashed' },
};

export function themePalette(theme: CardTheme): { bg: string; frame: string; ink: string; accent: string; dark: boolean } {
  const p = PALETTES[theme] || PALETTES.classic;
  return { bg: p.bg, frame: p.frame, ink: p.ink, accent: p.accent, dark: !!p.dark };
}

// ── SVG rendering (self-contained; emoji render natively) ─────────────────

const W = 680;
const FRONT_H = 900;

function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1,3}$/, '…');
  }
  return lines;
}

function defsFor(theme: CardTheme, p: Palette, accent: string): string {
  const out: string[] = [];
  if (p.bg2) {
    out.push(theme === 'night' || theme === 'ocean'
      ? `<radialGradient id="bg" cx="50%" cy="${theme === 'night' ? '110%' : '100%'}" r="90%"><stop offset="0" stop-color="${p.bg2}"/><stop offset="0.6" stop-color="${p.bg}"/></radialGradient>`
      : `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.bg2}"/></linearGradient>`);
  }
  if (p.pattern === 'dots') {
    out.push(`<pattern id="pat" width="46" height="52" patternUnits="userSpaceOnUse"><circle cx="10" cy="12" r="4" fill="#C9A5F0" opacity=".6"/><circle cx="30" cy="36" r="3" fill="${accent}" opacity=".55"/><circle cx="20" cy="50" r="2.5" fill="#5BA88C" opacity=".5"/></pattern>`);
  }
  if (p.pattern === 'stars') {
    out.push(`<pattern id="pat" width="64" height="70" patternUnits="userSpaceOnUse"><circle cx="14" cy="20" r="1.4" fill="#F3D06A"/><circle cx="44" cy="48" r="1" fill="#ffffff"/><circle cx="56" cy="12" r="0.9" fill="#F3D06A"/></pattern>`);
  }
  if (p.pattern === 'stripes') {
    out.push(`<pattern id="pat" width="72" height="60" patternUnits="userSpaceOnUse"><rect width="18" height="60" fill="#F39C2F"/><rect x="18" width="18" height="60" fill="#1F2D3D"/><rect x="36" width="18" height="60" fill="#E85C5C"/><rect x="54" width="18" height="60" fill="#FFF8EC"/><circle cx="9" cy="30" r="5" fill="#FFF8EC"/><circle cx="27" cy="30" r="5" fill="#FFF8EC"/><circle cx="45" cy="30" r="5" fill="#FFF8EC"/><circle cx="63" cy="30" r="5" fill="#1F2D3D"/></pattern>`);
  }
  if (p.pattern === 'waves') {
    out.push(`<pattern id="pat" width="90" height="80" patternUnits="userSpaceOnUse"><path d="M0 80 Q45 20 90 80" fill="none" stroke="${accent}" stroke-opacity=".25" stroke-width="3"/></pattern>`);
  }
  return out.length ? `<defs>${out.join('')}</defs>` : '';
}

function backgroundFor(theme: CardTheme, p: Palette, h: number): string {
  const fill = p.bg2 ? 'url(#bg)' : p.bg;
  let s = `<rect width="${W}" height="${h}" rx="28" fill="${fill}"/>`;
  if (p.pattern === 'dots' || p.pattern === 'stars') s += `<rect width="${W}" height="${h}" rx="28" fill="url(#pat)"/>`;
  if (p.pattern === 'stripes') s += `<rect x="0" y="0" width="${W}" height="60" fill="url(#pat)"/><rect x="0" y="${h - 60}" width="${W}" height="60" fill="url(#pat)"/>`;
  if (p.pattern === 'waves') s += `<rect x="0" y="${h - 150}" width="${W}" height="150" fill="url(#pat)"/>`;
  if (p.pattern === 'horizon') s += `<rect x="0" y="${Math.round(h * 0.66)}" width="${W}" height="${Math.round(h * 0.34)}" fill="#E8B45A" opacity=".3"/><line x1="0" y1="${Math.round(h * 0.66)}" x2="${W}" y2="${Math.round(h * 0.66)}" stroke="#B98A4A" stroke-opacity=".45" stroke-width="3" stroke-dasharray="10 8"/>`;
  // frame
  if (p.pattern === 'dashed') s += `<rect x="14" y="14" width="${W - 28}" height="${h - 28}" rx="22" fill="none" stroke="${p.frame}" stroke-width="6" stroke-dasharray="14 10"/>`;
  else if (p.pattern !== 'stripes') {
    s += `<rect x="22" y="22" width="${W - 44}" height="${h - 44}" rx="20" fill="none" stroke="${p.frame}" stroke-width="3" opacity=".8"/>`;
    if (theme === 'classic') s += `<rect x="32" y="32" width="${W - 64}" height="${h - 64}" rx="16" fill="none" stroke="#EADFC2" stroke-width="1.5"/>`;
  }
  return s;
}

const STICKER_SPOTS: Array<[number, number]> = [[592, 132], [88, 168], [92, 750], [588, 750], [104, 470], [576, 470]];

export interface CardSvgOptions {
  /** Include message + lines + signature + Kaya band under the front (share PNG). */
  full?: boolean;
  /** Text under the header, e.g. "12-Sep-2026". */
  dateLabel?: string;
}

/** The card as a self-contained SVG string. Front only by default; `full`
 *  appends the inside (message · co-sign lines · signature · Kaya band). */
export function cardSvg(card: GreetingCard, opts: CardSvgOptions = {}): string {
  const p = PALETTES[card.theme] || PALETTES.classic;
  const accent = card.accent || p.accent;
  const lang = card.lang || 'en';
  const headline = cardHeadline(card.type, card.nth, lang, card.eventTitle);
  const name = card.honoree.name || '';
  const oneLiner = card.oneLiner || defaultOneLiner(card);
  const olLines = wrap(oneLiner, 34, 3);
  const sigLine = card.signatureLine || '';
  const viaKaya = lang === 'sw' ? 'kupitia KAYA' : 'via KAYA';
  const topLabel = `${typeEmoji(card.type)} ${card.type === 'birthday' ? (lang === 'sw' ? 'SIKU YA KUZALIWA' : 'BIRTHDAY') : card.type === 'anniversary' ? 'ANNIVERSARY' : 'CELEBRATION'}${opts.dateLabel ? ' · ' + opts.dateLabel.toUpperCase() : ''}`;
  const nameLines = wrap(name, 26, 2);

  // Inside block (full) — greeting line · left-aligned body · co-sign lines ·
  // separated signature block · Kaya band (Elia, 22-Aug: "organised, separate from signature").
  let insideH = 0;
  let inside = '';
  if (opts.full) {
    const { greeting, body } = splitMessage(card.message || defaultMessage(card, sigLine), sigLine);
    const bodyLines = wrap(body, 50, 10);
    const lineBlocks = (card.lines || []).slice(0, 6).map((l) => ({ who: l.name, kid: !!l.kid, lines: wrap(l.text, 46, 2) }));
    const linesH = lineBlocks.reduce((a, b) => a + 28 + b.lines.length * 26, 0);
    const closing = lang === 'sw' ? 'Kwa upendo,' : 'With love,';
    insideH = 56 + (greeting ? 44 : 0) + bodyLines.length * 32 + (lineBlocks.length ? 34 + linesH : 0) + 40 + 56 + (card.signatureRoster ? 24 : 0) + 40 + 64;
    let y = FRONT_H + 56;
    inside += `<rect x="0" y="${FRONT_H}" width="${W}" height="${insideH}" fill="#FFFDF8"/>`;
    if (greeting) { inside += `<text x="64" y="${y}" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="26" font-weight="900" fill="#2b1d12">${esc(greeting)}</text>`; y += 44; }
    for (const ml of bodyLines) { inside += `<text x="64" y="${y}" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="21" font-weight="600" fill="#3D241A">${esc(ml)}</text>`; y += 32; }
    if (lineBlocks.length) {
      y += 6;
      inside += `<line x1="64" y1="${y}" x2="${W - 64}" y2="${y}" stroke="#E8DEC9" stroke-dasharray="6 6"/>`;
      y += 30;
      for (const b of lineBlocks) {
        inside += `<text x="64" y="${y}" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="1" fill="#5C6975">${esc(b.who.toUpperCase())}</text>`; y += 26;
        for (const t of b.lines) {
          inside += `<text x="64" y="${y}" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="19" font-weight="${b.kid ? '700' : '500'}" font-style="${b.kid ? 'italic' : 'normal'}" fill="${b.kid ? '#6b4a1a' : '#3D241A'}">${esc(t)}</text>`; y += 26;
        }
        y += 2;
      }
    }
    y += 14;
    inside += `<line x1="${W - 300}" y1="${y}" x2="${W - 64}" y2="${y}" stroke="${accent}" stroke-opacity=".5" stroke-width="2"/>`;
    y += 34;
    inside += `<text x="${W - 64}" y="${y}" text-anchor="end" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="#5C6975">${esc(closing)}</text>`;
    y += 34;
    inside += `<text x="${W - 64}" y="${y}" text-anchor="end" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="27" font-style="italic" font-weight="800" fill="#3D241A">${esc(sigLine)}</text>`;
    if (card.signatureRoster) { y += 24; inside += `<text x="${W - 64}" y="${y}" text-anchor="end" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="14" fill="#5C6975">${esc(card.signatureRoster)}</text>`; }
    const bandY = FRONT_H + insideH - 64;
    inside += `<rect x="0" y="${bandY}" width="${W}" height="64" fill="#1F2D3D"/>`;
    inside += `<text x="40" y="${bandY + 39}" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="16" fill="#FFF8EC">${esc(lang === 'sw' ? 'Imetumwa kwa ❤️ kupitia' : 'Sent with ❤️ via')} <tspan font-weight="900">KAYA</tspan> <tspan fill="#F39C2F">— ${esc(lang === 'sw' ? 'mtandao wa familia' : 'the family network')}</tspan></text>`;
    inside += `<text x="${W - 40}" y="${bandY + 39}" text-anchor="end" font-family="Nunito, Lato, Helvetica, Arial, sans-serif" font-size="15" fill="#FFF8EC">ourkaya.com</text>`;
  }
  const H = FRONT_H + insideH;

  const font = 'Nunito, Lato, Helvetica, Arial, sans-serif';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += defsFor(card.theme, p, accent);
  // front bg clipped to FRONT_H
  s += backgroundFor(card.theme, p, FRONT_H);
  const topY = p.pattern === 'stripes' ? 100 : 70;
  s += `<text x="48" y="${topY}" font-family="${font}" font-size="15" font-weight="800" letter-spacing="2.4" fill="${p.sub}">${esc(topLabel)}</text>`;
  const footY = p.pattern === 'stripes' ? FRONT_H - 84 : FRONT_H - 52;
  // Vertically centre the content block between the top label and the footer.
  const heroEmoji = card.stickers[0] && card.type === 'event' ? card.stickers[0] : typeEmoji(card.type);
  const blockH = 120 + 64 + nameLines.length * 36 + 14 + olLines.length * 32 + (card.photoUrl ? 178 : 0);
  const avail = footY - 30 - (topY + 30);
  let y = topY + 30 + Math.max(0, (avail - blockH) / 2);
  s += `<text x="${W / 2}" y="${y + 96}" text-anchor="middle" font-size="100">${esc(heroEmoji)}</text>`;
  y += 120 + 50;
  s += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="44" font-weight="900" fill="${p.dark ? p.ink : accent}">${esc(headline)}</text>`;
  y += 44;
  for (const nl of nameLines) { s += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="30" font-weight="800" fill="${p.ink}">${esc(nl)}</text>`; y += 36; }
  y += 14;
  for (let i = 0; i < olLines.length; i++) {
    const t = (i === 0 ? '“' : '') + olLines[i] + (i === olLines.length - 1 ? '”' : '');
    s += `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${font}" font-size="24" font-style="italic" font-weight="700" fill="${p.ink}" opacity=".92">${esc(t)}</text>`; y += 32;
  }
  if (card.photoUrl) {
    const cy = y + 90;
    s += `<defs><clipPath id="ph"><circle cx="${W / 2}" cy="${cy}" r="72"/></clipPath></defs>`;
    s += `<circle cx="${W / 2}" cy="${cy}" r="76" fill="#fff" opacity=".9"/>`;
    s += `<image href="${esc(card.photoUrl)}" x="${W / 2 - 72}" y="${cy - 72}" width="144" height="144" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>`;
  }
  // stickers — corners + mid, never over the label/footer
  const stk = (card.stickers || []).slice(0, 6);
  stk.forEach((e, i) => {
    if (i === 0 && card.type === 'event') return; // used as hero
    const [sx, sy] = STICKER_SPOTS[i % STICKER_SPOTS.length];
    s += `<text x="${sx}" y="${sy}" text-anchor="middle" font-size="40">${esc(e)}</text>`;
  });
  // footer: signature + via KAYA
  s += `<text x="48" y="${footY}" font-family="${font}" font-size="18" font-style="italic" font-weight="700" fill="${p.ink}" opacity=".9">${esc(sigLine)}</text>`;
  s += `<text x="${W - 48}" y="${footY}" text-anchor="end" font-family="${font}" font-size="16" font-weight="900" letter-spacing="1.5" fill="${p.dark ? '#F3D06A' : p.ink}" opacity=".85">${esc(viaKaya)}</text>`;
  s += inside;
  s += '</svg>';
  return s;
}

export function cardSvgDataUrl(card: GreetingCard, opts: CardSvgOptions = {}): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(cardSvg(card, opts))}`;
}

/** SVG → PNG blob via canvas (2× for crisp sharing). Client-only. */
export async function cardPngBlob(card: GreetingCard, opts: CardSvgOptions = {}): Promise<Blob> {
  const svg = cardSvg(card, opts);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not render the card.')); img.src = url; });
    const m = /height="(\d+)"/.exec(svg);
    const h = m ? parseInt(m[1], 10) : FRONT_H;
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render the card.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export the card.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadCard(card: GreetingCard): Promise<void> {
  const blob = await cardPngBlob(card, { full: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Kaya-Card-${(card.honoree.name || 'card').replace(/\s+/g, '-')}-${card.dateKey}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** WhatsApp share text (Phase A tap-to-send). */
export function whatsappText(card: GreetingCard, publicUrl: string | null): string {
  const lang = card.lang || 'en';
  const head = cardHeadline(card.type, card.nth, lang, card.eventTitle);
  const first = shortName(card.honoree.name);
  const from = card.signatureLine ? ` — ${card.signatureLine}` : '';
  const open = publicUrl ? (lang === 'sw' ? ` Fungua kadi hapa: ${publicUrl}` : ` Open the card here: ${publicUrl}`) : '';
  return `${typeEmoji(card.type)} ${head}, ${first}! “${card.oneLiner || defaultOneLiner(card)}”${from}.${open} 💌`;
}

export function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ── Client wrappers (Admin gateway /api/reminders/cards) ──────────────────

async function idToken(): Promise<string> {
  const { auth } = await import('./firebase');
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first');
  return u.getIdToken();
}

export async function cardsApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const token = await idToken();
  const res = await fetch('/api/reminders/cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `request-failed-${res.status}`);
  return data as T;
}

export const listCards = () => cardsApi<{ cards: GreetingCard[] }>('list').then((r) => r.cards || []);
export const getCard = (id: string) => cardsApi<{ card: GreetingCard | null }>('get', { id }).then((r) => r.card);
/** Create-or-update the editable fields; server stamps author/status. */
export const saveCard = (card: Partial<GreetingCard> & { eventId: string; dateKey: string }) =>
  cardsApi<{ card: GreetingCard }>('save', { card }).then((r) => r.card);
export const setCardReady = (id: string, ready: boolean) => cardsApi<{ card: GreetingCard }>('ready', { id, ready }).then((r) => r.card);
export const addCardLine = (id: string, text: string) => cardsApi<{ card: GreetingCard }>('line', { id, text }).then((r) => r.card);
export const decideCard = (id: string, decision: 'approve' | 'decline') => cardsApi<{ card: GreetingCard }>('decide', { id, decision }).then((r) => r.card);
export const deleteCard = (id: string) => cardsApi<{ ok: boolean }>('delete', { id });
export const setCardImage = (id: string, imageUrl: string) => cardsApi<{ ok: boolean }>('image', { id, imageUrl });
export const setCardPost = (id: string, postId: string) => cardsApi<{ ok: boolean }>('post', { id, postId });
export const ensureCardLink = (id: string) => cardsApi<{ token: string; url: string }>('link', { id });
export const revokeCardLink = (id: string) => cardsApi<{ ok: boolean }>('revoke-link', { id });
export const emailCardNow = (id: string) => cardsApi<{ ok: boolean; to: string[] }>('email', { id });
export const dropCardInChat = (id: string) => cardsApi<{ ok: boolean }>('chat', { id });
export const logCardDelivery = (id: string, channel: DeliveryChannel, to?: string) => cardsApi<{ ok: boolean }>('log', { id, channel, ...(to ? { to } : {}) });

export interface KayaWritesRequest {
  eventId: string;
  dateKey: string;
  voice: 'warm' | 'funny' | 'formal';
  lang: 'en' | 'sw' | 'mix';
  length: 'one' | 'short' | 'long';
  refine?: string;
  /** Seed text the author typed (kids: Kaya only shapes what they said). */
  seed?: string;
}
export interface KayaWritesSuggestion { voice: string; oneLiner: string; message: string }
export const kayaWrites = (req: KayaWritesRequest) =>
  cardsApi<{ suggestions: KayaWritesSuggestion[]; skipped?: boolean; reason?: string }>('write', req as unknown as Record<string, unknown>);
