'use client';

// ⚖️ Compare mode (HR PR-1) — 2–3 helpers side by side on the five
// recognition dials: score columns, per-dial delta chips, one radar,
// and a 📤 PNG share (canvas, same self-contained pattern as the Score
// tab's card) for planning rewards together.

import { useEffect, useState } from 'react';
import { computeHelperDials, DIAL_META, dialColor, type HelperDials } from '@/lib/helperRecognition';
import type { HelperLink } from '@/lib/firestore';

const HELPER_COLORS = ['#6B3FE0', '#11C5A8', '#C46A1B'];

type Row = { helper: HelperLink; dials: HelperDials };

function radarPoints(values: Array<number | null>, cx: number, cy: number, r: number): string {
  const n = values.length;
  return values.map((v, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const len = ((v ?? 0) / 100) * r;
    return `${(cx + Math.cos(angle) * len).toFixed(1)},${(cy + Math.sin(angle) * len).toFixed(1)}`;
  }).join(' ');
}

export default function CompareHelpersView({ familyId, helpers }: {
  familyId: string;
  helpers: HelperLink[];
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    Promise.all(helpers.map(async (h) => ({ helper: h, dials: await computeHelperDials(familyId, h.uid) })))
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [familyId, helpers]);

  const sharePng = async () => {
    if (!rows || rows.length === 0) return;
    const scale = 2;
    const W = 900, H = 200 + rows.length * 40 + DIAL_META.length * 56;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#FDFBF7'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1E120B'; ctx.font = '900 26px Nunito, Arial';
    ctx.fillText('🤝 Helper comparison — recognition dials', 32, 48);
    ctx.font = '700 13px Nunito, Arial'; ctx.fillStyle = '#9B8A72';
    ctx.fillText(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), 32, 70);
    let y = 108;
    rows.forEach((r, i) => {
      ctx.fillStyle = HELPER_COLORS[i % HELPER_COLORS.length];
      ctx.font = '900 17px Nunito, Arial';
      ctx.fillText(`● ${r.helper.displayName} — score ${r.dials.score ?? '—'}`, 32, y);
      y += 34;
    });
    y += 8;
    for (const m of DIAL_META) {
      ctx.fillStyle = '#1E120B'; ctx.font = '800 14px Nunito, Arial';
      ctx.fillText(`${m.emoji} ${m.label}`, 32, y);
      rows.forEach((r, i) => {
        const v = r.dials[m.key];
        const barY = y + 8 + i * 12;
        ctx.fillStyle = '#F0EBE3';
        ctx.fillRect(240, barY - 8, 560, 8);
        ctx.fillStyle = HELPER_COLORS[i % HELPER_COLORS.length];
        ctx.fillRect(240, barY - 8, 560 * ((v ?? 0) / 100), 8);
        ctx.fillStyle = '#1E120B'; ctx.font = '900 11px Nunito, Arial';
        ctx.fillText(v === null ? '—' : String(v), 810, barY);
      });
      y += 20 + rows.length * 12;
    }
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return;
    const file = new File([blob], 'Kaya-helper-comparison.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({ files: [file], title: 'Kaya helper comparison' }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Kaya-helper-comparison.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  if (!rows) return <p className="text-[12.5px] text-hive-muted py-6">Computing {helpers.length} scorecards…</p>;
  if (rows.length === 0) return <p className="text-[12.5px] text-hive-muted py-6">Comparison unavailable — try again shortly.</p>;

  const best = rows.reduce((a, b) => ((b.dials.score ?? -1) > (a.dials.score ?? -1) ? b : a));

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-nunito font-black text-lg flex-1">⚖️ Comparing {rows.length} helpers</p>
        <button type="button" onClick={() => void sharePng()}
          className="px-3.5 py-2 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-hive-ink font-nunito font-black text-[12px] border-2 border-hive-honey-dk">
          📤 Share as picture
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
        <svg width="230" height="210" viewBox="0 0 230 210" className="mx-auto lg:mx-0 shrink-0">
          {[100, 66, 33].map((ring) => (
            <polygon key={ring} points={radarPoints([ring, ring, ring, ring, ring], 115, 105, 78)}
              fill="none" stroke="#E8E0D4" strokeWidth="1" />
          ))}
          {rows.map((r, i) => (
            <polygon key={r.helper.uid}
              points={radarPoints(DIAL_META.map((m) => r.dials[m.key]), 115, 105, 78)}
              fill={`${HELPER_COLORS[i % HELPER_COLORS.length]}26`}
              stroke={HELPER_COLORS[i % HELPER_COLORS.length]} strokeWidth="2" />
          ))}
          {DIAL_META.map((m, i) => {
            const angle = (Math.PI * 2 * i) / DIAL_META.length - Math.PI / 2;
            const x = 115 + Math.cos(angle) * 97;
            const y = 105 + Math.sin(angle) * 95;
            return (
              <text key={m.key} x={x} y={y} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#9B8A72">
                {m.label.toUpperCase()}
              </text>
            );
          })}
        </svg>
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
