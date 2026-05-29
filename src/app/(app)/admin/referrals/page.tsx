'use client';

// /admin/referrals — operator-only Kaya Coins console.
//
// Lists every family with its KC balance + referral standing. Open a row
// to: manually GRANT KC, REDEEM KC → tier time (Home/Castle, 1–12 months),
// and review the family's ledger. All writes go through the operator-gated
// /api/admin/referrals/{grant,redeem} routes; the balance is server-owned.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { toDisplayDate } from '@/lib/dates';
import {
  KC_TIER_DURATIONS, KC_LEDGER_KIND_META, kcCostForTierGrant,
  formatKc, formatKcUsd, formatCharterNumber, type KcLedgerEntry,
} from '@/lib/referral';
import type { SubscriptionTierId } from '@/lib/tiers';
import { KayaCoin } from '@/components/referral/KayaCoin';
import type {
  AdminReferralRow, AdminReferralDetail, AdminReferralTierSummary,
} from '@/app/api/admin/referrals/route';

async function authedFetch(input: string, init?: RequestInit) {
  const u = auth.currentUser;
  if (!u) throw new Error('not-signed-in');
  const token = await u.getIdToken();
  return fetch(input, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

export default function AdminReferralsPage() {
  const [families, setFamilies] = useState<AdminReferralRow[]>([]);
  const [tiers, setTiers] = useState<AdminReferralTierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewerIsFounder, setViewerIsFounder] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await authedFetch('/api/admin/referrals');
      if (!res.ok) throw new Error(`load-failed-${res.status}`);
      const data = (await res.json()) as { families: AdminReferralRow[]; tiers: AdminReferralTierSummary[]; viewerIsFounder?: boolean };
      setFamilies(data.families);
      setTiers(data.tiers);
      setViewerIsFounder(data.viewerIsFounder === true);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...families].sort((a, b) => b.kayaCoins - a.kayaCoins);
    if (!q) return sorted;
    return sorted.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      (f.handle ?? '').toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q),
    );
  }, [families, query]);

  const open = openId ? families.find((f) => f.id === openId) ?? null : null;
  const totalKc = useMemo(() => families.reduce((s, f) => s + f.kayaCoins, 0), [families]);

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[1100px] mx-auto px-5 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <KayaCoin size={34} />
            <h1 className="font-display font-black text-2xl text-white tracking-tight m-0">Kaya Coins</h1>
          </div>
          <p className="text-white/55 text-[13px] font-semibold ml-12">
            Grant KC, redeem KC → tier time, and audit every family&apos;s ledger. 1 KC ≈ ${6} ·{' '}
            {formatKc(totalKc)} KC in circulation.
          </p>
          {!loading && !err && !viewerIsFounder && (
            <p className="text-[#D4A847]/80 text-[12px] font-bold ml-12 mt-1">
              👀 View-only — minting &amp; redeeming KC is limited to the Founding Family.
            </p>
          )}
        </header>

        <div
          className="rounded-2xl p-3 mb-4"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by family name, handle, or ID…"
            className="w-full bg-transparent text-white text-[14px] font-semibold placeholder-white/40 outline-none px-2"
          />
        </div>

        {loading && <div className="text-white/55 text-sm py-12 text-center">Loading families…</div>}
        {err && (
          <div className="text-[#FF7676] text-sm py-12 text-center bg-white/5 rounded-2xl">
            Couldn&apos;t load: <code>{err}</code>
          </div>
        )}

        {!loading && !err && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-white/45 font-bold uppercase tracking-wider px-3 mb-1">
              {filtered.length} {filtered.length === 1 ? 'family' : 'families'} · sorted by balance
            </div>
            {filtered.map((f) => (
              <ReferralRow key={f.id} family={f} onOpen={() => setOpenId(f.id)} />
            ))}
            {filtered.length === 0 && (
              <div className="text-white/45 text-sm py-12 text-center">No families match that search.</div>
            )}
          </div>
        )}
      </div>

      {open && (
        <ManageDrawer
          family={open}
          tiers={tiers}
          canManage={viewerIsFounder}
          onClose={() => setOpenId(null)}
          onMutated={reload}
        />
      )}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────

function ReferralRow({ family, onOpen }: { family: AdminReferralRow; onOpen: () => void }) {
  return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center gap-4 transition-colors hover:bg-white/8"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-white font-black text-[14px] truncate">{family.name}</div>
          {family.handle && <span className="text-[#D4A847] text-[12px] font-bold">@{family.handle}</span>}
          {family.isFoundingFamily && (
            <span className="rounded-full text-[10px] font-black px-2 py-0.5" style={{ background: 'rgba(212,168,71,0.18)', color: '#D4A847' }}>
              🤝 Charter{formatCharterNumber(family.charterNumber) ? ` ${formatCharterNumber(family.charterNumber)}` : ''}
            </span>
          )}
        </div>
        <div className="text-white/55 text-[12px] font-semibold mt-0.5 flex items-center gap-3 flex-wrap">
          <span>{family.effectiveCount} referral{family.effectiveCount === 1 ? '' : 's'}</span>
          {family.topBadgeName && (<><span>·</span><span className="text-[#D4A847]">{family.topBadgeName}</span></>)}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[#D4A847] font-black text-[18px] leading-none flex items-center gap-1 justify-end">
          <KayaCoin size={16} />{formatKc(family.kayaCoins)}
        </div>
        <div className="text-white/40 text-[10px] font-bold mt-0.5">≈ {formatKcUsd(family.kayaCoins)}</div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="text-[12px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
        style={{ background: '#D4A847', color: '#0F1F44' }}
      >
        Manage
      </button>
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────

function ManageDrawer({
  family, tiers, canManage, onClose, onMutated,
}: {
  family: AdminReferralRow;
  tiers: AdminReferralTierSummary[];
  canManage: boolean;
  onClose: () => void;
  onMutated: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<AdminReferralDetail | null>(null);
  const [balance, setBalance] = useState(family.kayaCoins);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Grant form
  const [grantAmount, setGrantAmount] = useState('');
  const [grantReason, setGrantReason] = useState('');

  // Redeem form
  const [redeemTier, setRedeemTier] = useState<SubscriptionTierId>(tiers[0]?.id ?? 'home');
  const [redeemDurationId, setRedeemDurationId] = useState(KC_TIER_DURATIONS[0].id);

  const loadDetail = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/referrals?familyId=${encodeURIComponent(family.id)}`);
      if (!res.ok) throw new Error(`detail-${res.status}`);
      const { detail: d } = (await res.json()) as { detail: AdminReferralDetail };
      setDetail(d);
      setBalance(d.kayaCoins);
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e instanceof Error ? e.message : e) });
    }
  }, [family.id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const selectedTier = tiers.find((t) => t.id === redeemTier) ?? null;
  const selectedDuration = KC_TIER_DURATIONS.find((d) => d.id === redeemDurationId)!;
  const redeemCost = selectedTier ? kcCostForTierGrant(selectedTier.priceMonthly, selectedDuration.months) : 0;
  const canAfford = balance >= redeemCost && redeemCost > 0;

  const doGrant = async () => {
    const amount = Number(grantAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setFlash({ kind: 'err', msg: 'Enter an amount above 0' }); return; }
    setBusy(true); setFlash(null);
    try {
      const res = await authedFetch('/api/admin/referrals/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ familyId: family.id, amount, reason: grantReason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `grant-${res.status}`);
      setBalance(data.balanceAfter);
      setGrantAmount(''); setGrantReason('');
      setFlash({ kind: 'ok', msg: `Granted ${formatKc(amount)} KC · new balance ${formatKc(data.balanceAfter)} KC` });
      await Promise.all([loadDetail(), onMutated()]);
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e instanceof Error ? e.message : e) });
    } finally { setBusy(false); }
  };

  const doRedeem = async () => {
    if (!canAfford) { setFlash({ kind: 'err', msg: 'Not enough KC for that grant' }); return; }
    setBusy(true); setFlash(null);
    try {
      const res = await authedFetch('/api/admin/referrals/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ familyId: family.id, tierId: redeemTier, durationId: redeemDurationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `redeem-${res.status}`);
      setBalance(data.balanceAfter);
      setFlash({ kind: 'ok', msg: `−${formatKc(data.cost)} KC → ${selectedTier?.name} · ${selectedDuration.label}. Balance ${formatKc(data.balanceAfter)} KC` });
      await Promise.all([loadDetail(), onMutated()]);
    } catch (e) {
      setFlash({ kind: 'err', msg: String(e instanceof Error ? e.message : e) });
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 px-4 py-6"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-3xl p-6 max-h-[88vh] overflow-y-auto"
        style={{ background: '#162954', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-white font-black text-lg">{family.name}</div>
            {family.handle && <div className="text-[#D4A847] text-[12px] font-bold">@{family.handle}</div>}
          </div>
          <button onClick={onClose} className="text-white/55 text-xl leading-none" aria-label="Close">×</button>
        </div>

        {/* Balance */}
        <div
          className="rounded-2xl p-4 mb-5 flex items-center gap-3"
          style={{ background: 'rgba(212,168,71,0.12)', border: '1px solid rgba(212,168,71,0.3)' }}
        >
          <KayaCoin size={40} />
          <div>
            <div className="text-[#D4A847] font-black text-[26px] leading-none">{formatKc(balance)} KC</div>
            <div className="text-white/55 text-[12px] font-bold mt-1">≈ {formatKcUsd(balance)} value</div>
          </div>
        </div>

        {flash && (
          <div
            className="rounded-xl px-3 py-2.5 mb-4 text-[12px] font-bold"
            style={flash.kind === 'ok'
              ? { background: 'rgba(91,184,91,0.15)', color: '#7BD389', border: '1px solid rgba(91,184,91,0.3)' }
              : { background: 'rgba(232,92,92,0.15)', color: '#FF7676', border: '1px solid rgba(232,92,92,0.3)' }}
          >
            {flash.msg}
          </div>
        )}

        {canManage ? (<>
        {/* Grant */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">🎁 Grant KC</div>
          <div className="flex items-end gap-2">
            <div className="w-28">
              <div className="text-[10px] font-black text-white/45 uppercase tracking-wider mb-1">Amount</div>
              <input
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-white text-[14px] font-extrabold outline-none"
              />
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-black text-white/45 uppercase tracking-wider mb-1">Reason (optional)</div>
              <input
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="e.g. Launch thank-you"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-2 text-white text-[13px] font-semibold outline-none"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={doGrant}
            disabled={busy || !grantAmount}
            className="w-full mt-2 text-[13px] font-black py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: '#D4A847', color: '#0F1F44' }}
          >
            {busy ? 'Working…' : `Grant ${grantAmount || '0'} KC`}
          </button>
        </section>

        {/* Redeem → tier */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">🪙 Redeem → tier time</div>
          <div className="flex gap-2 mb-2">
            {tiers.map((t) => {
              const on = redeemTier === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setRedeemTier(t.id)}
                  className="flex-1 rounded-xl px-3 py-2 flex items-center gap-2 transition-colors"
                  style={{
                    background: on ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
                    border: on ? '1px solid rgba(212,168,71,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <span className="text-base">{t.emoji}</span>
                  <span className="text-white font-bold text-[12px]">{t.name}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {KC_TIER_DURATIONS.map((d) => {
              const on = redeemDurationId === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setRedeemDurationId(d.id)}
                  className="rounded-lg px-2 py-1.5 text-[12px] font-black transition-colors"
                  style={{
                    background: on ? '#D4A847' : 'rgba(255,255,255,0.04)',
                    color: on ? '#0F1F44' : 'rgba(255,255,255,0.7)',
                    border: on ? '1px solid #D4A847' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {d.months}mo
                </button>
              );
            })}
          </div>
          <div
            className="rounded-xl px-3 py-2.5 mb-2 flex items-center justify-between"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <span className="text-white/70 text-[12px] font-bold">
              {selectedTier?.name} · {selectedDuration.label}
            </span>
            <span className="text-[#D4A847] text-[14px] font-black">{formatKc(redeemCost)} KC</span>
          </div>
          <button
            type="button"
            onClick={doRedeem}
            disabled={busy || !canAfford}
            className="w-full text-[13px] font-black py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: canAfford ? '#5BB85B' : 'rgba(255,255,255,0.08)', color: canAfford ? '#0F1F44' : 'rgba(255,255,255,0.4)' }}
          >
            {busy ? 'Working…' : canAfford ? `Redeem ${formatKc(redeemCost)} KC` : `Need ${formatKc(redeemCost)} KC (has ${formatKc(balance)})`}
          </button>
          <p className="text-white/40 text-[10px] font-semibold mt-2 leading-relaxed">
            Applies the tier immediately with an expiry {selectedDuration.months} month{selectedDuration.months === 1 ? '' : 's'} out. The family reverts to Nest when it lapses.
          </p>
        </section>
        </>) : (
          <div
            className="rounded-2xl px-4 py-3 mb-5 text-[12px] font-bold leading-relaxed"
            style={{ background: 'rgba(212,168,71,0.1)', border: '1px solid rgba(212,168,71,0.25)', color: '#D4A847' }}
          >
            👀 View-only. Minting &amp; redeeming Kaya Coins is reserved for the Founding Family. You can review balances and the ledger here.
          </div>
        )}

        {/* Ledger */}
        <section>
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Ledger</div>
          {!detail && <div className="text-white/45 text-[12px] py-4 text-center">Loading…</div>}
          {detail && detail.ledger.length === 0 && (
            <div className="text-white/45 text-[12px] py-4 text-center">No entries yet.</div>
          )}
          {detail && detail.ledger.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {detail.ledger.map((e) => <LedgerRow key={e.id} entry={e} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: KcLedgerEntry }) {
  const meta = KC_LEDGER_KIND_META[entry.kind];
  const positive = entry.amount >= 0;
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className="text-base flex-shrink-0">{meta.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="text-white/85 text-[12px] font-bold truncate">{entry.reason || meta.label}</div>
        <div className="text-white/40 text-[10px] font-semibold">
          {entry.createdAtMs ? toDisplayDate(new Date(entry.createdAtMs).toISOString()) : '—'}
          {entry.createdByEmail ? ` · ${entry.createdByEmail}` : ''}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[13px] font-black" style={{ color: positive ? '#7BD389' : '#FF9B9B' }}>
          {positive ? '+' : ''}{formatKc(entry.amount)}
        </div>
        <div className="text-white/35 text-[10px] font-bold">bal {formatKc(entry.balanceAfter)}</div>
      </div>
    </div>
  );
}
