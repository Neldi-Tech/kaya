'use client';
// 👑 Leadership card (S6 in the approved design) — per kid: style label,
// counters (selected × · meetings led · notes approved · Honest ✓ · Mission ✓),
// 5-trait radar + bars (tap → the one-line reason), term history, and a
// 📤 share-as-PNG button (screenshot-ready). Mounted on /profiles (parents),
// /stats/me (the kid's own, when kidSeesTraits) and /parent/leader.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listLeaderTerms, type LeaderLifetime, type LeaderTerm } from '@/lib/leaderWeek';
import { TRAIT_META, TRAIT_ORDER, explainTrait, type LeaderTraitKey, type LeaderTraits } from '@/lib/leaderWeek.shared';

const GOLD = '#B8860B';

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

// Pentagon radar (0–5 per axis) as an SVG string so the same drawing powers
// the on-screen card AND the PNG export.
function radarSvg(traits: LeaderTraits | null, size = 220): string {
  const cx = size / 2; const cy = size / 2 + 6; const R = size / 2 - 34;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (f: number) => TRAIT_ORDER.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const vals = TRAIT_ORDER.map((k) => {
    const v = traits ? traits[k] : 0;
    return v === null || v === undefined ? 0 : Math.max(0, Math.min(5, v));
  });
  const poly = vals.map((v, i) => pt(i, (R * v) / 5).join(',')).join(' ');
  const labels = TRAIT_ORDER.map((k, i) => {
    const [x, y] = pt(i, R + 18);
    const v = traits ? traits[k] : null;
    const txt = `${TRAIT_META[k].emoji} ${TRAIT_META[k].label}${v === null || v === undefined ? (traits ? ' –' : '') : ` ${v}`}`;
    const anchor = Math.abs(x - cx) < 6 ? 'middle' : x < cx ? 'end' : 'start';
    return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${anchor}" font-size="10" font-weight="900" fill="#2E3D5C" font-family="Nunito,system-ui,sans-serif">${txt}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g fill="none" stroke="#E8E0CF" stroke-width="1"><polygon points="${ring(1)}"/><polygon points="${ring(0.66)}"/><polygon points="${ring(0.33)}"/></g>
  <polygon points="${poly}" fill="rgba(184,134,11,.28)" stroke="${GOLD}" stroke-width="2"/>
  ${labels}
</svg>`;
}

function cardSvg(p: { name: string; emoji: string; style: string; life: LeaderLifetime | null; traits: LeaderTraits | null; familyName?: string }): string {
  const W = 680; const H = 760;
  const radar = radarSvg(p.traits, 300).replace('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">', '<g transform="translate(190,250)">').replace('</svg>', '</g>');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const counters = p.life
    ? [`Selected ${p.life.selected}×`, `Led ${p.life.meetingsLed} meeting${p.life.meetingsLed === 1 ? '' : 's'}`, `${p.life.notesApproved} notes approved`, p.life.honest ? `Honest ✓ ×${p.life.honest}` : '', p.life.missionsDone ? `Mission ✓ ×${p.life.missionsDone}` : ''].filter(Boolean).join(' · ')
    : 'No terms yet';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1F2A44"/><stop offset="1" stop-color="#2E3D5C"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B8860B"/><stop offset="1" stop-color="#E9B949"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="28" fill="#FFFDF7"/>
  <rect x="0" y="0" width="${W}" height="190" rx="28" fill="url(#g)"/>
  <rect x="0" y="150" width="${W}" height="40" fill="url(#g)"/>
  <text x="40" y="58" font-size="14" font-weight="900" fill="#E9B949" letter-spacing="3" font-family="Nunito,system-ui,sans-serif">👑 LEADERSHIP · KAYA</text>
  <text x="40" y="108" font-size="38" font-weight="900" fill="#fff" font-family="Nunito,system-ui,sans-serif">${esc(p.emoji)} ${esc(p.name)}</text>
  <text x="40" y="150" font-size="22" font-weight="900" fill="#E9B949" font-family="Nunito,system-ui,sans-serif">${esc(p.style)}</text>
  <text x="40" y="178" font-size="13" font-weight="800" fill="#fff" opacity=".9" font-family="Nunito,system-ui,sans-serif">${esc(counters)}</text>
  ${radar}
  <text x="${W / 2}" y="${H - 36}" text-anchor="middle" font-size="12" font-weight="800" fill="#8A8471" font-family="Nunito,system-ui,sans-serif">${esc(p.familyName || 'Our family')} · ${fmtDay(Date.now())} · www.ourkaya.com</text>
</svg>`;
}

async function svgToPngBlob(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('render')); i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w * 2; canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('export'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export default function LeadershipCard({ familyId, childId, childName, childEmoji, viewer, familyName, className = '', compact = false }: {
  familyId: string;
  childId: string;
  childName: string;
  childEmoji?: string;
  viewer: 'parent' | 'kid';
  familyName?: string;
  className?: string;
  /** compact = no term history list (used in lists). */
  compact?: boolean;
}) {
  const [terms, setTerms] = useState<LeaderTerm[] | null>(null);
  const [life, setLife] = useState<LeaderLifetime | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [explain, setExplain] = useState<LeaderTraitKey | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setTerms(null); setLife(null); setErr(null);
    listLeaderTerms(familyId, childId)
      .then((r) => { if (!alive) return; setTerms(r.terms); setLife(r.lifetime.find((l) => l.childId === childId) || null); })
      .catch(() => { if (alive) setErr('Could not load leadership yet.'); });
    return () => { alive = false; };
  }, [familyId, childId]);

  const latestSealed = useMemo(() => (terms || []).find((t) => t.traits), [terms]);
  const traits = life?.avg || null;
  const open = (terms || []).find((t) => !t.endAt);
  const radar = useMemo(() => radarSvg(traits, 220), [traits]);

  const share = async () => {
    setSharing(true);
    try {
      const svg = cardSvg({ name: childName, emoji: childEmoji || '🧒', style: life?.style || 'New Leader', life, traits, familyName });
      const blob = await svgToPngBlob(svg, 680, 760);
      const file = new File([blob], `Kaya-Leadership-${childName}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `👑 ${childName} — Leadership` });
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch { /* user cancelled or render failed — quiet */ } finally { setSharing(false); }
  };

  const first = childName.split(' ')[0];
  const history = (terms || []).filter((t) => t.endAt);
  const shown = showAll ? history : history.slice(0, 4);

  return (
    <div className={`bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden ${className}`} id="leadership">
      <div className="px-4 py-3.5 text-white" style={{ background: 'linear-gradient(135deg,#1F2A44,#2E3D5C)' }}>
        <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-kaya-gold-light">👑 Leadership · {first}</p>
        <p className="font-display text-xl font-black leading-tight mt-0.5">{life ? life.style : terms ? 'New Leader' : '…'}</p>
        <p className="text-[11.5px] font-bold opacity-90 mt-1">
          {life
            ? <>Selected <b>{life.selected}×</b> · led <b>{life.meetingsLed}</b> meeting{life.meetingsLed === 1 ? '' : 's'} · <b>{life.notesApproved}</b> notes approved{life.honest ? ` · Honest ✓${life.honest > 1 ? ` ×${life.honest}` : ''}` : ''}{life.missionsDone ? ` · Mission ✓${life.missionsDone > 1 ? ` ×${life.missionsDone}` : ''}` : ''}</>
            : terms ? (open ? 'First week as leader — in progress 👑' : 'Not crowned yet — the Sunday wheel decides.') : 'Loading…'}
        </p>
        {open && <p className="text-[11px] font-black text-kaya-gold-light mt-1">⏳ Current week in progress — traits seal when the week ends.</p>}
      </div>
      <div className="p-4">
        {err && <p className="text-[12px] font-bold text-red-600">{err}</p>}
        {terms && !history.length && !open && (
          <p className="text-[12.5px] font-bold text-kaya-sand">No leadership weeks yet. When {first} is picked as meeting leader (or appointed), the week lands here with a 5-trait radar.</p>
        )}
        {(history.length > 0 || open) && (
          <div className="lg:flex lg:items-start lg:gap-5">
            <div className="mx-auto lg:mx-0 w-[220px] shrink-0" dangerouslySetInnerHTML={{ __html: radar }} />
            <div className="flex-1 mt-2 lg:mt-0">
              {TRAIT_ORDER.map((k) => {
                const v = traits ? traits[k] : null;
                const pct = v === null || v === undefined ? 0 : (v / 5) * 100;
                return (
                  <button key={k} type="button" onClick={() => setExplain(explain === k ? null : k)} className="w-full text-left flex items-center gap-2 py-1">
                    <span className="w-[104px] text-[11.5px] font-black text-kaya-chocolate">{TRAIT_META[k].emoji} {TRAIT_META[k].label}</span>
                    <span className="flex-1 h-2.5 rounded-full bg-kaya-cream overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: GOLD }} /></span>
                    <span className="w-7 text-right text-[11.5px] font-black text-kaya-sand">{v === null || v === undefined ? '–' : v}</span>
                  </button>
                );
              })}
              {explain && (
                <p className="mt-1.5 text-[11.5px] font-bold text-kaya-chocolate-light rounded-xl bg-kaya-warm px-3 py-2">
                  {latestSealed ? explainTrait(explain, latestSealed) : TRAIT_META[explain].explain}
                  {history.length > 1 ? <span className="block text-[10.5px] text-kaya-sand mt-0.5">Radar = average of the last {Math.min(history.length, 6)} weeks · reason shown for the latest.</span> : null}
                </p>
              )}
            </div>
          </div>
        )}
        {!compact && history.length > 0 && (
          <div className="mt-3 border-t border-kaya-warm-dark/60 pt-3">
            <p className="text-[10px] font-nunito font-black uppercase tracking-[1.2px] text-kaya-sand mb-1.5">Weeks as leader</p>
            <ul className="space-y-1.5">
              {shown.map((t) => (
                <li key={t.id} className="text-[12px] font-bold text-kaya-chocolate flex items-start gap-2">
                  <span className="shrink-0">👑</span>
                  <span className="flex-1 min-w-0">
                    {fmtDay(t.startAt)} · {t.style || 'sealed'} · {t.counts ? `${t.counts.approved + t.counts.adjusted} notes` : '—'}{t.ledMeeting ? ' · led the meeting 🎤' : ''}{t.honest ? ' · Honest ✓' : ''}{t.mission?.done ? ' · Mission ✓' : ''}{t.bonusPoints ? ` · +${t.bonusPoints} bonus` : ''}
                    {t.advice ? <span className="block text-[11px] text-kaya-sand italic">“{t.advice}”</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {history.length > 4 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-[11px] font-black" style={{ color: GOLD }}>{showAll ? 'Show fewer' : `Show all ${history.length}`}</button>
            )}
          </div>
        )}
        {(history.length > 0 || open) && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" disabled={sharing} onClick={share} className="px-3.5 py-2 rounded-full text-[12px] font-black text-white disabled:opacity-60" style={{ background: '#1F2A44' }}>{sharing ? '…' : '📤 Share PNG'}</button>
            {viewer === 'parent' && (
              <Link href={`/recognition?kid=${childId}`} className="px-3.5 py-2 rounded-full text-[12px] font-black bg-kaya-cream text-kaya-chocolate">🌟 Make a Shine Card</Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
