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

/** Build the scorecard PNG. Returns null if the canvas is unavailable. */
export async function buildScorecardPng(rows: ScorecardRow[], lang: Locale): Promise<Blob | null> {
  if (rows.length === 0) return null;
  const t = COPY[lang] ?? COPY.en;
  const single = rows.length === 1;

  const scale = 2;
  const W = 900;
  const H = 150 + rows.length * 40 + DIAL_META.length * (20 + rows.length * 14) + 60;
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

  ctx.fillStyle = '#9B8A72'; ctx.font = '700 11px Nunito, Arial';
  ctx.fillText(t.footer, 32, H - 22);

  return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
}

/** Build + hand off: native share sheet when available, download otherwise. */
export async function shareScorecardPng(
  rows: ScorecardRow[], lang: Locale, filenameHint = 'Kaya-helper-scorecard',
): Promise<void> {
  const blob = await buildScorecardPng(rows, lang);
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
