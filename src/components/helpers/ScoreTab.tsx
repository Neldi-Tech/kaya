'use client';

// HP2 · Score tab (Helper Performance 2.0, D5/D6/D17 — approved
// 2026-08-23). The long view of one helper: the running week live, the
// last 8 settled weeks as bars (tap one for its breakdown), a 6-month
// roll-up, the kids' review average beside the score, and — parents
// only — "Share this week" (WhatsApp text · copy · PNG card; numbers +
// stars only, never kid text or parent notes).
//
// Data comes from GET /api/helpers/perf-weeks (Admin gateway) — weekly
// snapshots are written once and re-read, the running week is computed
// live. On a preview without Admin creds the API answers 503 and this
// tab says so instead of breaking the page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Settings as SettingsIcon, Share2, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { formatCents } from '@/components/pantry/format';
import { useHive } from '@/contexts/HiveContext';
import type { HelperLink } from '@/lib/firestore';
import { fillEmoji } from '@/lib/routineFillCore';

interface Snap {
  weekKey: string; from: string; to: string; settled: boolean;
  score: number | null; face: { emoji: string; label: string };
  metrics: {
    workplan: { pct: number | null; done: number; scheduled: number; days: number };
    budget: { pct: number | null; shops: number; varianceCents: number };
    ratingCompletion: { pct: number | null; logged: number; expected: number };
    parentFeedback: { pct: number | null; positive: number; neutral: number; negative: number };
    kidReview: { pct: number | null; count: number; eligible: number };
  };
  fill: { codes: string; pct: number | null; green: number; amber: number; red: number; off: number };
  weights: Record<string, number>;
  excluded: string[];
}
interface Payload {
  ok: boolean;
  helper: { uid: string; name: string; preset: string };
  thresholds: { excellent: number; good: number; okay: number };
  current: Snap;
  weeks: Snap[];             // most recent first
  months: { key: string; pct: number; weeks: number }[];
  share?: { current: string; weeks: Record<string, string> };
  viewer: 'parent' | 'helper';
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rangeLabel(from: string, to: string): string {
  const [, m1, d1] = from.split('-').map(Number); const [y2, m2, d2] = to.split('-').map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MON[m2 - 1]} ${y2}` : `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]} ${y2}`;
}
function stars(pct: number): string { return '⭐'.repeat(Math.max(1, Math.min(5, Math.round(pct / 20)))); }
function tone(pct: number | null, t: Payload['thresholds']): string {
  if (pct === null) return 'text-hive-muted';
  if (pct >= t.good) return 'text-green-700';
  if (pct >= t.okay) return 'text-amber-600';
  return 'text-red-600';
}

export default function ScoreTab({ familyId, helper, isParent }: { familyId: string; helper: HelperLink; isParent: boolean }) {
  void familyId;
  const { config } = useHive();
  const currency = config.currency;
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'unavailable' | 'forbidden' | 'error'>('loading');
  const [view, setView] = useState<'weeks' | 'months'>('weeks');
  const [selected, setSelected] = useState<string>('current');
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) { setState('forbidden'); return; }
      const res = await fetch(`/api/helpers/perf-weeks?helperUid=${encodeURIComponent(helper.uid)}&weeks=8`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503) { setState('unavailable'); return; }
      if (res.status === 403 || res.status === 404) { setState('forbidden'); return; }
      if (!res.ok) { setState('error'); return; }
      const j = (await res.json()) as Payload;
      setData(j); setState('ok');
    } catch { setState('error'); }
  }, [helper.uid]);
  useEffect(() => { load(); }, [load]);

  const first = helper.displayName.split(' ')[0];
  const sel: Snap | null = useMemo(() => {
    if (!data) return null;
    if (selected === 'current') return data.current;
    return data.weeks.find((w) => w.weekKey === selected) ?? data.current;
  }, [data, selected]);
  const prevOf = (s: Snap | null): Snap | null => {
    if (!data || !s) return null;
    if (s.weekKey === data.current.weekKey) return data.weeks[0] ?? null;
    const i = data.weeks.findIndex((w) => w.weekKey === s.weekKey);
    return i >= 0 ? data.weeks[i + 1] ?? null : null;
  };

  return (
    <div className="space-y-3">
      <div className="rounded-hive-lg bg-hive-navy text-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[2px] font-nunito font-extrabold opacity-80">{first} · Score</p>
            <h3 className="font-nunito font-black text-lg leading-tight mt-0.5">
              {sel ? `Week ${sel.weekKey.split('-W')[1]} · ${rangeLabel(sel.from, sel.to)}` : 'Score over time'}
            </h3>
            <p className="text-[11px] opacity-90 mt-1">{sel?.settled === false ? 'Running week · settles Sunday night' : sel ? 'Settled week' : 'Last 8 weeks · last 6 months'}</p>
          </div>
          {isParent && (
            <Link href="/settings/performance" className="inline-flex items-center gap-1 h-8 px-3 rounded-hive-pill bg-white/15 text-white text-[11px] font-nunito font-extrabold no-underline hover:bg-white/25">
              <SettingsIcon size={12} /> Scoring
            </Link>
          )}
        </div>
      </div>

      {state === 'loading' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 animate-pulse text-[12px] text-hive-muted">Loading score history…</div>}
      {state === 'unavailable' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-muted">Score history isn&apos;t available on this preview (server not configured). It works on www.ourkaya.com.</div>}
      {state === 'forbidden' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-muted">This score isn&apos;t available to you.</div>}
      {state === 'error' && <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 text-[12px] text-hive-rose font-bold">Couldn&apos;t load the score history. <button type="button" onClick={load} className="underline">Retry</button></div>}

      {state === 'ok' && data && sel && (
        <>
          {/* Headline */}
          <div className={`rounded-hive-lg border-2 p-4 flex items-center gap-4 ${sel.score === null ? 'border-hive-line bg-hive-paper' : sel.score >= data.thresholds.good ? 'border-green-300 bg-green-50' : sel.score >= data.thresholds.okay ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'}`}>
            <span className="text-4xl" aria-hidden>{sel.face.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className={`font-nunito font-black text-3xl leading-none ${tone(sel.score, data.thresholds)}`}>{sel.score === null ? '—' : `${sel.score}%`}</p>
              <p className="text-[11px] text-hive-muted mt-1">
                {sel.face.label}
                <Delta s={sel} prev={prevOf(sel)} />
                {sel.settled === false && ' · so far this week'}
              </p>
            </div>
            {isParent && (
              <button type="button" onClick={() => setShareOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-hive-pill bg-[#25D366] text-white text-[12px] font-nunito font-black">
                <Share2 size={14} /> Share
              </button>
            )}
          </div>

          {/* Trend */}
          <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
            <div className="flex gap-1.5 mb-3">
              {(['weeks', 'months'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`h-8 px-3 rounded-hive-pill text-[11px] font-nunito font-extrabold border ${view === v ? 'bg-hive-navy text-white border-hive-navy' : 'bg-hive-paper border-hive-line text-hive-muted'}`}>
                  {v === 'weeks' ? '8 weeks' : '6 months'}
                </button>
              ))}
            </div>
            {view === 'weeks' ? (
              <WeekBars data={data} selected={selected} onSelect={setSelected} />
            ) : (
              <MonthBars data={data} />
            )}
          </div>

          {/* Breakdown of the selected week */}
          <div className="grid grid-cols-2 gap-2">
            <Metric label="✅ Workplan" value={sel.metrics.workplan.pct === null ? '—' : `${sel.metrics.workplan.pct}%`} sub={sel.metrics.workplan.scheduled > 0 ? `${sel.metrics.workplan.done} / ${sel.metrics.workplan.scheduled} tasks` : 'nothing scheduled'} weight={sel.weights.workplan} excluded={sel.excluded.includes('workplan')} />
            <Metric label="⭐ Routine fill" value={sel.fill.pct === null ? '—' : `${sel.fill.pct}%`} sub={`${fillEmoji(sel.fill.codes)}${sel.metrics.ratingCompletion.expected > 0 ? ` · ${sel.metrics.ratingCompletion.logged}/${sel.metrics.ratingCompletion.expected} logged` : ''}`} weight={sel.weights.ratingCompletion} excluded={sel.excluded.includes('ratingCompletion')} />
            <Metric label="💰 Budget" value={sel.metrics.budget.pct === null ? '—' : `${sel.metrics.budget.pct}%`} sub={sel.metrics.budget.shops > 0 ? `${sel.metrics.budget.shops} shop${sel.metrics.budget.shops === 1 ? '' : 's'} · ${sel.metrics.budget.varianceCents === 0 ? 'on budget' : sel.metrics.budget.varianceCents < 0 ? `${formatCents(-sel.metrics.budget.varianceCents, currency)} under` : `${formatCents(sel.metrics.budget.varianceCents, currency)} over`}` : 'no shops closed'} weight={sel.weights.budget} excluded={sel.excluded.includes('budget')} />
            <Metric label="👍 Feedback" value={sel.metrics.parentFeedback.pct === null ? '—' : `${sel.metrics.parentFeedback.pct}%`} sub={sel.metrics.parentFeedback.positive + sel.metrics.parentFeedback.neutral + sel.metrics.parentFeedback.negative > 0 ? `${sel.metrics.parentFeedback.positive} 👍 · ${sel.metrics.parentFeedback.neutral} 😐 · ${sel.metrics.parentFeedback.negative} 👎` : 'no notes from parent'} weight={sel.weights.parentFeedback} excluded={sel.excluded.includes('parentFeedback')} />
          </div>

          {/* Kids say — parents only (helper payload is stripped server-side) */}
          {data.viewer === 'parent' && (
            <div className="rounded-hive-lg border border-[#D9CCFA] bg-[#EFE8FF] p-4">
              <p className="font-nunito font-extrabold text-[13px]">
                👧 Kids say {sel.metrics.kidReview.pct === null ? <span className="text-hive-muted font-normal">— no reviews this week</span> : <>{stars(sel.metrics.kidReview.pct)} <span className="text-[#5A3CB8]">{sel.metrics.kidReview.pct}%</span></>}
                {sel.metrics.kidReview.count > 0 && <span className="ml-2 text-[10px] font-nunito font-extrabold bg-white/70 text-[#5A3CB8] px-2 py-0.5 rounded-full">{sel.metrics.kidReview.count} of {sel.metrics.kidReview.eligible || sel.metrics.kidReview.count} review{sel.metrics.kidReview.count === 1 ? '' : 's'}</span>}
              </p>
              <p className="text-[10px] text-hive-muted mt-1">
                Average across the kids who reviewed · {sel.weights.kidReview > 0 ? `${sel.weights.kidReview}% of the score` : 'shown beside the score (weight 0% — change in ⚙ Scoring)'}
              </p>
            </div>
          )}

          {shareOpen && data.share && (
            <ShareSheet
              text={sel.weekKey === data.current.weekKey ? data.share.current : (data.share.weeks[sel.weekKey] ?? data.share.current)}
              snap={sel}
              prev={prevOf(sel)}
              helperName={helper.displayName}
              preset={helper.preset}
              onClose={() => setShareOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Delta({ s, prev }: { s: Snap; prev: Snap | null }) {
  if (s.score === null || prev?.score == null) return null;
  const d = s.score - prev.score;
  if (d === 0) return <span className="ml-1.5 font-nunito font-extrabold text-hive-muted">▬ same as last week</span>;
  return <span className={`ml-1.5 font-nunito font-extrabold ${d > 0 ? 'text-green-700' : 'text-red-600'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)} vs last week</span>;
}

function Metric({ label, value, sub, weight, excluded }: { label: string; value: string; sub: string; weight?: number; excluded?: boolean }) {
  return (
    <div className={`bg-hive-paper border border-hive-line rounded-hive-lg p-3 ${excluded ? 'opacity-50' : ''}`}>
      <p className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted">
        {label}{excluded ? <span className="ml-1 normal-case italic">n/a</span> : weight != null && weight !== 25 ? <span className="ml-1 normal-case">· {weight}%</span> : null}
      </p>
      <p className="font-nunito font-black text-lg mt-0.5">{value}</p>
      <p className="text-[10px] text-hive-muted truncate" title={sub}>{sub}</p>
    </div>
  );
}

function WeekBars({ data, selected, onSelect }: { data: Payload; selected: string; onSelect: (k: string) => void }) {
  const ordered = [...data.weeks].reverse(); // oldest → newest
  const all = [...ordered, data.current];
  const max = 100;
  return (
    <div>
      <div className="flex items-end gap-1.5 h-24">
        {all.map((w) => {
          const isCur = w.weekKey === data.current.weekKey;
          const key = isCur ? 'current' : w.weekKey;
          const h = w.score === null ? 4 : Math.max(6, (w.score / max) * 100);
          const color = w.score === null ? 'bg-hive-line' : w.score >= data.thresholds.good ? 'bg-pantry-leaf' : w.score >= data.thresholds.okay ? 'bg-amber-400' : 'bg-red-400';
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className="flex-1 flex flex-col items-center justify-end h-full group"
              title={`Week ${w.weekKey.split('-W')[1]} · ${rangeLabel(w.from, w.to)}${w.score !== null ? ` · ${w.score}%` : ''}`}
            >
              <span className="text-[9px] font-nunito font-black text-hive-ink mb-0.5">{w.score === null ? '—' : w.score}</span>
              <span
                className={`w-full rounded-t-md ${color} ${selected === key ? 'ring-2 ring-hive-navy ring-offset-1' : ''} ${isCur ? 'opacity-70 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgba(255,255,255,.5)_3px_5px)]' : ''}`}
                style={{ height: `${h}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {all.map((w) => (
          <span key={w.weekKey} className={`flex-1 text-center text-[9px] font-nunito font-extrabold ${w.weekKey === data.current.weekKey ? 'text-hive-navy' : 'text-hive-muted'}`}>w{w.weekKey.split('-W')[1]}</span>
        ))}
      </div>
      <p className="text-[10px] text-hive-muted mt-2">Tap a week for its breakdown · hatched = running week{data.weeks.length < 8 ? ` · ${data.weeks.length} settled week${data.weeks.length === 1 ? '' : 's'} so far` : ''}</p>
    </div>
  );
}

function MonthBars({ data }: { data: Payload }) {
  const months = data.months.slice(-6);
  if (months.length === 0) return <p className="text-[11px] text-hive-muted">No settled months yet — the first full month shows here.</p>;
  return (
    <div>
      <div className="flex items-end gap-2 h-24">
        {months.map((m) => (
          <div key={m.key} className="flex-1 flex flex-col items-center justify-end h-full" title={`${m.weeks} week${m.weeks === 1 ? '' : 's'}`}>
            <span className="text-[9px] font-nunito font-black text-hive-ink mb-0.5">{m.pct}</span>
            <span className={`w-full rounded-t-md ${m.pct >= data.thresholds.good ? 'bg-pantry-leaf' : m.pct >= data.thresholds.okay ? 'bg-amber-400' : 'bg-red-400'}`} style={{ height: `${Math.max(6, m.pct)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-1">
        {months.map((m) => <span key={m.key} className="flex-1 text-center text-[9px] font-nunito font-extrabold text-hive-muted">{MON[parseInt(m.key.slice(5), 10) - 1]}</span>)}
      </div>
      <p className="text-[10px] text-hive-muted mt-2">Mean of each month&apos;s settled weeks.</p>
    </div>
  );
}

// ── Share sheet (D6) ─────────────────────────────────────────────
function ShareSheet({ text, snap, prev, helperName, preset, onClose }: {
  text: string; snap: Snap; prev: Snap | null; helperName: string; preset: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  const savePng = async () => {
    setSaving(true);
    try {
      const blob = await renderCardPng({ helperName, preset, snap, prev });
      if (!blob) return;
      const file = new File([blob], `kaya-${helperName.split(' ')[0].toLowerCase()}-${snap.weekKey}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title: `${helperName} · week ${snap.weekKey.split('-W')[1]}` }); return; } catch { /* fall through */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="Share this week">
      <div className="bg-hive-paper rounded-hive-lg w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-nunito font-black text-base">📤 Share {helperName.split(' ')[0]} · week {snap.weekKey.split('-W')[1]}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-hive-muted"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-hive-muted">Numbers and stars only — no notes, no kids&apos; text.</p>
        <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed bg-[#DCF8C6] rounded-xl p-3 max-h-56 overflow-auto">{text}</pre>
        <div className="flex flex-wrap gap-2">
          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center h-10 px-4 rounded-hive-pill bg-[#25D366] text-white text-[12px] font-nunito font-black no-underline">WhatsApp</a>
          <button type="button" onClick={copy} className="h-10 px-4 rounded-hive-pill border-2 border-pantry-leaf text-pantry-leaf-dk text-[12px] font-nunito font-black bg-hive-paper">{copied ? '✓ Copied' : 'Copy text'}</button>
          <button type="button" onClick={savePng} disabled={saving} className="h-10 px-4 rounded-hive-pill bg-hive-navy text-white text-[12px] font-nunito font-black disabled:opacity-60">{saving ? 'Rendering…' : 'Save card (PNG)'}</button>
        </div>
      </div>
    </div>
  );
}

const PRESET_EMOJI: Record<string, string> = { nanny: '🤱', tutor: '📚', driver: '🚗', gardener: '🌿', grandparent: '👵', security: '🛡️', cleaner: '🧹', cook: '🍲', handyman: '🔧', custom: '🤝' };

async function renderCardPng({ helperName, preset, snap, prev }: { helperName: string; preset: string; snap: Snap; prev: Snap | null }): Promise<Blob | null> {
  const W = 900; const H = 520; const r = 2;
  const c = document.createElement('canvas'); c.width = W * r; c.height = H * r;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.scale(r, r);
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1F5E3A'); g.addColorStop(1, '#2E9E5B');
  ctx.fillStyle = g; roundRect(ctx, 0, 0, W, H, 36); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '900 34px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText(`${PRESET_EMOJI[preset] ?? '🤝'} ${helperName} · Week ${snap.weekKey.split('-W')[1]}`, 48, 78);
  ctx.globalAlpha = 0.9; ctx.font = '700 20px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText(`${rangeLabel(snap.from, snap.to)} · ${preset.charAt(0).toUpperCase() + preset.slice(1)}`, 48, 112); ctx.globalAlpha = 1;
  // score
  ctx.font = '900 64px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText(snap.face.emoji, 48, 220);
  ctx.font = '900 96px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText(snap.score === null ? '—' : `${snap.score}%`, 150, 232);
  ctx.font = '800 22px Nunito, Avenir Next, system-ui, sans-serif'; ctx.globalAlpha = 0.92;
  const delta = snap.score !== null && prev?.score != null ? snap.score - prev.score : null;
  ctx.fillText(`${snap.face.label}${delta === null ? '' : delta > 0 ? ` · ▲${delta} vs last week` : delta < 0 ? ` · ▼${Math.abs(delta)} vs last week` : ' · same as last week'}`, 150, 268); ctx.globalAlpha = 1;
  // RAG squares
  const codes = snap.fill.codes.split('');
  codes.forEach((k, i) => {
    ctx.fillStyle = k === 'G' ? '#4ADE80' : k === 'A' ? '#FBBF24' : k === 'R' ? '#F87171' : k === 'T' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.35)';
    roundRect(ctx, 48 + i * 54, 300, 44, 44, 10); ctx.fill();
  });
  ctx.fillStyle = '#fff'; ctx.font = '800 20px Nunito, Avenir Next, system-ui, sans-serif'; ctx.globalAlpha = 0.92;
  ctx.fillText(`Routine fill${snap.fill.pct !== null ? ` ${snap.fill.pct}%` : ''} · ${snap.fill.green} 🟢 ${snap.fill.amber} 🟡 ${snap.fill.red} 🔴`, 48 + 7 * 54 + 12, 330);
  const bits: string[] = [];
  if (snap.metrics.workplan.pct !== null) bits.push(`✅ ${snap.metrics.workplan.pct}%`);
  if (snap.metrics.budget.pct !== null) bits.push(`💰 ${snap.metrics.budget.varianceCents <= 0 ? 'on budget' : 'over'}`);
  if (snap.metrics.parentFeedback.pct !== null) bits.push(`👍 ${snap.metrics.parentFeedback.pct}%`);
  if (snap.metrics.kidReview.pct !== null) bits.push(`👧 ${stars(snap.metrics.kidReview.pct)} ${snap.metrics.kidReview.pct}%`);
  ctx.font = '800 24px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText(bits.join('   ·   ') || 'No activity this week', 48, 400);
  ctx.globalAlpha = 0.7; ctx.font = '700 18px Nunito, Avenir Next, system-ui, sans-serif';
  ctx.fillText('Kaya · ourkaya.com', 48, 470); ctx.globalAlpha = 1;
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number) {
  ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath();
}
