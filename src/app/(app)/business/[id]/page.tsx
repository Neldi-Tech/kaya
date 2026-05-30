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
  Business, HiveSplit, BusinessStatus, LedgerEntry, BusinessMilestone, BUSINESS_MILESTONES, StockTake,
  StockMovement, StockMovementKind,
  subscribeToBusiness, subscribeToBusinessRequests, subscribeToLedger, subscribeToBusinessMilestones, subscribeToStockTakes,
  subscribeToStockMovements,
  setBusinessStatus, requestBusinessLaunch, updateBusiness, readBusinessConfig,
} from '@/lib/business';
import { uploadBusinessPhotoFromDataUrl } from '@/lib/businessPhoto';
import { ApprovalRequest } from '@/lib/hive';
import { formatCash } from '@/components/hive/format';
import { formatWorth } from '@/components/business/money';
import { typeMeta, STATUS_META } from '@/components/business/meta';
import DailySalesCard from '@/components/business/DailySalesCard';
import AICoachCard from '@/components/business/AICoachCard';
import AIImageButton from '@/components/business/AIImageButton';
import StockTakeHistory from '@/components/business/StockTakeHistory';

const MILESTONE_META = Object.fromEntries(BUSINESS_MILESTONES.map((m) => [m.key, m]));

// Verb per stock-movement kind for the home-page peek. Stays in sync
// with the same labels on /business/{id}/inventory's full change log.
const MOVE_VERB: Record<StockMovementKind, string> = {
  add:      'added',
  sale:     'sold',
  spoilage: 'spoiled',
  adjust:   'adjusted',
  writeoff: 'written off',
  remove:   'removed',
};

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
  const bizConfig = readBusinessConfig(family);
  const coachName = bizConfig.coachName;

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [moves, setMoves] = useState<StockMovement[]>([]);
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
    const u4 = subscribeToStockTakes(familyId, businessId, setTakes, 30);
    const u5 = subscribeToStockMovements(familyId, businessId, setMoves, 8);
    return () => { u1(); u2(); u3(); u4(); u5(); };
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

  const acceptLogo = async (dataUrl: string) => {
    if (!familyId) return;
    const url = await uploadBusinessPhotoFromDataUrl(familyId, businessId, dataUrl);
    if (url) await updateBusiness(familyId, businessId, { logoUrl: url });
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
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt="" className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
        ) : (
          <div className="text-[24px] leading-none">{business.emoji || t.emoji}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px] truncate">{business.name}</div>
          <div className="text-[11px] text-hive-honey-soft/80">
            {t.label} · since {fmtDate(business.startedAt) || fmtDate(business.createdAt)}
            {business.createdByName ? ` · ${business.createdByRole === 'parent' ? 'set up by' : 'started by'} ${business.createdByName}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-hive-pill ${s.pill}`}>{s.label}</span>
          {canAct && (
            <Link href={`/business/${businessId}/settings`} aria-label="Business settings"
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[15px] leading-none text-hive-honey-soft hover:text-hive-honey hover:bg-white/15 transition">⚙️</Link>
          )}
        </div>
      </div>

      {business.mission && (
        <p className="text-[13px] text-hive-navy/80 italic mb-3 px-1">“{business.mission}”</p>
      )}

      {/* AI logo — give the business a friendly face (off until OPENAI_API_KEY set). */}
      {canAct && (
        <div className="mb-3">
          <AIImageButton
            kind="logo"
            subject={business.name}
            detail={`${t.label}${business.unitLabel ? ', sells ' + business.unitLabel : ''}`}
            cta={business.logoUrl ? '✨ New AI logo' : '✨ Generate a logo (AI)'}
            onAccept={acceptLogo}
          />
        </div>
      )}

      {/* Pending launch banner */}
      {pendingLaunch && (
        <div className="bg-[#FCEAD6] border border-[#B25E16]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#7a4410] font-nunito font-bold">
          ⏳ Launch request sent — waiting for a parent to approve.
        </div>
      )}

      {/* Daily auto-sale drafts (products flagged "sold daily") */}
      {isOwner && familyId && profile?.uid && business.status !== 'closed' && (
        <DailySalesCard familyId={familyId} business={business} requests={requests} currency={config.currency} uid={profile.uid} />
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className={statCard}>
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Worth</div>
          <div className="font-nunito font-black text-[22px] mt-0.5">{formatWorth(stats.worthCents, config.currency, bizConfig.displayRounding)}</div>
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
        <span className="text-hive-honey-soft">{formatWorth(stats.worthCents, config.currency, bizConfig.displayRounding)} →</span>
      </Link>

      {/* Recent stock changes peek — surfaces "what moved" right under
          the Inventory tile so the parent doesn't have to drill into
          the inventory detail to see activity. Full log lives there. */}
      {moves.length > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-3 mb-3">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-nunito font-extrabold text-[13px]">📊 Recent stock changes</h3>
            <Link
              href={`/business/${businessId}/inventory`}
              className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline"
            >
              See all →
            </Link>
          </div>
          {moves.slice(0, 3).map((m) => {
            const sign = m.qtyDelta > 0 ? '+' : m.qtyDelta < 0 ? '−' : '';
            const tone = m.qtyDelta > 0
              ? 'text-[#1F8A4C]'
              : m.qtyDelta < 0 ? 'text-[#C0392B]' : 'text-hive-muted';
            const ms = (m.occurredAt as any)?.toMillis?.();
            const when = typeof ms === 'number'
              ? new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
              : '';
            const verb = MOVE_VERB[m.kind] || 'changed';
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 py-1.5 border-b border-dashed border-hive-line last:border-0"
              >
                <div className="text-[12px] text-hive-navy truncate min-w-0">
                  <span className={`font-extrabold ${tone}`}>
                    {sign}{Math.abs(m.qtyDelta)}
                  </span>
                  {m.unitLabel ? ` ${m.unitLabel}` : ''} {verb}
                  {' · '}
                  <span className="font-bold">{m.itemName}</span>
                </div>
                <div className="text-[10px] text-hive-muted font-bold shrink-0">{when}</div>
              </div>
            );
          })}
        </div>
      )}

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
          <Link href={`/business/${businessId}/history`} className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
            History →
          </Link>
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
        {ledger.length > 6 && (
          <Link href={`/business/${businessId}/history`} className="mt-2 block text-center text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
            See full history →
          </Link>
        )}
      </div>

      {/* Today's snapshot — what changed on the business today (or
          yesterday when today is empty). Pulls from the same data
          streams already loaded above (ledger / moves / takes), so
          no extra wiring. */}
      {(() => {
        const tzOffsetMs = new Date().getTimezoneOffset() * 60_000;
        const dayKey = (ms: number) => new Date(ms - tzOffsetMs).toISOString().slice(0, 10);
        const todayKey = dayKey(Date.now());
        const yesterdayKey = dayKey(Date.now() - 86_400_000);

        const statsFor = (key: string) => {
          const inDay = (ts: any) => {
            const ms = ts?.toMillis?.();
            return typeof ms === 'number' && dayKey(ms) === key;
          };
          const salesDay = ledger.filter((e) => e.kind === 'sale' && inDay(e.occurredAt));
          const costsDay = ledger.filter((e) => e.kind === 'cost' && inDay(e.occurredAt));
          const movesDay = moves.filter((m) => inDay(m.occurredAt));
          const takeDay = takes.find((t) => t.date === key);
          const empty = salesDay.length === 0 && costsDay.length === 0 && movesDay.length === 0 && !takeDay;
          return {
            empty,
            salesCount: salesDay.length,
            salesTotal: salesDay.reduce((s, e) => s + e.amountCents, 0),
            costsCount: costsDay.length,
            costsTotal: costsDay.reduce((s, e) => s + e.amountCents, 0),
            movesCount: movesDay.length,
            take: takeDay,
          };
        };

        const today = statsFor(todayKey);
        const useYesterday = today.empty;
        const snap = useYesterday ? statsFor(yesterdayKey) : today;
        const label = useYesterday ? 'Yesterday' : 'Today';
        const dateLabel = new Date(useYesterday ? Date.now() - 86_400_000 : Date.now())
          .toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

        return (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-nunito font-extrabold text-[14px]">📅 {label}'s snapshot</h3>
              <span className="text-[11px] text-hive-muted">{dateLabel}</span>
            </div>
            {snap.empty ? (
              <p className="text-[12px] text-hive-muted py-1">
                Nothing logged {useYesterday ? 'yesterday or today' : 'today yet'}. Log a sale, cost, or stock-take above to get started.
              </p>
            ) : (
              <ul className="space-y-1.5 text-[12.5px]">
                <li className="flex items-center justify-between gap-2">
                  <span>📋 Stock-take</span>
                  <span className="font-nunito font-extrabold">
                    {snap.take
                      ? <>✓ done · {snap.take.itemsTouched} item{snap.take.itemsTouched === 1 ? '' : 's'} touched</>
                      : <span className="text-hive-muted">○ not done</span>}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>💵 Sales</span>
                  <span className="font-nunito font-extrabold text-[#2F7D32]">
                    {snap.salesCount} · {formatCash(snap.salesTotal, config.currency)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>🧾 Costs</span>
                  <span className="font-nunito font-extrabold text-hive-rose">
                    {snap.costsCount} · {formatCash(snap.costsTotal, config.currency)}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>📊 Stock changes</span>
                  <span className="font-nunito font-extrabold">
                    {snap.movesCount}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 pt-1 border-t border-dashed border-hive-line">
                  <span className="text-hive-muted">Net</span>
                  <span className={`font-nunito font-black ${
                    snap.salesTotal - snap.costsTotal > 0 ? 'text-[#2F7D32]'
                    : snap.salesTotal - snap.costsTotal < 0 ? 'text-hive-rose'
                    : 'text-hive-muted'
                  }`}>
                    {snap.salesTotal - snap.costsTotal > 0 ? '+' : snap.salesTotal - snap.costsTotal < 0 ? '−' : ''}
                    {formatCash(Math.abs(snap.salesTotal - snap.costsTotal), config.currency)}
                  </span>
                </li>
              </ul>
            )}
          </div>
        );
      })()}

      {/* Stock-take history — the daily habit log, same records + detail view as
          the stock-take page (counts + photos/clips + notes). */}
      <StockTakeHistory takes={takes} className="mb-3" />

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
