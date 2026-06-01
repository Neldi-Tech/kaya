'use client';

// Kaya Wealth — the family Vault (Phase 1 · 2026-06-01).
//
// Screen-for-screen with the APPROVED mockup
// (Kaya Wealth/Kaya-Wealth_Vault-Mockup_v5_FINAL_2026-05-31.html). Styling
// lives in ./wealth.css (a 1:1 port of the mockup, scoped under `.kw`).
//
// Phase 1 wires the LIVE pieces: the 3-view vault (Shared / Personal /
// Juniors), the net-worth heroes, the class-grouped Asset Register with its
// immutable edit log, the TZS⇄USD currency toggle, and the vault lock
// shell. The lock is a session gate here; real TOTP verification + biometric
// land in the next PR. Income Engine, Stock Markets, Bank Accounts and
// Legacy render as the approved design (illustrative) and are wired in
// Phase 2 per the concept note §15.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { formatCents } from '@/components/pantry/format';
import { fmt } from '@/lib/format';
import { computeWealthSummary, type WealthAsset, type WealthSummary } from '@/lib/wealth';
import { useWealthData } from '@/components/wealth/useWealthData';
import AssetRegister from '@/components/wealth/AssetRegister';
import { compactCents, curLabel, kcFromUsdCents } from '@/components/wealth/wealthFormat';
import VaultLock from '@/components/wealth/VaultLock';
import WealthDocuments from '@/components/wealth/WealthDocuments';
import BankVault from '@/components/wealth/BankVault';
import './wealth.css';

type Mode = 'shared' | 'personal' | 'juniors';
const UNLOCK_KEY = 'kw_unlocked';
const IDLE_MS = 5 * 60 * 1000;

export default function KayaWealthPage() {
  const data = useWealthData();
  const { children } = useFamily();
  const { householdCurrency, rateFor, usdPerHousehold, author, isParent, loading } = data;

  const [mode, setMode] = useState<Mode>('shared');
  const [benchmark, setBenchmark] = useState(false); // false = household, true = USD
  const [locked, setLocked] = useState(true);

  // Session unlock — persists across in-app navigation, re-locks on a fresh
  // session and after idle. (Real TOTP verification arrives next PR.)
  useEffect(() => {
    setLocked(sessionStorage.getItem(UNLOCK_KEY) !== '1');
  }, []);
  const unlock = () => { sessionStorage.setItem(UNLOCK_KEY, '1'); setLocked(false); };
  const relock = () => { sessionStorage.removeItem(UNLOCK_KEY); setLocked(true); };

  // Idle auto-lock.
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (locked) return;
    const reset = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      idleRef.current = setTimeout(relock, IDLE_MS);
    };
    const evts = ['pointerdown', 'keydown', 'scroll'] as const;
    evts.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      evts.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [locked]);

  // ── Per-view summaries (live) ──────────────────────────────────────
  const sharedSummary = useMemo(
    () => computeWealthSummary(data.assets.filter((a) => a.visibility === 'shared'), householdCurrency, rateFor),
    [data.assets, householdCurrency, rateFor],
  );
  const personalSummary = useMemo(
    () => computeWealthSummary(
      data.assets.filter((a) => a.visibility === 'personal' && a.ownerId === author.uid),
      householdCurrency, rateFor,
    ),
    [data.assets, householdCurrency, rateFor, author.uid],
  );

  const initials = (author.name || 'You').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  if (!loading && !isParent) {
    return (
      <div className="kw"><div className="app"><div className="card" style={{ marginTop: 40 }}>
        <div className="empty"><div className="ee">🔒</div><div className="eh">Kaya Wealth is a parent space</div>
        <div className="ep">The family vault is managed by parents. Ask a parent to share what&apos;s relevant with you.</div></div>
      </div></div></div>
    );
  }

  return (
    <div className={`kw mode-${mode}`}>
      {/* LOCK */}
      <div className={`lockscreen ${locked ? '' : 'hidden'}`}>
        <VaultLock onUnlock={unlock} />
      </div>

      <div className="app">
        {/* TOP BAR */}
        <div className="topbar">
          <div className="brand">
            <svg className="mark" viewBox="0 0 48 48"><path d="M24 4 L43 19 V44 H5 V19 Z" fill="#0F1F44" /><rect x="13" y="24" width="22" height="15" rx="2.5" fill="#FBF7EE" /><polyline points="16,36 21,31 26,33 33,26" fill="none" stroke="#D4A847" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="33" cy="26" r="2.4" fill="#D4A847" /></svg>
            <div><h1>Kaya <span>Wealth</span></h1><div className="sub">🔒 Vault · <span className="secured">2FA secured</span></div></div>
          </div>
          <div className="topright">
            <div className="curtog">
              <button className={!benchmark ? 'on' : ''} onClick={() => setBenchmark(false)}>{householdCurrency}</button>
              <button className={benchmark ? 'on' : ''} onClick={() => setBenchmark(true)}>US$</button>
            </div>
            <button className="relock" onClick={relock}>Lock</button>
            <div className="ava">{initials}</div>
          </div>
        </div>

        {/* MODE TOGGLE */}
        <div className="modebar">
          <div className="seg">
            <button className={mode === 'shared' ? 'active' : ''} data-m="shared" onClick={() => setMode('shared')}><span className="d" />Shared</button>
            <button className={mode === 'personal' ? 'active' : ''} data-m="personal" onClick={() => setMode('personal')}><span className="d" />Personal</button>
            <button className={mode === 'juniors' ? 'active' : ''} data-m="juniors" onClick={() => setMode('juniors')}><span className="d" />Juniors</button>
          </div>
          <div className="mode-hint">
            {mode === 'shared' && <><b>Shared view</b> — what the family sees together. Dual approval for sensitive changes.</>}
            {mode === 'personal' && <><b>Personal view</b> — private to your ID. Hidden even from the family admin.</>}
            {mode === 'juniors' && <><b>Juniors</b> — your children&apos;s wealth. Parents set the eligibility age; guided until 18.</>}
          </div>
        </div>

        {/* HEROES */}
        {mode === 'shared' && (
          <Hero variant="" label="Shared Family Net Worth" privPill="👥 both parents"
            summary={sharedSummary} benchmark={benchmark} householdCurrency={householdCurrency}
            usdPerHousehold={usdPerHousehold} delta="▲ Secured & tracked" />
        )}
        {mode === 'personal' && (
          <Hero variant="personal" label="My Personal Net Worth" privPill="🔐 only you"
            summary={personalSummary} benchmark={benchmark} householdCurrency={householdCurrency}
            usdPerHousehold={usdPerHousehold} delta="▲ Private to you" />
        )}
        {mode === 'juniors' && (
          <JuniorHero kids={children} assets={data.assets} householdCurrency={householdCurrency}
            rateFor={rateFor} benchmark={benchmark} usdPerHousehold={usdPerHousehold} />
        )}

        {/* ADULT SECTIONS (shared + personal) */}
        {(mode === 'shared' || mode === 'personal') && (
          <>
            <IncomeEngine mode={mode} />
            <StockMarkets />
            <AssetRegister data={data} view={mode === 'shared' ? 'shared' : 'personal'} />
            <WealthDocuments data={data} view={mode === 'shared' ? 'shared' : 'personal'} />
          </>
        )}

        {/* PERSONAL-ONLY SECTIONS */}
        {mode === 'personal' && (
          <>
            <BankVault uid={author.uid} />
            <Legacy />
          </>
        )}

        {/* JUNIORS */}
        {mode === 'juniors' && (
          <Juniors kids={children} assets={data.assets} householdCurrency={householdCurrency} rateFor={rateFor} />
        )}

        <div className="footnote">
          Kaya Wealth · the family Vault · navy/gold premium · violet = Personal · green = Juniors.<br />
          Local markets, Income Engine, Bank vault &amp; Legacy arrive in Phase 2.
        </div>
      </div>
    </div>
  );
}

// VaultLock lives in components/wealth/VaultLock.tsx (real TOTP 2FA · PR2).

// ── Hero (shared / personal) ─────────────────────────────────────────

function heroMeta(s: WealthSummary) {
  const liq = (l: string) => s.byLiquidity.find((x) => x.liquidity === l)?.cents ?? 0;
  const liquid = liq('high');
  const longTerm = liq('medium') + liq('low') + liq('locked');
  const invested = s.groups.filter((g) => g.def.id === 'public_markets' || g.def.id === 'private_alt')
    .reduce((sum, g) => sum + g.subtotalCents, 0);
  return { liquid, longTerm, invested };
}

function Hero({ variant, label, privPill, summary, benchmark, householdCurrency, usdPerHousehold, delta }: {
  variant: '' | 'personal'; label: string; privPill: string; summary: WealthSummary;
  benchmark: boolean; householdCurrency: string; usdPerHousehold: number | null; delta: string;
}) {
  const nwHousehold = summary.netWorthCents;
  const nwUsd = usdPerHousehold != null ? Math.round(nwHousehold * usdPerHousehold) : null;
  const showUsd = benchmark && nwUsd != null;
  const primaryCents = showUsd ? (nwUsd as number) : nwHousehold;
  const primaryCur = showUsd ? 'USD' : householdCurrency;
  const equivCur = showUsd ? householdCurrency : 'USD';
  const equivCents = showUsd ? nwHousehold : nwUsd;
  const p = compactCents(primaryCents);
  const e = equivCents != null ? compactCents(equivCents) : null;
  const m = heroMeta(summary);

  return (
    <div className={`hero ${variant}`}>
      <div className="hero-grid">
        <div>
          <div className="label">{label} <span className="priv-pill">{privPill}</span></div>
          <div className="networth"><span className="cur">{curLabel(primaryCur)}</span>{p.value}<span className="cur">{p.unit}</span></div>
          <div className="equiv">≈ <b>{e ? `${curLabel(equivCur)} ${e.value}${e.unit}` : '—'}</b> &nbsp;·&nbsp; <span className="kc">KC {fmt(kcFromUsdCents(nwUsd))}</span></div>
          <span className="delta">{delta}</span>
          <div className="hero-meta">
            <div><div className="k">Liquid</div><div className="v">{formatCents(m.liquid, householdCurrency)}</div></div>
            <div><div className="k">Long-term</div><div className="v">{formatCents(m.longTerm, householdCurrency)}</div></div>
            <div><div className="k">Invested</div><div className="v gold">{formatCents(m.invested, householdCurrency)}</div></div>
          </div>
        </div>
        <div><HeroChart variant={variant} /></div>
      </div>
    </div>
  );
}

function HeroChart({ variant }: { variant: '' | 'personal' | 'junior' }) {
  const stroke = variant === 'personal' ? '#cdbdf0' : variant === 'junior' ? '#bfe6c5' : '#D4A847';
  const fillId = `kwf-${variant || 'shared'}`;
  const fillColor = variant === 'personal' ? '#b79cef' : variant === 'junior' ? '#9be0a6' : '#D4A847';
  const line = variant === 'personal' ? '#5a4a8a' : variant === 'junior' ? '#3f6e49' : '#33457a';
  const pts = variant === 'personal'
    ? '0,116 60,110 120,100 180,96 240,80 300,66 360,44'
    : variant === 'junior'
      ? '0,124 60,120 120,112 180,104 240,92 300,78 360,58'
      : '0,112 60,104 120,96 180,82 240,70 300,52 360,30';
  const lastY = pts.split(' ').slice(-1)[0].split(',')[1];
  return (
    <svg className="chart" viewBox="0 0 360 148" preserveAspectRatio="none">
      <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={fillColor} stopOpacity="0.35" /><stop offset="1" stopColor={fillColor} stopOpacity="0" /></linearGradient></defs>
      <line x1="0" y1="118" x2="360" y2="118" stroke={line} />
      <path d={`M${pts.split(' ').join(' L')} L360,148 L0,148 Z`} fill={`url(#${fillId})`} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="360" cy={lastY} r="4.5" fill="#fff" stroke={stroke} strokeWidth="2.5" />
    </svg>
  );
}

// ── Juniors hero + section (live cards) ──────────────────────────────

interface KidLite { id: string; name: string; houseName?: string; houseColor?: string; avatarEmoji?: string; birthday?: string }

function childTotalCents(childId: string, assets: WealthAsset[], householdCurrency: string, rateFor: (c: string) => number) {
  const theirs = assets.filter((a) => a.visibility === 'junior' && a.juniorId === childId);
  return computeWealthSummary(theirs, householdCurrency, rateFor).netWorthCents;
}

function ageFromBirthday(birthday?: string): number | null {
  if (!birthday) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return null;
  const b = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

function JuniorHero({ kids, assets, householdCurrency, rateFor, benchmark, usdPerHousehold }: {
  kids: KidLite[]; assets: WealthAsset[]; householdCurrency: string; rateFor: (c: string) => number;
  benchmark: boolean; usdPerHousehold: number | null;
}) {
  const totalCents = (kids ?? []).reduce((s, c) => s + childTotalCents(c.id, assets, householdCurrency, rateFor), 0);
  const nwUsd = usdPerHousehold != null ? Math.round(totalCents * usdPerHousehold) : null;
  const showUsd = benchmark && nwUsd != null;
  const primary = compactCents(showUsd ? (nwUsd as number) : totalCents);
  const primaryCur = showUsd ? 'USD' : householdCurrency;
  return (
    <div className="hero junior">
      <div className="hero-grid">
        <div>
          <div className="label">Kaya Juniors — Combined <span className="priv-pill">👨‍👩‍👧 parent-set age</span></div>
          <div className="networth"><span className="cur">{curLabel(primaryCur)}</span>{primary.value}<span className="cur">{primary.unit}</span></div>
          <div className="equiv">across enrolled children</div>
          <span className="delta">▲ growing with every chore &amp; gift</span>
          <div className="hero-meta">
            {(kids ?? []).slice(0, 3).map((c) => (
              <div key={c.id}>
                <div className="k">{c.name}{ageFromBirthday(c.birthday) != null ? ` · ${ageFromBirthday(c.birthday)}` : ''}</div>
                <div className="v">{formatCents(childTotalCents(c.id, assets, householdCurrency, rateFor), householdCurrency)}</div>
              </div>
            ))}
          </div>
        </div>
        <div><HeroChart variant="junior" /></div>
      </div>
    </div>
  );
}

function Juniors({ kids, assets, householdCurrency, rateFor }: {
  kids: KidLite[]; assets: WealthAsset[]; householdCurrency: string; rateFor: (c: string) => number;
}) {
  const list = kids ?? [];
  const [selId, setSelId] = useState<string | null>(list[0]?.id ?? null);
  const sel = list.find((k) => k.id === selId) ?? list[0] ?? null;
  const selAssets = sel ? assets.filter((a) => a.visibility === 'junior' && a.juniorId === sel.id) : [];

  return (
    <div className="junior-block">
      <div className="section-title"><h2>🌱 My Children&apos;s Wealth <span className="pilltag">Parent-set age · guided</span></h2></div>

      <div className="kidpick">
        {list.length === 0 && <div className="card" style={{ flex: 1 }}><div className="empty"><div className="ee">🌱</div><div className="eh">No children yet</div><div className="ep">Add children to your family to start their guided wealth.</div></div></div>}
        {list.map((c) => {
          const total = childTotalCents(c.id, assets, householdCurrency, rateFor);
          const age = ageFromBirthday(c.birthday);
          return (
            <div key={c.id} className={`kidcard ${sel?.id === c.id ? 'sel' : ''}`} onClick={() => setSelId(c.id)} role="button">
              <div className="ka2" style={{ background: c.houseColor || '#9aa0a6' }}>{c.avatarEmoji || c.name.slice(0, 2).toUpperCase()}</div>
              <div className="kname">{c.name}</div>
              <div className="kmeta">{age != null ? `Age ${age}` : ''}{c.houseName ? `${age != null ? ' · ' : ''}${c.houseName}` : ''}</div>
              {total > 0
                ? <div className="knw">{formatCents(total, householdCurrency)}</div>
                : <div className="klock">⚙️ Enroll — parents set the age</div>}
            </div>
          );
        })}
      </div>

      <div className="guidebanner" style={{ marginTop: 14, background: '#eef1f9', borderColor: '#d6dcea' }}>
        <span className="gi">⚙️</span>
        <div className="gt2"><b style={{ color: 'var(--navy)' }}>Parents set the eligibility age.</b> Any child enrolled in Kaya can be added to Kaya Wealth — you decide when each child is ready. There is no fixed minimum.</div>
      </div>
      {sel && (
        <div className="guidebanner" style={{ marginTop: 14 }}>
          <span className="gi">👨‍👩‍👧</span>
          <div className="gt2"><b>{sel.name}&apos;s wealth is parent-guided.</b> You can see and advise on their accounts and investments. They build the habits; you hold the keys — until they turn 18.</div>
        </div>
      )}

      {sel && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="grouphead">
            <div className="gl">🏦 {sel.name}&apos;s Accounts &amp; Investments <span className="liq high">Guided</span></div>
            <div className="gt">{formatCents(childTotalCents(sel.id, assets, householdCurrency, rateFor), householdCurrency)}</div>
          </div>
          {selAssets.length === 0 ? (
            <div className="empty"><div className="ep">No accounts yet for {sel.name}. Junior accounts &amp; gifts can be added here — coming with the Juniors deepening.</div></div>
          ) : (
            selAssets.map((a) => (
              <div className="asset" key={a.id}>
                <div className="icon i-cash">🐷</div>
                <div className="info"><div className="nm">{a.name}</div>{a.meta?.subtitle && <div className="meta">{a.meta.subtitle}</div>}</div>
                <div className="val"><div className="amt">{formatCents(a.valueCents, a.currency)}</div></div>
              </div>
            ))
          )}
        </div>
      )}

      {/* HANDOVER TIMELINE (design — Phase 2 wires the rules) */}
      <div className="section-title" style={{ marginTop: 24 }}><h2>🔄 Guardianship &amp; Handover <span className="pilltag">enrolled → 18 → their own family</span></h2></div>
      <div className="card">
        <div className="timeline">
          <div className="tstep done"><span className="tdot" /><div className="tage">Enrolled</div><div className="tlabel">Parent-set age · fully guided</div></div>
          <div className="tstep now"><span className="tdot" /><div className="tage">Now</div><div className="tlabel">Learning, parents advise</div></div>
          <div className="tstep"><span className="tdot" /><div className="tage">Age 16</div><div className="tlabel">Co-manages · more autonomy</div></div>
          <div className="tstep"><span className="tdot" /><div className="tage">Age 18</div><div className="tlabel">They decide: keep guidance or go private</div></div>
        </div>
        <div className="handnote">🔐 <b>At 18, the child chooses.</b> They can keep parents as advisors, or make the vault fully private — parents lose visibility at their request. The vault is <b>theirs to keep</b>; nothing is reset or taken away.</div>
        <div className="rollover"><span className="ri">🪺</span><div><b>Rollover for life.</b> When they start their own family on Kaya, their Personal vault rolls over with them — every account, asset, document and edit-log entry travels into their adult Kaya Wealth. The early habits compound into a lifetime record.</div></div>
      </div>
    </div>
  );
}

// ── Phase-2 presentational sections (approved design; wired in P2) ─────

function IncomeEngine({ mode }: { mode: Mode }) {
  const shared = mode === 'shared';
  return (
    <div className="adult-block">
      <div className="section-title"><h2>💵 Income Engine <span className="pilltag">Active vs Passive</span></h2><a>Phase 2</a></div>
      <div className="grid g2">
        <div className="card inc">
          <div className="head"><div className="t"><span className="badge b-active">🛠️</span> Active Income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>/ month</small></div>
            <div className="total">{shared ? 'TZS 18.0M' : 'TZS 6.0M'} <small>gross</small></div></div>
          {shared ? (
            <>
              <div className="iline"><span className="l"><span className="ic">💼</span>Salaries (both parents)</span><span className="r">TZS 18.0M</span></div>
              <div className="iline neg"><span className="l"><span className="ic">🧾</span>PAYE &amp; taxes <span className="sub">· 20%</span></span><span className="r">− TZS 3.6M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">🐷</span>Saved to queue <span className="sub">· 34%</span></span><span className="r">+ TZS 6.2M</span></div>
              <div className="iline"><span className="l"><span className="ic">🏠</span>Net to household spend</span><span className="r">TZS 8.2M</span></div>
            </>
          ) : (
            <>
              <div className="iline"><span className="l"><span className="ic">💼</span>Director fees</span><span className="r">TZS 6.0M</span></div>
              <div className="iline neg"><span className="l"><span className="ic">🧾</span>Taxes <span className="sub">· 18%</span></span><span className="r">− TZS 1.1M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">🐷</span>Saved <span className="sub">· 40%</span></span><span className="r">+ TZS 2.4M</span></div>
            </>
          )}
        </div>
        <div className="card inc">
          <div className="head"><div className="t"><span className="badge b-passive">🌙</span> Passive Income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>/ month</small></div>
            <div className="total">{shared ? 'TZS 5.84M' : 'TZS 0.95M'}</div></div>
          {shared ? (
            <>
              <div className="iline pos"><span className="l"><span className="ic">📜</span>Bond coupons</span><span className="r">+ TZS 2.25M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">🏦</span>Fixed-deposit interest</span><span className="r">+ TZS 0.69M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">📈</span>Dividends (DSE)</span><span className="r">+ TZS 1.10M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">🏘️</span>Rental income</span><span className="r">+ TZS 1.80M</span></div>
            </>
          ) : (
            <>
              <div className="iline pos"><span className="l"><span className="ic">🏦</span>Fixed-deposit interest</span><span className="r">+ TZS 0.35M</span></div>
              <div className="iline pos"><span className="l"><span className="ic">📜</span>T-bill yield</span><span className="r">+ TZS 0.60M</span></div>
            </>
          )}
          <div className="cover">
            <div className="cmrow"><span className="g">Passive covers your monthly expenses</span><span className="p">{shared ? 'TZS 5.84M / 9.5M' : 'TZS 0.95M / 3.2M'}</span></div>
            <div className="track"><i style={{ width: shared ? '61%' : '30%' }} /></div>
            <div className="fi">🎯 {shared ? '61%' : '30%'} to financial independence — when passive ≥ expenses</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StockMarkets() {
  return (
    <div className="adult-block">
      <div className="section-title"><h2>📡 Stock Markets <span className="pilltag">Local · Live + AI</span></h2><a>Phase 2</a></div>
      <div className="grid g2">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--navy)' }}>🇹🇿 Dar es Salaam · DSE</div>
            <span className="live"><span className="blink" />LIVE</span>
          </div>
          <div className="market"><div className="t">CRDB<small>CRDB Bank</small></div><svg className="spark" viewBox="0 0 64 24"><polyline points="0,18 13,15 26,16 39,10 52,8 64,5" fill="none" stroke="#2E7D34" strokeWidth="2" /></svg><div className="p"><div className="px">TZS 640</div><div className="pc up">+2.4%</div></div></div>
          <div className="market"><div className="t">DSE ASI<small>All-Share Index</small></div><svg className="spark" viewBox="0 0 64 24"><polyline points="0,12 13,14 26,10 39,12 52,7 64,6" fill="none" stroke="#2E7D34" strokeWidth="2" /></svg><div className="p"><div className="px">2,114</div><div className="pc up">+0.8%</div></div></div>
          <div className="market"><div className="t">TBL<small>Tanzania Breweries</small></div><svg className="spark" viewBox="0 0 64 24"><polyline points="0,8 13,10 26,9 39,14 52,15 64,17" fill="none" stroke="#E85C5C" strokeWidth="2" /></svg><div className="p"><div className="px">TZS 10,900</div><div className="pc down">−1.1%</div></div></div>
          <div className="aiupdate"><span className="ai-orb" /><div><b>AI market update:</b> Local exchange feed + plain-language updates tied to your holdings arrive in Phase 2.</div></div>
        </div>
        <div className="card glocked">
          <div className="gtitle">🌍 Global Markets <span className="tag" style={{ background: '#fbf3df', color: '#9a7b27' }}>🔒 Locked</span></div>
          <div className="grow"><span>NYSE · S&amp;P 500</span><span>4,930 ▲ 0.4%</span></div>
          <div className="grow"><span>NASDAQ Composite</span><span>15,620 ▲ 0.6%</span></div>
          <div className="grow"><span>LSE · FTSE 100</span><span>7,690 ▼ 0.2%</span></div>
          <button className="glock-cta">⭐ Unlock global markets — Phase 3 (paid)</button>
          <div className="glock-note">Kaya Wealth shows your <b>local exchange (DSE)</b> first. Global data &amp; AI-assisted live trading is a future paid upgrade — it requires brokerage licensing, KYC, and stronger AI safeguards before any live trade is allowed.</div>
        </div>
      </div>
    </div>
  );
}

// DocumentVault → components/wealth/WealthDocuments.tsx (live gallery + scanner · PR3).

// BankAccounts → components/wealth/BankVault.tsx (live, step-up 2FA · PR5).

function Legacy() {
  return (
    <div className="personal-block">
      <div className="section-title"><h2>🕊️ Legacy &amp; Next of Kin <span className="pilltag">Personal vault only</span></h2></div>
      <div className="grid g2">
        <div className="kin">
          <div className="h"><div className="ki">🔑</div><div className="t">Inactivity Transfer<small>A safe handover if something happens to you</small></div></div>
          <p className="exp">If your vault is inactive for the period you set, Kaya privately releases your Personal vault to your chosen next of kin — in order. Nothing is shared while you are active.</p>
          <div className="cond">
            <div className="row"><span className="lab">Release after inactivity of</span><span className="mval" style={{ color: '#cdbdf0' }}>6 months</span></div>
            <div className="row"><span className="lab">Pre-release check-in reminders</span><span className="mval" style={{ color: '#cdbdf0' }}>On</span></div>
          </div>
          <div className="kin-note">ℹ️ Minimum 6 months. Kaya sends repeated confirmations before any release is triggered. <b>(Phase 2.)</b></div>
        </div>
        <div className="kin" style={{ background: 'linear-gradient(135deg,#2c2150,#241a44)' }}>
          <div className="h"><div className="ki">👪</div><div className="t">Chosen Next of Kin<small>At least 2 required · released in order</small></div></div>
          <div className="kin-list">
            <div className="kinrow"><div className="ka">+</div><div className="kn">Add your first of kin<small>Spouse, child, sibling…</small></div><span className="order">1st</span></div>
          </div>
          <button className="add-kin">+ Add next of kin</button>
          <div className="kin-note">🔐 Each kin verifies identity (2FA) before receiving anything. Re-order or remove anyone, anytime.</div>
        </div>
      </div>
    </div>
  );
}
