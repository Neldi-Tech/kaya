// 📤 Helper scorecard → PNG (2026-08-25, Elia).
//
// One canvas renderer behind BOTH shares:
//   · ⚖️ Compare mode — 2–3 helpers side by side (existing button)
//   · 🤝 A single helper's Recognition tab (new — same pattern, so a
//     parent can send one person their own card without dragging a
//     second helper into the picture)
//
// Bilingual by design. The point of sharing a scorecard is that the
// HELPER reads it, and most helpers in a Dar es Salaam household read
// Kiswahili before English — so the caller passes the language and the
// picture is built in it end to end (title, dial names, footer, date).
// Language resolution follows the same chain as useLocale for helpers:
// their own choice → the parent-set default → the country's language.
//
// Self-contained canvas — no external libs, no fonts to load, so it
// works offline and inside the PWA. Mirrors the Score-tab card pattern.

import { DIAL_META, type HelperDials } from './helperRecognition';
import type { Locale } from './i18n';

export interface ScorecardRow {
  name: string;
  dials: HelperDials;
}

/** Which shape the picture uses. Mirrors the on-screen ▤ / ⬟ toggle so
 *  a parent who is looking at a pentagon shares a pentagon. */
export type ScorecardView = 'bars' | 'pentagon';

/** Dial names in each language, keyed off DIAL_META.key so the two can
 *  never drift apart. ⚠️ Swahili pending native review (Elia/Dar). */
const DIAL_LABEL_SW: Record<string, string> = {
  strictness:  'Umakini wa alama',
  consistency: 'Uthabiti',
  workplan:    'Mpango wa kazi',
  corrections: 'Ubora wa masahihisho',
  kidsVoice:   'Sauti ya watoto',
};

const COPY = {
  en: {
    titleOne: (n: string) => `🤝 ${n} — helper scorecard`,
    titleMany: '🤝 Helper comparison — recognition dials',
    score: 'Helper Score',
    window: 'Last 4 weeks',
    footer: 'Kaya · ourkaya.com',
    none: '—',
  },
  sw: {
    titleOne: (n: string) => `🤝 ${n} — kadi ya alama`,
    titleMany: '🤝 Ulinganisho wa wasaidizi — vipimo vya utambuzi',
    score: 'Alama ya Msaidizi',
    window: 'Wiki 4 zilizopita',
    footer: 'Kaya · ourkaya.com',
    none: '—',
  },
} as const;

export const HELPER_COLORS = ['#6B3FE0', '#11C5A8', '#C46A1B'];

const dialLabel = (key: string, fallback: string, lang: Locale) =>
  lang === 'sw' ? (DIAL_LABEL_SW[key] ?? fallback) : fallback;

/** Draw the five dials as a pentagon (radar) — canvas twin of the
 *  DialPentagon component, so the picture matches the screen. */
function drawPentagon(
  ctx: CanvasRenderingContext2D, rows: ScorecardRow[], lang: Locale,
  cx: number, cy: number, r: number,
): void {
  const n = DIAL_META.length;
  const at = (i: number, len: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
  };
  const ring = (frac: number) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i, r * frac);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  ctx.strokeStyle = '#E8E0D4'; ctx.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) { ring(f); ctx.stroke(); }

  ctx.strokeStyle = '#F0EBE3';
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i, r);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
  }

  rows.forEach((row, ri) => {
    const color = rows.length === 1 ? '#11C5A8' : HELPER_COLORS[ri % HELPER_COLORS.length];
    ctx.beginPath();
    DIAL_META.forEach((m, i) => {
      const v = row.dials[m.key] ?? 0;
      const [x, y] = at(i, r * (v / 100));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = `${color}26`; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  });

  ctx.fillStyle = '#9B8A72'; ctx.font = '800 11px Nunito, Arial'; ctx.textAlign = 'center';
  DIAL_META.forEach((m, i) => {
    const [x, y] = at(i, r * 1.26);
    ctx.fillText(dialLabel(m.key as string, m.label, lang).toUpperCase(), x, y);
  });
  ctx.textAlign = 'left';
}

/** Build the scorecard PNG. Returns null if the canvas is unavailable. */
export async function buildScorecardPng(
  rows: ScorecardRow[], lang: Locale, view: ScorecardView = 'bars',
): Promise<Blob | null> {
  if (rows.length === 0) return null;
  const t = COPY[lang] ?? COPY.en;
  const single = rows.length === 1;

  const scale = 2;
  const W = 900;
  const barsH = DIAL_META.length * (20 + rows.length * 14);
  const H = 150 + rows.length * 40 + (view === 'pentagon' ? 360 : barsH) + 60;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#FDFBF7'; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1E120B'; ctx.font = '900 26px Nunito, Arial';
  ctx.fillText(single ? t.titleOne(rows[0].name) : t.titleMany, 32, 48);

  ctx.font = '700 13px Nunito, Arial'; ctx.fillStyle = '#9B8A72';
  const date = new Date().toLocaleDateString(lang === 'sw' ? 'sw-TZ' : 'en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
  ctx.fillText(`${t.window} · ${date}`, 32, 70);

  let y = 108;
  rows.forEach((r, i) => {
    ctx.fillStyle = single ? '#1E120B' : HELPER_COLORS[i % HELPER_COLORS.length];
    ctx.font = '900 17px Nunito, Arial';
    const dot = single ? '' : '● ';
    ctx.fillText(`${dot}${r.name} — ${t.score} ${r.dials.score ?? t.none}`, 32, y);
    y += 34;
  });
  y += 8;

  if (view === 'pentagon') {
    drawPentagon(ctx, rows, lang, 250, y + 150, 125);
    // The numbers still belong in the picture — list them beside the shape.
    let ly = y + 40;
    for (const m of DIAL_META) {
      ctx.fillStyle = '#1E120B'; ctx.font = '800 14px Nunito, Arial';
      ctx.fillText(`${m.emoji} ${dialLabel(m.key as string, m.label, lang)}`, 470, ly);
      rows.forEach((r, i) => {
        const v = r.dials[m.key];
        ctx.fillStyle = single ? '#1E120B' : HELPER_COLORS[i % HELPER_COLORS.length];
        ctx.font = '900 14px Nunito, Arial';
        ctx.fillText(v === null || v === undefined ? t.none : String(v), 790 + i * 40, ly);
      });
      ly += 34;
    }
    y += 360;
  } else {
    for (const m of DIAL_META) {
      ctx.fillStyle = '#1E120B'; ctx.font = '800 14px Nunito, Arial';
      ctx.fillText(`${m.emoji} ${dialLabel(m.key as string, m.label, lang)}`, 32, y);
      rows.forEach((r, i) => {
        const v = r.dials[m.key];
        const barY = y + 8 + i * 14;
        ctx.fillStyle = '#F0EBE3';
        ctx.fillRect(300, barY - 8, 500, 8);
        ctx.fillStyle = single ? '#11C5A8' : HELPER_COLORS[i % HELPER_COLORS.length];
        ctx.fillRect(300, barY - 8, 500 * ((v ?? 0) / 100), 8);
        ctx.fillStyle = '#1E120B'; ctx.font = '900 11px Nunito, Arial';
        ctx.fillText(v === null || v === undefined ? t.none : String(v), 812, barY);
      });
      y += 20 + rows.length * 14;
    }
  }

  ctx.fillStyle = '#9B8A72'; ctx.font = '700 11px Nunito, Arial';
  ctx.fillText(t.footer, 32, H - 22);

  return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
}

/** Build + hand off: native share sheet when available, download otherwise. */
export async function shareScorecardPng(
  rows: ScorecardRow[], lang: Locale, filenameHint = 'Kaya-helper-scorecard',
  view: ScorecardView = 'bars',
): Promise<void> {
  const blob = await buildScorecardPng(rows, lang, view);
  if (!blob) return;
  const name = `${filenameHint}${lang === 'sw' ? '-kiswahili' : ''}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    await nav.share({ files: [file], title: name.replace(/\.png$/, '') }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
