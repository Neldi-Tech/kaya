'use client';

// Kaya Business · Business dashboard (kid screen 3). Identity, status, the
// headline numbers, lifecycle controls, and the entry point to Inventory.
// Sales/costs entry + Hive sweep (PR4) and the AI coach (PR5) slot into the
// marked spots below — kept as honest "coming next" affordances for now so
// nothing here is a dead button.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, HiveSplit, BusinessStatus,
  subscribeToBusiness, subscribeToBusinessRequests,
  setBusinessStatus, requestBusinessLaunch,
} from '@/lib/business';
import { ApprovalRequest } from '@/lib/hive';
import { formatCash } from '@/components/hive/format';
import { typeMeta, STATUS_META } from '@/components/business/meta';

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
  const { config } = useHive();

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const familyId = profile?.familyId;
  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, (b) => { setBusiness(b); setLoading(false); });
    const u2 = subscribeToBusinessRequests(familyId, setRequests);
    return () => { u1(); u2(); };
  }, [familyId, businessId]);

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
        <span className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-hive-pill ${s.pill}`}>{s.label}</span>
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

      {/* Inventory — the books that drive worth. */}
      <Link
        href={`/business/${businessId}/inventory`}
        className="w-full flex items-center justify-between gap-2 h-12 px-4 mb-3 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] hover:brightness-110 active:scale-[0.99] transition no-underline"
      >
        <span>📦 Inventory &amp; worth</span>
        <span className="text-hive-honey-soft">{formatCash(stats.worthCents, config.currency)} →</span>
      </Link>

      {/* Coming next — honest placeholders for the books, not dead buttons. */}
      <div className="bg-[#F4ECD8] border border-hive-line rounded-hive p-4">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Coming next</div>
        <p className="text-[13px] text-hive-navy/80 leading-relaxed">
          💵 log sales · 🧾 log costs · 🐝 profit auto-flows to your Hive ·
          🏆 milestones · 📈 Junior Investor — landing in the next updates.
        </p>
      </div>
    </div>
  );
}
