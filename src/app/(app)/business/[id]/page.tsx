'use client';

// Kaya Business · Business dashboard (kid screen 3). Identity, status, headline
// numbers + margin, lifecycle controls, the Inventory entry point, 1-tap log
// sale/cost, recent activity, and milestone badges. The AI coach (PR5) and
// Junior Investor (PR6) are the remaining "coming next" items.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, HiveSplit, BusinessStatus, LedgerEntry, BusinessMilestone, BUSINESS_MILESTONES,
  subscribeToBusiness, subscribeToBusinessRequests, subscribeToLedger, subscribeToBusinessMilestones,
  setBusinessStatus, requestBusinessLaunch, readBusinessConfig,
} from '@/lib/business';
import { ApprovalRequest } from '@/lib/hive';
import { formatCash } from '@/components/hive/format';
import { typeMeta, STATUS_META } from '@/components/business/meta';
import AICoachCard from '@/components/business/AICoachCard';

const MILESTONE_META = Object.fromEntries(BUSINESS_MILESTONES.map((m) => [m.key, m]));

function fmtDate(ts: any): string {
  const ms = ts?.toMillis?.();
  if (typeof ms !== 'number') return '';
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BusinessDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const coachName = readBusinessConfig(family).coachName;

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [milestones, setMilestones] = useState<BusinessMilestone[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const familyId = profile?.familyId;
  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, (b) => { setBusiness(b); setLoading(false); });
    const u2 = subscribeToBusinessRequests(familyId, setRequests);
    const u3 = subscribeToLedger(familyId, businessId, setLedger, 50);
    return () => { u1(); u2(); u3(); };
  }, [familyId, businessId]);

  // Milestones live under the owner kid — subscribe once we know the owner.
  useEffect(() => {
    if (!familyId || !business?.ownerId) return;
    return subscribeToBusinessMilestones(familyId, business.ownerId, setMilestones);
  }, [familyId, business?.ownerId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const pendingLaunch = useMemo(
    () => requests.find((r) => r.businessId === businessId && r.type === 'business_launch' && r.status === 'pending'),
    [requests, businessId],
  );

  const flip = async (status: BusinessStatus) => {
    if (!familyId) return;
    setError(''); setBusy(true);
    try { await setBusinessStatus(familyId, businessId, status); }
    catch (e: any) { setError(e?.message || 'Could not update.'); }
    finally { setBusy(false); setConfirmClose(false); }
  };

  const askLaunch = async () => {
    if (!familyId || !business || !profile?.uid) return;
    setError(''); setBusy(true);
    try { await requestBusinessLaunch(familyId, business, profile.uid); }
    catch (e: any) { setError(e?.message || 'Could not send the request.'); }
    finally { setBusy(false); }
  };

  if (loading) {
    return <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center text-hive-muted text-sm">Loading…</div>;
  }
  if (!business) {
    return (
      <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center">
        <div className="text-5xl mb-3">🔍</div>
        <p className="font-nunito font-extrabold">Business not found</p>
        <button onClick={() => router.push('/business')} className="mt-4 text-hive-honey-dk font-nunito font-extrabold text-[13px] hover:underline">
          ← Back to portfolio
        </button>
      </div>
    );
  }

  const t = typeMeta(business.type);
  const s = STATUS_META[business.status];
  const stats = business.stats;
  const split = business.hiveSplit;
  const statCard = 'bg-hive-paper border border-hive-line rounded-hive p-3.5';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      {/* Identity */}
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[24px] leading-none">{business.emoji || t.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px] truncate">{business.name}</div>
          <div className="text-[11px] text-hive-honey-soft/80">
            {t.label} · since {fmtDate(business.startedAt) || fmtDate(business.createdAt)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-hive-pill ${s.pill}`}>{s.label}</span>
          {canAct && (
            <Link href={`/business/${businessId}/settings`} aria-label="Business settings" className="text-hive-honey-soft text-[15px] leading-none hover:text-hive-honey">⚙️</Link>
          )}
        </div>
      </div>

      {business.mission && (
        <p className="text-[13px] text-hive-navy/80 italic mb-3 px-1">“{business.mission}”</p>
      )}

      {/* Pending launch banner */}
      {pendingLaunch && (
        <div className="bg-[#FCEAD6] border border-[#B25E16]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#7a4410] font-nunito font-bold">
          ⏳ Launch request sent — waiting for a parent to approve.
        </div>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className={statCard}>
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Worth</div>
          <div className="font-nunito font-black text-[22px] mt-0.5">{formatCash(stats.worthCents, config.currency)}</div>
        </div>
        <div className={statCard}>
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">This month profit</div>
          <div className="font-nunito font-black text-[22px] mt-0.5">{formatCash(stats.monthProfitCents, config.currency)}</div>
          {stats.monthRevenueCents > 0 && (
            <div className="text-[11px] text-hive-muted mt-0.5">
              Margin {Math.round((stats.monthProfitCents / stats.monthRevenueCents) * 100)}%
            </div>
          )}
        </div>
        <div className={statCard}>
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Month revenue</div>
          <div className="font-nunito font-black text-[18px] mt-0.5">{formatCash(stats.monthRevenueCents, config.currency)}</div>
        </div>
        <div className={statCard}>
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Sales · lifetime profit</div>
          <div className="font-nunito font-black text-[18px] mt-0.5">{stats.salesCount} · {formatCash(stats.lifetimeProfitCents, config.currency)}</div>
        </div>
      </div>

      {/* Pricing + customers + split */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3 space-y-2">
        {typeof business.unitPriceCents === 'number' && (
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-hive-muted">Price</span>
            <span className="font-nunito font-extrabold">{formatCash(business.unitPriceCents, config.currency)}{business.unitLabel ? ` / ${business.unitLabel}` : ''}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-hive-muted shrink-0">Customers</span>
          <span className="font-nunito font-extrabold capitalize text-right">{business.customerChannels.join(' · ')}</span>
        </div>
        <div>
          <div className="text-[11px] text-hive-muted mb-1.5">Profit split → Hive</div>
          <div className="flex flex-wrap gap-1 text-[11px] font-nunito font-bold">
            {(['spend', 'save', 'goal', 'invest'] as Array<keyof HiveSplit>).map((k) => (
              <span key={k} className="px-2 py-0.5 rounded-hive-pill bg-hive-cream text-hive-navy capitalize">{k} {split[k]}%</span>
            ))}
          </div>
        </div>
      </div>

      {/* Lifecycle controls */}
      {canAct && (
        <div className="mb-3">
          {/* Kid: ask a parent to take a pilot live. */}
          {isOwner && (business.status === 'pilot' || business.status === 'idea') && (
            <button onClick={askLaunch} disabled={busy || !!pendingLaunch}
              className="w-full h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
              {pendingLaunch ? 'Launch request pending…' : '🚀 Request launch (parent OK)'}
            </button>
          )}

          {/* Parent: direct lifecycle. */}
          {isParent && (
            <div className="flex flex-wrap gap-2">
              {(business.status === 'pilot' || business.status === 'idea' || business.status === 'paused') && (
                <button onClick={() => flip('active')} disabled={busy}
                  className="flex-1 h-11 rounded-hive bg-[#2F7D32] text-white font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
                  ✓ Set active
                </button>
              )}
              {business.status === 'active' && (
                <button onClick={() => flip('paused')} disabled={busy}
                  className="flex-1 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-black text-[13px] disabled:opacity-40 hover:bg-hive-cream transition">
                  ⏸ Pause
                </button>
              )}
              {business.status !== 'closed' && (
                confirmClose ? (
                  <button onClick={() => flip('closed')} disabled={busy}
                    className="flex-1 h-11 rounded-hive bg-hive-rose text-white font-nunito font-black text-[13px] disabled:opacity-40 transition">
                    Tap to confirm close
                  </button>
                ) : (
                  <button onClick={() => setConfirmClose(true)} disabled={busy}
                    className="h-11 px-4 rounded-hive bg-hive-paper border border-hive-line text-hive-muted font-nunito font-extrabold text-[12px] hover:bg-hive-cream transition">
                    Close
                  </button>
                )
              )}
            </div>
          )}

          {/* Kid: reversible pause/resume of their own pilot/active business. */}
          {isOwner && business.status === 'active' && (
            <button onClick={() => flip('paused')} disabled={busy}
              className="w-full mt-2 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] disabled:opacity-40 hover:bg-hive-cream transition">
              ⏸ Pause for now
            </button>
          )}
          {isOwner && business.status === 'paused' && (
            <button onClick={() => flip('active')} disabled={busy}
              className="w-full mt-2 h-11 rounded-hive bg-[#2F7D32] text-white font-nunito font-black text-[13px] disabled:opacity-40 transition">
              ▶ Resume
            </button>
          )}
        </div>
      )}

      {error && <p className="text-hive-rose text-[12px] font-bold mb-3">{error}</p>}

      {/* Daily stock-take — the everyday habit (counts + a photo). */}
      {canAct && business.status !== 'closed' && (
        <Link href={`/business/${businessId}/stocktake`}
          className="w-full flex items-center justify-center gap-2 h-12 mb-3 rounded-hive bg-hive-honey text-hive-navy font-nunito font-black text-[14px] hover:brightness-105 active:scale-[0.99] transition no-underline">
          📋 Daily stock-take
        </Link>
      )}

      {/* Log sale / cost — 1-tap entry. A paid sale sweeps to the kid's Hive. */}
      {canAct && business.status !== 'closed' && (
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <Link href={`/business/${businessId}/sale`}
            className="h-12 flex items-center justify-center gap-1.5 rounded-hive bg-[#2F7D32] text-white font-nunito font-black text-[14px] hover:brightness-110 active:scale-[0.99] transition no-underline">
            💵 Log sale
          </Link>
          <Link href={`/business/${businessId}/cost`}
            className="h-12 flex items-center justify-center gap-1.5 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-black text-[14px] hover:bg-hive-cream active:scale-[0.99] transition no-underline">
            🧾 Log cost
          </Link>
        </div>
      )}

      {/* Inventory — the books that drive worth. */}
      <Link
        href={`/business/${businessId}/inventory`}
        className="w-full flex items-center justify-between gap-2 h-12 px-4 mb-3 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] hover:brightness-110 active:scale-[0.99] transition no-underline"
      >
        <span>📦 Inventory &amp; worth</span>
        <span className="text-hive-honey-soft">{formatCash(stats.worthCents, config.currency)} →</span>
      </Link>

      {/* Milestones unlocked for this business */}
      {milestones.filter((m) => m.businessId === businessId).length > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-2">Milestones</div>
          <div className="flex flex-wrap gap-2">
            {milestones.filter((m) => m.businessId === businessId).map((m) => {
              const meta = MILESTONE_META[m.key];
              return (
                <span key={m.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-hive-pill bg-[#FFF6DE] border border-hive-honey/50 text-[11.5px] font-nunito font-extrabold">
                  <span>{meta?.emoji ?? '🏅'}</span>{meta?.label ?? m.key}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent activity (the books) */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-nunito font-extrabold text-[14px]">Recent activity</h3>
          <span className="text-[11px] text-hive-muted">{stats.salesCount} {stats.salesCount === 1 ? 'sale' : 'sales'}</span>
        </div>
        {ledger.length === 0 ? (
          <p className="text-[12px] text-hive-muted py-3 text-center">No sales or costs yet. Log your first one above.</p>
        ) : (
          ledger.slice(0, 6).map((e) => {
            const ms = (e.occurredAt as any)?.toMillis?.();
            const date = typeof ms === 'number' ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
            const isSale = e.kind === 'sale';
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 py-2 border-b border-dashed border-hive-line last:border-0">
                <div className="min-w-0">
                  <div className="text-[13px] truncate">{isSale ? '💵' : '🧾'} {e.description}{e.paymentStatus === 'unpaid' ? ' · IOU' : ''}</div>
                  <div className="text-[11px] text-hive-muted">{date}</div>
                </div>
                <span className={`font-nunito font-extrabold text-[13px] shrink-0 ${isSale ? 'text-[#2F7D32]' : 'text-hive-rose'}`}>
                  {isSale ? '+' : '−'}{formatCash(e.amountCents, config.currency)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* AI coach (pricing/cost tip from real numbers) + weekly review. */}
      <div className="space-y-2.5 mb-3">
        <AICoachCard
          loop="pricing"
          coachName={coachName}
          currency={config.currency}
          cta={`Ask ${coachName} about your price`}
          facts={{
            business: business.name,
            type: t.label,
            ...(typeof business.unitPriceCents === 'number'
              ? { price: `${formatCash(business.unitPriceCents, config.currency)}${business.unitLabel ? ' / ' + business.unitLabel : ''}` }
              : {}),
            salesThisMonth: stats.salesCount,
            monthRevenue: formatCash(stats.monthRevenueCents, config.currency),
            monthProfit: formatCash(stats.monthProfitCents, config.currency),
            ...(stats.monthRevenueCents > 0
              ? { margin: `${Math.round((stats.monthProfitCents / stats.monthRevenueCents) * 100)}%` }
              : {}),
          }}
        />
        <Link href={`/business/${businessId}/weekly`}
          className="w-full flex items-center justify-center gap-2 h-11 rounded-hive bg-hive-paper border border-hive-line text-hive-navy font-nunito font-extrabold text-[13px] hover:bg-hive-cream active:scale-[0.99] transition no-underline">
          🗓️ Weekly review →
        </Link>
      </div>

      {/* Coming next — what's still ahead. */}
      <div className="bg-[#F4ECD8] border border-hive-line rounded-hive p-4">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Coming next</div>
        <p className="text-[13px] text-hive-navy/80 leading-relaxed">
          📈 Junior Investor — landing in the next update.
        </p>
      </div>
    </div>
  );
}
