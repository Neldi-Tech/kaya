'use client';

// 🏬 Badge Boutique (BDG PR2 · B9/B10/B11, approved v3 FINAL) — the badge
// storefront inside Manage Rewards: search (name/area/how-earned), area
// shelves, tier filters, badge cards with one-tap release, tap-to-flip
// detail (editable threshold, who earned it, retire) and custom badge
// creation. All edits write family.badgeConfig — badge settings live HERE,
// with the store (Elia's placement rule).

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { updateFamily } from '@/lib/firestore';
import {
  BADGE_AREAS, BADGE_TIERS, TIER_RANK, ROMAN, SET_META, SET_RING,
  familyBadgeSet, isBadgeReleased, badgeThreshold, packForBadge,
  type BadgeDef, type BadgeTier, type BadgeArea, type BadgeConfig,
} from '@/lib/badgeLib';
import BadgePacks from './BadgePacks';
import BadgeStudio from './BadgeStudio';

const TIER_STYLE: Record<BadgeTier, string> = {
  easy: 'bg-[#E7F5EC] text-pantry-leaf-dk border-[#bfe0cc]',
  medium: 'bg-kaya-gold-light text-kaya-gold-dark border-kaya-gold/50',
  hard: 'bg-[#FCEAEA] text-hive-rose border-[#f0c8cc]',
  legendary: 'bg-[#F3F0FF] text-[#7B61FF] border-[#D9D2FF]',
};

export default function BadgeBoutique() {
  const { profile } = useAuth();
  const { family, children, refresh } = useFamily();
  const cfg: BadgeConfig | undefined = family?.badgeConfig;

  const [q, setQ] = useState('');
  const [area, setArea] = useState<BadgeArea | null>(null);
  const [tier, setTier] = useState<BadgeTier | null>(null);
  const [releasedOnly, setReleasedOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thDraft, setThDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState('');
  const [cIcon, setCIcon] = useState('🏅');
  const [cTier, setCTier] = useState<BadgeTier>('medium');
  const [cArea, setCArea] = useState<BadgeArea>('points');
  const [cHow, setCHow] = useState('');
  const [cPoints, setCPoints] = useState('');

  const all = useMemo(() => familyBadgeSet(cfg), [cfg]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((b) => {
      if (area && b.area !== area) return false;
      if (tier && b.tier !== tier) return false;
      if (releasedOnly && !isBadgeReleased(cfg, b)) return false;
      if (needle) {
        const areaLabel = BADGE_AREAS.find((a) => a.id === b.area)?.label ?? '';
        if (!`${b.name} ${b.how} ${areaLabel}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  }, [all, q, area, tier, releasedOnly, cfg]);

  const releasedCount = all.filter((b) => isBadgeReleased(cfg, b)).length;

  const saveCfg = async (patch: Partial<BadgeConfig>) => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    try {
      await updateFamily(profile.familyId, { badgeConfig: { ...(cfg ?? {}), ...patch } } as any);
      await refresh?.();
    } finally { setBusy(false); }
  };

  const toggleRelease = (b: BadgeDef) =>
    saveCfg({ released: { ...(cfg?.released ?? {}), [b.id]: !isBadgeReleased(cfg, b) } });

  const saveThreshold = (b: BadgeDef) => {
    const n = parseInt(thDraft, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    return saveCfg({ thresholds: { ...(cfg?.thresholds ?? {}), [b.id]: n } });
  };

  const createCustom = async () => {
    if (!cName.trim() || busy) return;
    const id = `custom-${cName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
    const pts = parseInt(cPoints, 10);
    await saveCfg({
      customs: [
        ...(cfg?.customs ?? []),
        {
          id, name: cName.trim(), icon: cIcon.trim() || '🏅', tier: cTier, area: cArea,
          how: cHow.trim() || (pts > 0 ? `Earn ${pts.toLocaleString('en-US')} lifetime points` : 'Awarded by a parent'),
          ...(Number.isFinite(pts) && pts > 0 ? { pointsThreshold: pts } : {}),
        },
      ],
      released: { ...(cfg?.released ?? {}), [id]: true },
    });
    setCreating(false); setCName(''); setCHow(''); setCPoints('');
  };

  const whoEarned = (b: BadgeDef) => children.filter((c) => (c.badges || []).includes(b.id));

  return (
    <div className="rounded-kaya-lg p-4 text-white" style={{ background: 'linear-gradient(160deg,#241a0e,#3a2c15 55%,#4a3a1c)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="font-display font-extrabold text-[17px]">🏬 Badge Boutique</p>
          <p className="text-[11.5px] font-bold" style={{ color: '#d9c89a' }}>{all.length} badges · {releasedCount} released to your family</p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='🔎 Search… "kind", "quiz", "saver"'
          className="flex-1 min-w-[200px] max-w-[340px] rounded-full px-4 py-2 text-[12.5px] font-bold text-white placeholder:text-[#d9c89a] focus:outline-none"
          style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)' }}
          aria-label="Search badges"
        />
      </div>

      {/* 🎁 BDG PR5 — seasonal packs, released with one tap. */}
      <BadgePacks />

      <div className="flex flex-wrap gap-1 mb-1">
        <button onClick={() => setArea(null)} className="px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border" style={area === null ? { background: '#F0A32A', borderColor: '#F0A32A', color: '#241a0e' } : { borderColor: 'rgba(255,255,255,.3)', color: '#f3e7c8' }}>All areas</button>
        {BADGE_AREAS.map((a) => (
          <button key={a.id} onClick={() => setArea(area === a.id ? null : a.id)} className="px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border" style={area === a.id ? { background: '#F0A32A', borderColor: '#F0A32A', color: '#241a0e' } : { borderColor: 'rgba(255,255,255,.3)', color: '#f3e7c8' }}>{a.emoji} {a.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {(Object.keys(BADGE_TIERS) as BadgeTier[]).map((t) => (
          <button key={t} onClick={() => setTier(tier === t ? null : t)} className="px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border" style={tier === t ? { background: '#F0A32A', borderColor: '#F0A32A', color: '#241a0e' } : { borderColor: 'rgba(255,255,255,.3)', color: '#f3e7c8' }}>{BADGE_TIERS[t].emoji} {BADGE_TIERS[t].label}</button>
        ))}
        <button onClick={() => setReleasedOnly((v) => !v)} className="ml-auto px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border border-dashed" style={releasedOnly ? { background: '#F0A32A', borderColor: '#F0A32A', color: '#241a0e' } : { borderColor: 'rgba(255,255,255,.4)', color: '#f3e7c8' }}>released only</button>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {visible.map((b) => {
          const rel = isBadgeReleased(cfg, b);
          const open = openId === b.id;
          const t = badgeThreshold(cfg, b);
          const earnedBy = whoEarned(b);
          return (
            <div
              key={b.id}
              className="rounded-2xl p-3 text-center relative cursor-pointer transition-transform hover:scale-[1.02]"
              style={{ background: rel ? 'rgba(240,163,42,.16)' : 'rgba(255,255,255,.08)', border: `1px solid ${rel ? '#F0A32A' : 'rgba(255,255,255,.18)'}`, gridColumn: open ? '1 / -1' : undefined }}
              onClick={() => { setOpenId(open ? null : b.id); setThDraft(String(t || '')); }}
              role="button"
              aria-expanded={open}
            >
              <span className="absolute top-1.5 left-1.5 text-[10px]">{BADGE_TIERS[b.tier].emoji}</span>
              {!open ? (
                <>
                  <p className="text-[28px]" style={{ filter: 'drop-shadow(0 3px 8px rgba(240,163,42,.4))' }}>{b.icon}</p>
                  <p className="font-extrabold text-[12px] mt-1">
                    {b.name}
                    {/* ✨ evolving set: same chase, richer shell (bronze → gold) */}
                    {b.set && (
                      <span
                        className="ml-1 inline-block px-1.5 rounded-full text-[9px] font-black align-middle"
                        style={{ border: `1.5px solid ${SET_RING[b.set.level]}`, color: SET_RING[b.set.level] }}
                        title={`${SET_META[b.set.id]?.label ?? 'Set'} ${ROMAN[b.set.level]}`}
                      >
                        {ROMAN[b.set.level]}
                      </span>
                    )}
                  </p>
                  <p className="text-[9.5px] font-bold leading-snug mt-0.5" style={{ color: '#d9c89a' }}>{b.how}</p>
                  {packForBadge(b.id) && (
                    <p className="text-[9px] font-black mt-0.5" style={{ color: '#F0A32A' }}>
                      {packForBadge(b.id)!.emoji} {packForBadge(b.id)!.name}
                      {packForBadge(b.id)!.window ? ' · ⏳ limited' : ''}
                    </p>
                  )}
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[9.5px] font-black" style={b.pending ? { background: 'rgba(255,255,255,.10)', color: '#c9b789' } : rel ? { background: '#F0A32A', color: '#241a0e' } : { background: 'rgba(255,255,255,.15)', color: '#f3e7c8' }}>{b.pending ? '🔜 coming soon' : rel ? '✓ released' : '＋ release'}</span>
                </>
              ) : (
                <div className="text-left" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-extrabold text-[14px]">{b.icon} {b.name} <span className="text-[10px]">{BADGE_TIERS[b.tier].emoji} {BADGE_TIERS[b.tier].label}</span></p>
                    <button onClick={() => setOpenId(null)} className="text-[12px] font-black" style={{ color: '#d9c89a' }}>✕</button>
                  </div>
                  <p className="text-[11.5px] font-bold mt-1" style={{ color: '#d9c89a' }}>{b.how}</p>
                  {'threshold' in b.signal && (
                    <div className="flex items-center gap-2 mt-2">
                      <label className="text-[11px] font-bold" style={{ color: '#d9c89a' }}>Threshold</label>
                      <input type="number" min={1} value={thDraft} onChange={(e) => setThDraft(e.target.value)} className="w-24 rounded-lg px-2 py-1 text-[12px] font-black text-right text-white" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' }} />
                      <button disabled={busy} onClick={() => void saveThreshold(b)} className="px-2.5 py-1 rounded-lg text-[11px] font-black" style={{ background: '#F0A32A', color: '#241a0e' }}>Save</button>
                    </div>
                  )}
                  <p className="text-[11px] font-bold mt-2" style={{ color: '#d9c89a' }}>
                    {earnedBy.length > 0 ? <>Earned by: {earnedBy.map((c) => `${c.avatarEmoji || '🧒'} ${c.name.split(' ')[0]}`).join(' · ')}</> : 'Nobody has this one yet — a fresh chase!'}
                  </p>
                  {b.pending ? (
                    <p className="mt-2 text-[11px] font-bold" style={{ color: '#c9b789' }}>
                      🔜 Kaya isn&apos;t counting this one yet — it opens as soon as its tracking lands, and nothing here is lost in the meantime.
                    </p>
                  ) : (
                    <button disabled={busy} onClick={() => void toggleRelease(b)} className="mt-2 px-3 py-1.5 rounded-full text-[11px] font-black" style={isBadgeReleased(cfg, b) ? { background: 'rgba(255,255,255,.15)', color: '#f3e7c8' } : { background: '#F0A32A', color: '#241a0e' }}>
                      {isBadgeReleased(cfg, b) ? 'Retire from family' : '＋ Release to family'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 🪄 custom creation card */}
        <div className="rounded-2xl p-3 text-center border border-dashed cursor-pointer" style={{ borderColor: 'rgba(255,255,255,.35)', gridColumn: creating ? '1 / -1' : undefined }} onClick={() => !creating && setCreating(true)} role="button">
          {!creating ? (
            <>
              <p className="text-[28px]">🪄</p>
              <p className="font-extrabold text-[12px] mt-1">Your badge…</p>
              <p className="text-[9.5px] font-bold mt-0.5" style={{ color: '#d9c89a' }}>name · icon · tier · points</p>
            </>
          ) : (
            <div className="text-left" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between"><p className="font-extrabold text-[13px]">🪄 Create a badge</p><button onClick={() => setCreating(false)} className="text-[12px] font-black" style={{ color: '#d9c89a' }}>✕</button></div>
              <div className="grid gap-1.5 mt-2" style={{ gridTemplateColumns: '56px 1fr' }}>
                <input value={cIcon} onChange={(e) => setCIcon(e.target.value)} maxLength={4} className="rounded-lg px-2 py-1.5 text-center text-[16px]" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' }} aria-label="Badge icon" />
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Badge name" maxLength={40} className="rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-white" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' }} />
              </div>
              <input value={cHow} onChange={(e) => setCHow(e.target.value)} placeholder="How it's earned (kid voice)" maxLength={90} className="w-full mt-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' }} />
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <select value={cTier} onChange={(e) => setCTier(e.target.value as BadgeTier)} className="rounded-lg px-2 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)', color: '#f3e7c8' }} aria-label="Tier">
                  {(Object.keys(BADGE_TIERS) as BadgeTier[]).map((t) => <option key={t} value={t} style={{ color: '#241a0e' }}>{BADGE_TIERS[t].emoji} {BADGE_TIERS[t].label}</option>)}
                </select>
                <select value={cArea} onChange={(e) => setCArea(e.target.value as BadgeArea)} className="rounded-lg px-2 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)', color: '#f3e7c8' }} aria-label="Area">
                  {BADGE_AREAS.map((a) => <option key={a.id} value={a.id} style={{ color: '#241a0e' }}>{a.emoji} {a.label}</option>)}
                </select>
                <input type="number" min={1} value={cPoints} onChange={(e) => setCPoints(e.target.value)} placeholder="pts (opt.)" className="w-24 rounded-lg px-2 py-1 text-[11px] font-bold text-right text-white" style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)' }} aria-label="Points threshold" />
                <button disabled={busy || !cName.trim()} onClick={() => void createCustom()} className="px-3 py-1.5 rounded-full text-[11px] font-black disabled:opacity-50" style={{ background: '#F0A32A', color: '#241a0e' }}>Release ＋</button>
              </div>
              <p className="text-[10px] font-bold mt-1.5" style={{ color: '#d9c89a' }}>With points → earns automatically at the threshold. Without → you award it yourself from the badge card.</p>
            </div>
          )}
        </div>
      </div>
      <p className="text-[10.5px] font-bold italic mt-3" style={{ color: '#d9c89a' }}>Tap a card for the full story, threshold, who&rsquo;s earned it, and release/retire. Search matches names, areas and how-it&rsquo;s-earned words.</p>

      {/* 🪄 BDG PR5 — describe-it-and-Kaya-builds-it, plus 💭 kid wishes. */}
      <BadgeStudio />
    </div>
  );
}
