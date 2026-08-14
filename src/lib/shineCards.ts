// 🌟 Shine Cards — client lib (RR PR-2).
//
// The memory layer of Recognition Rounds: every celebration on the award
// rail can become a numbered certificate card. All persistence flows
// through the /api/recognition Admin gateway (Diary idiom — zero rules
// changes); this file also renders the certificate as a self-contained
// SVG → PNG for Moments posts, chat drops and downloads.

import { auth } from './firebase';

export type ShineTheme = 'classic' | 'night' | 'safari' | 'confetti';

export interface ShineCardNote {
  text: string;
  byUid: string;
  byName: string;
  at: number;
}

export interface ShineCard {
  id: string;
  n: number;
  kidId: string;
  kidName: string;
  kidEmoji: string;
  awardId?: string;
  theme: ShineTheme;
  quote: string;
  by: string;
  byName: string;
  at: number;
  kindLabel: string;    // e.g. "⭐ +5 HP" companion label source
  pointsLabel: string;  // e.g. "⭐ +5 HP" | "💛 KUDOS"
  category?: string;
  roundDate?: string;
  doubleShine?: boolean;
  notes?: ShineCardNote[];
  echo?: { reaction: string; text?: string; at: number };
}

export const SHINE_THEMES: Array<{ id: ShineTheme; label: string; emoji: string }> = [
  { id: 'classic', label: 'Classic Gold', emoji: '🏅' },
  { id: 'night', label: 'Night Sky', emoji: '🌙' },
  { id: 'safari', label: 'Safari', emoji: '🦁' },
  { id: 'confetti', label: 'Confetti', emoji: '🎊' },
];

// ── Gateway caller (Diary idiom) ──────────────────────────────────

async function idToken(): Promise<string> {
  const u = auth.currentUser;
  if (!u) throw new Error('Not signed in.');
  return u.getIdToken();
}

export async function recognitionApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const token = await idToken();
  const res = await fetch('/api/recognition', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed.');
  return data as T;
}

export const createShineCard = (payload: Record<string, unknown>) =>
  recognitionApi<{ ok: true; id: string; n: number; doubleShine: boolean }>('card-create', payload);
export const listShineCards = (familyId: string, kidId?: string) =>
  recognitionApi<{ ok: true; cards: ShineCard[] }>('card-list', { familyId, ...(kidId ? { kidId } : {}) })
    .then((r) => r.cards);
export const setShineCardTheme = (familyId: string, cardId: string, theme: ShineTheme) =>
  recognitionApi('card-theme', { familyId, cardId, theme });
export const addShineCardNote = (familyId: string, cardId: string, text: string) =>
  recognitionApi('card-note', { familyId, cardId, text });
export const sendShineCardEcho = (familyId: string, cardId: string, reaction: string, text?: string) =>
  recognitionApi('card-echo', { familyId, cardId, reaction, ...(text ? { text } : {}) });
export const getRound = (familyId: string, date: string) =>
  recognitionApi<{ ok: true; round: RecognitionRound | null }>('round-get', { familyId, date })
    .then((r) => r.round);
export const listRounds = (familyId: string) =>
  recognitionApi<{ ok: true; rounds: RecognitionRound[] }>('round-list', { familyId })
    .then((r) => r.rounds);

export interface RecognitionRound {
  id: string;
  date: string;
  lens: 'best' | 'improved' | 'comeback';
  items: Array<{ kidId: string; kidName: string; emoji: string; kind: string; line: string; daysSince?: number }>;
  sentTo: string[];
}

// ── Waiting round (RR PR-5) ───────────────────────────────────────

export interface WaitingRound {
  round: RecognitionRound;
  /** Kids from the round already celebrated since it fired. */
  celebratedKidIds: string[];
}

/** The latest round still inside its 72h window with at least one kid
 *  not yet celebrated — for the viewing adult (parents always; helpers
 *  only when they're in the round's audience). Null = nothing waiting. */
export async function getWaitingRound(
  familyId: string,
  uid: string,
  role: string,
): Promise<WaitingRound | null> {
  if (role !== 'parent' && role !== 'helper') return null;
  const rounds = await listRounds(familyId).catch(() => [] as RecognitionRound[]);
  const latest = rounds[0];
  if (!latest) return null;
  const start = new Date(`${latest.date}T00:00:00`).getTime();
  if (Date.now() >= start + 72 * 3600_000) return null;
  if (role === 'helper' && !(latest.sentTo || []).includes(uid)) return null;
  const cards = await listShineCards(familyId).catch(() => [] as ShineCard[]);
  const celebrated = new Set(cards.filter((c) => c.at >= start).map((c) => c.kidId));
  const waitingKids = latest.items.filter((i) => !celebrated.has(i.kidId));
  if (waitingKids.length === 0) return null;
  return { round: latest, celebratedKidIds: [...celebrated] };
}

// ── Certificate rendering (self-contained SVG → PNG) ──────────────

const PALETTES: Record<ShineTheme, {
  bg: string; frame: string; frame2: string; brand: string; name: string;
  quote: string; sig: string; sealA: string; sealB: string; sealText: string;
  bandA: string; bandB: string; bandText: string; decor: string;
}> = {
  classic: {
    bg: '#FFFDF8', frame: '#D9C48C', frame2: '#EADFC2', brand: '#B7995A', name: '#241a10',
    quote: '#3a2d1d', sig: '#6b5636', sealA: '#F3D06A', sealB: '#C89A1A', sealText: '#5c4102',
    bandA: '#C89A1A', bandB: '#F3D06A', bandText: '#40300a', decor: '',
  },
  night: {
    bg: '#101A33', frame: '#3d5290', frame2: '#22305a', brand: '#8fa3d8', name: '#F8F2E2',
    quote: '#E8DFC9', sig: '#c9bb92', sealA: '#F3D06A', sealB: '#C89A1A', sealText: '#5c4102',
    bandA: '#22305a', bandB: '#3d5290', bandText: '#F4EAD2', decor: '✦',
  },
  safari: {
    bg: '#FBF6EA', frame: '#B98A4A', frame2: '#E3CBA4', brand: '#9A7134', name: '#2e2010',
    quote: '#4a3820', sig: '#7a5c33', sealA: '#E8B45A', sealB: '#B9812A', sealText: '#4a3305',
    bandA: '#B9812A', bandB: '#E8B45A', bandText: '#3d2b08', decor: '🌿',
  },
  confetti: {
    bg: '#FFFBF4', frame: '#C9A5F0', frame2: '#EADDF9', brand: '#8b5cd6', name: '#241a34',
    quote: '#3d2d56', sig: '#6b5690', sealA: '#C9A5F0', sealB: '#8b5cd6', sealText: '#f6efff',
    bandA: '#8b5cd6', bandB: '#C9A5F0', bandText: '#f8f4ff', decor: '🎊',
  },
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Word-wrap the quote into <=maxChars lines (max 5 lines, ellipsis). */
function wrapQuote(q: string, maxChars = 34): string[] {
  const words = q.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
    if (lines.length === 5) break;
  }
  if (cur && lines.length < 5) lines.push(cur);
  if (lines.length === 5 && words.join(' ').length > lines.join(' ').length + cur.length) {
    lines[4] = lines[4].replace(/.{3}$/, '…');
  }
  return lines;
}

const W = 680; const H = 880;

/** The certificate as a self-contained SVG string (no external assets). */
export function shineCardSvg(card: ShineCard): string {
  const p = PALETTES[card.theme] || PALETTES.classic;
  const lines = wrapQuote(card.quote);
  const quoteY = 460;
  const lineH = 42;
  const dateStr = new Date(card.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-').toUpperCase();
  const decor = p.decor
    ? `<text x="70" y="120" font-size="22" fill="${p.frame}" opacity="0.75">${p.decor}</text>
       <text x="590" y="200" font-size="16" fill="${p.frame}" opacity="0.6">${p.decor}</text>
       <text x="90" y="700" font-size="16" fill="${p.frame}" opacity="0.6">${p.decor}</text>
       <text x="560" y="640" font-size="22" fill="${p.frame}" opacity="0.75">${p.decor}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="seal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.sealA}"/><stop offset="1" stop-color="${p.sealB}"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.bandA}"/><stop offset="0.5" stop-color="${p.bandB}"/><stop offset="1" stop-color="${p.bandA}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="28" fill="${p.bg}"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="none" stroke="${p.frame}" stroke-width="3"/>
  <rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="16" fill="none" stroke="${p.frame2}" stroke-width="1.5"/>
  ${decor}
  <text x="${W / 2}" y="76" text-anchor="middle" font-family="Arial" font-size="17" letter-spacing="6" font-weight="bold" fill="${p.brand}">✦ KAYA SHINE CARD ✦</text>
  <g transform="translate(${W - 110},52) rotate(8)">
    <circle cx="34" cy="34" r="40" fill="url(#seal)"/>
    <text x="34" y="30" text-anchor="middle" font-family="Arial" font-size="17" font-weight="bold" fill="${p.sealText}">№${card.n}</text>
    <text x="34" y="48" text-anchor="middle" font-family="Arial" font-size="9" font-weight="bold" letter-spacing="2" fill="${p.sealText}">SHINE</text>
  </g>
  <circle cx="${W / 2}" cy="196" r="62" fill="${p.bg}" stroke="${p.frame}" stroke-width="4"/>
  <circle cx="${W / 2}" cy="196" r="70" fill="none" stroke="${p.frame2}" stroke-width="2"/>
  <text x="${W / 2}" y="220" text-anchor="middle" font-size="64">${card.kidEmoji}</text>
  <text x="${W / 2}" y="320" text-anchor="middle" font-family="Georgia, serif" font-size="40" font-weight="bold" fill="${p.name}">${esc(card.kidName)}</text>
  ${card.category ? `<text x="${W / 2}" y="356" text-anchor="middle" font-family="Arial" font-size="14" letter-spacing="4" font-weight="bold" fill="${p.brand}">FOR · ${esc(card.category.toUpperCase())}</text>` : ''}
  <text x="96" y="${quoteY - 34}" font-family="Georgia, serif" font-size="84" fill="${p.frame}">“</text>
  ${lines.map((l, i) =>
    `<text x="${W / 2}" y="${quoteY + i * lineH}" text-anchor="middle" font-family="Georgia, serif" font-size="27" fill="${p.quote}">${esc(l)}</text>`).join('\n  ')}
  <text x="${W / 2}" y="${quoteY + lines.length * lineH + 34}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="23" fill="${p.sig}">— with love, ${esc(card.byName)}</text>
  ${card.doubleShine ? `<text x="${W / 2}" y="${quoteY + lines.length * lineH + 72}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold" fill="${p.brand}">🤝 Double Shine — both of us celebrated this</text>` : ''}
  <rect x="18" y="${H - 76}" width="${W - 36}" height="58" rx="14" fill="url(#band)"/>
  <text x="46" y="${H - 40}" font-family="Arial" font-size="16" font-weight="bold" fill="${p.bandText}">${dateStr}</text>
  <text x="${W / 2}" y="${H - 40}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="bold" fill="${p.bandText}">${esc(card.pointsLabel)}</text>
  <text x="${W - 46}" y="${H - 40}" text-anchor="end" font-family="Arial" font-size="16" font-weight="bold" fill="${p.bandText}">№${card.n} OF ${new Date(card.at).getFullYear()}</text>
</svg>`;
}

/** SVG → PNG blob via canvas (self-contained; emoji render natively). */
export async function shineCardPngBlob(card: ShineCard): Promise<Blob> {
  const svg = shineCardSvg(card);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not render the card.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; canvas.height = H * 2; // retina-crisp
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export the card.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Trigger a browser download of the card as PNG. */
export async function downloadShineCard(card: ShineCard): Promise<void> {
  const blob = await shineCardPngBlob(card);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Kaya-ShineCard-${card.n}-${card.kidName}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Remembered theme per signed-in adult. */
export function rememberedTheme(uid: string): ShineTheme {
  try {
    const t = localStorage.getItem(`kayaShineTheme:${uid}`) as ShineTheme | null;
    return t && PALETTES[t] ? t : 'classic';
  } catch { return 'classic'; }
}
export function rememberTheme(uid: string, theme: ShineTheme): void {
  try { localStorage.setItem(`kayaShineTheme:${uid}`, theme); } catch { /* ignore */ }
}
