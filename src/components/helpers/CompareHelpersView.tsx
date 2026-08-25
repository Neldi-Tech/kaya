'use client';

// ⚖️ Compare mode (HR PR-1) — 2–3 helpers side by side on the five
// recognition dials: score columns, per-dial delta chips, one radar,
// and a 📤 PNG share (canvas, same self-contained pattern as the Score
// tab's card) for planning rewards together.

import { useEffect, useState } from 'react';
import { computeHelperDials, DIAL_META, dialColor, type HelperDials } from '@/lib/helperRecognition';
import { shareScorecardPng, HELPER_COLORS, type ScorecardView } from '@/lib/helperScorecardPng';
import DialPentagon from './DialPentagon';
import { useFamily } from '@/contexts/FamilyContext';
import { asLocale, localeForCountry, type Locale } from '@/lib/i18n';
import type { HelperLink } from '@/lib/firestore';

type Row = { helper: HelperLink; dials: HelperDials };

export default function CompareHelpersView({ familyId, helpers }: {
  familyId: string;
  helpers: HelperLink[];
}) {
  const { family } = useFamily();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    Promise.all(helpers.map(async (h) => ({ helper: h, dials: await computeHelperDials(familyId, h.uid) })))
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [familyId, helpers]);

  // 📤 PNG share — now goes through lib/helperScorecardPng so the compare
  // picture and a single helper's card are rendered by ONE code path and
  // can never drift. Bilingual: the people in the picture are usually the
  // audience for it.
  // Default to the language the compared helpers actually read — the
  // parent-set default for the first of them, else the country's language
  // (same chain useLocale walks for a helper).
  const compareDefaultLang: Locale =
    asLocale(family?.memberLanguageDefaults?.[helpers[0]?.uid ?? ''])
    ?? localeForCountry(family?.location?.country);
  const [shareLang, setShareLang] = useState<Locale>(compareDefaultLang);
  const [sharing, setSharing] = useState(false);
  const [shareView, setShareView] = useState<ScorecardView>('bars');
  const sharePng = async () => {
    if (!rows || rows.length === 0) return;
    setSharing(true);
    try {
      await shareScorecardPng(
        rows.map((r) => ({ name: r.helper.displayName, dials: r.dials })),
        shareLang,
        'Kaya-helper-comparison',
        shareView,
      );
    } finally { setSharing(false); }
  };

  if (!rows) return <p className="text-[12.5px] text-hive-muted py-6">Computing {helpers.length} scorecards…</p>;
  if (rows.length === 0) return <p className="text-[12.5px] text-hive-muted py-6">Comparison unavailable — try again shortly.</p>;

  const best = rows.reduce((a, b) => ((b.dials.score ?? -1) > (a.dials.score ?? -1) ? b : a));

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-nunito font-black text-lg flex-1">⚖️ Comparing {rows.length} helpers</p>
        <div className="flex rounded-full border border-hive-line overflow-hidden">
          {([['bars', '▤'], ['pentagon', '⬟']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setShareView(v)}
              aria-pressed={shareView === v}
              title={v === 'bars' ? 'Share as bars' : 'Share as pentagon'}
              className={`px-3 py-1 text-[11px] font-nunito font-black ${shareView === v ? 'bg-hive-ink text-white' : 'bg-white text-hive-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-hive-line overflow-hidden">
          {(['en', 'sw'] as Locale[]).map((l) => (
            <button key={l} type="button" onClick={() => setShareLang(l)}
              className={`px-3 py-1 text-[11px] font-nunito font-black ${shareLang === l ? 'bg-hive-ink text-white' : 'bg-white text-hive-muted'}`}>
              {l === 'en' ? 'English' : 'Kiswahili'}
            </button>
          ))}
        </div>
        <button type="button" disabled={sharing} onClick={() => void sharePng()}
          className="px-3.5 py-2 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-[12px] border-2 border-hive-honey-dk disabled:opacity-60">
          {sharing ? '…' : '📤 Share as picture'}
        </button>
      </div>

      {/* Score columns */}
      <div className={`grid gap-3 ${rows.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {rows.map((r, i) => (
          <div key={r.helper.uid} className="bg-white border border-hive-line rounded-hive p-3 text-center">
            <p className="font-nunito font-extrabold text-[13px] truncate" style={{ color: HELPER_COLORS[i % HELPER_COLORS.length] }}>
              ● {r.helper.displayName.split(' ')[0]}{r.helper.uid === best.helper.uid && (best.dials.score ?? 0) > 0 ? ' 👑' : ''}
            </p>
            <p className="font-nunito font-black text-3xl" style={{ color: dialColor(r.dials.score) }}>{r.dials.score ?? '—'}</p>
            <p className="text-[9.5px] uppercase tracking-wider font-bold text-hive-muted">Helper Score</p>
          </div>
        ))}
      </div>

      {/* Radar + per-dial rows */}
      <div className="lg:flex lg:gap-5 lg:items-start">
        <DialPentagon
          size={230}
          series={rows.map((r, i) => ({
            key: r.helper.uid,
            color: HELPER_COLORS[i % HELPER_COLORS.length],
            dials: r.dials,
          }))}
        />
        <div className="flex-1 space-y-2 mt-3 lg:mt-0">
          {DIAL_META.map((m) => {
            const vals = rows.map((r) => r.dials[m.key]);
            const lead = rows.reduce((a, b) => ((b.dials[m.key] ?? -1) > (a.dials[m.key] ?? -1) ? b : a));
            const leadV = lead.dials[m.key];
            const runnerV = Math.max(...rows.filter((r) => r !== lead).map((r) => r.dials[m.key] ?? -1));
            return (
              <div key={m.key} className="bg-white border border-hive-line rounded-hive px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-nunito font-extrabold flex-1">{m.emoji} {m.label}</span>
                  {leadV !== null && leadV >= 0 && runnerV >= 0 && leadV - runnerV > 0 && (
                    <span className="text-[10px] font-nunito font-black px-2 py-0.5 rounded-full bg-hive-cream text-hive-ink">
                      {lead.helper.displayName.split(' ')[0]} +{leadV - runnerV}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {rows.map((r, i) => {
                    const v = r.dials[m.key];
                    return (
                      <div key={r.helper.uid} className="flex-1">
                        <div className="h-1.5 rounded-full bg-hive-cream overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${v ?? 0}%`, background: HELPER_COLORS[i % HELPER_COLORS.length] }} />
                        </div>
                        <p className="text-[9px] font-bold text-hive-muted mt-0.5">{v ?? '—'}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-[10.5px] text-hive-muted">Built for planning rewards &amp; recognition — 👑 marks the current leading Helper Score. Dials cover the last 4 weeks.</p>
    </div>
  );
}
