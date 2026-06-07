'use client';

// Single pending-approval card for the parent inbox. Shows kid name, type
// (with appropriate emoji), the amount, the description, and Approve /
// Reject buttons. Reject opens an inline reason input. The actual write
// goes through resolveApprovalRequest in src/lib/hive.ts.

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { resolveApprovalRequest, ApprovalRequest } from '@/lib/hive';
import { getStockTake, resolveBusinessRequest, type StockTake } from '@/lib/business';
import { downloadImage, suggestedPhotoFilename } from '@/lib/downloadImage';
import { formatCash, formatHoney, formatHp } from './format';

// Hive-native request types only. Business reuses the same queue (decision
// §3.2) but renders its own filtered view in the Business console — so an
// unknown (business) type here falls back to a neutral label rather than
// being mislabelled by this Hive card.
const TYPE_META: Partial<Record<ApprovalRequest['type'], { emoji: string; label: string; tone: 'honey' | 'green' | 'rose' }>> = {
  hp_to_honey:       { emoji: '⇆', label: 'Save HP → 🪙',         tone: 'honey' },
  cash_out:          { emoji: '🪙', label: 'Cash out 🪙 → $',      tone: 'green' },
  treasury_to_cash:  { emoji: '🍯', label: 'Honey Pot → Cash',    tone: 'green' },
  spend:             { emoji: '🛒', label: 'Cash spend',          tone: 'rose'  },
  business_hp:       { emoji: '🌳', label: 'House Points · stock-take', tone: 'honey' },
  business_reinvest: { emoji: '🌳', label: 'Reinvest · Honey Pot → business', tone: 'green' },
  create_group_chat: { emoji: '💬', label: 'New group chat',      tone: 'honey' },
};

export default function ApprovalRequestCard({ req }: { req: ApprovalRequest }) {
  const { profile } = useAuth();
  const { children } = useFamily();
  const kid = children.find((c) => c.id === req.kidId);
  const meta = TYPE_META[req.type] ?? { emoji: '•', label: 'Request', tone: 'honey' as const };
  const [resolving, setResolving] = useState<'approve' | 'reject' | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // Stock-take "view details" (business_hp) — lazy-load the day's take.
  const [showDetails, setShowDetails] = useState(false);
  const [take, setTake] = useState<StockTake | null>(null);
  const [takeState, setTakeState] = useState<'idle' | 'loading' | 'loaded'>('idle');
  const toggleDetails = async () => {
    const next = !showDetails;
    setShowDetails(next);
    if (next && takeState === 'idle' && profile?.familyId && req.businessId && req.awardDate) {
      setTakeState('loading');
      try { setTake(await getStockTake(profile.familyId, req.businessId, req.awardDate)); }
      catch { /* best-effort */ }
      finally { setTakeState('loaded'); }
    }
  };

  const amountLine = (() => {
    if (req.type === 'hp_to_honey') {
      return `${formatHp(req.hpAmount || 0)} HP → ${formatHoney(req.honeyAmount || 0)} 🍯`;
    }
    if (req.type === 'cash_out') {
      return `${formatHoney(req.honeyAmount || 0)} 🪙 → ${formatCash(req.amountCents || 0)}`;
    }
    if (req.type === 'treasury_to_cash') {
      return `${formatCash(req.amountCents || 0)} → Cash`;
    }
    if (req.type === 'business_hp') {
      return `+${formatHp(req.points || 0)} HP`;
    }
    if (req.type === 'create_group_chat') {
      const n = req.proposedMemberUids?.length ?? 0;
      return `"${req.proposedTitle || 'New group'}" · ${n} ${n === 1 ? 'member' : 'members'}`;
    }
    return formatCash(req.amountCents || 0);
  })();

  // Dual-parent gate (Honey Pot → Cash can require both parents).
  const needTwo = (req.requiredApprovals ?? 1) >= 2;
  const haveOne = needTwo && (req.approvals?.length ?? 0) >= 1;

  const dateLine = (() => {
    const ts = (req.createdAt as any)?.toMillis?.();
    if (typeof ts !== 'number') return '';
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  })();

  const act = async (decision: 'approved' | 'rejected') => {
    if (!profile?.familyId) return;
    setError('');
    setResolving(decision === 'approved' ? 'approve' : 'reject');
    try {
      // Business-module requests (stock-take HP, daily sale, launch, etc.) live
      // in the same queue but resolve through the Business pipeline — calling
      // the Hive resolver for them throws "Unknown approval type".
      const note = decision === 'rejected' ? reason : undefined;
      if (req.module === 'business') {
        await resolveBusinessRequest(profile.familyId, req.id, decision, profile.uid, note);
      } else if (req.type === 'create_group_chat') {
        // Resolve server-side (Admin SDK): the parent creating the kids' thread
        // is blocked by the client `threads` create rule, so this can't run in
        // the browser. The route authorises the parent + bypasses rules.
        const res = await fetch('/api/hive/group-chat/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ familyId: profile.familyId, requestId: req.id, decision, approverUid: profile.uid, note }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.error ? `Couldn’t resolve (${d.error}).` : 'Failed to resolve.');
        }
      } else {
        await resolveApprovalRequest(profile.familyId, req.id, decision, profile.uid, note);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to resolve.');
      setResolving(null);
    }
  };

  const toneCard = meta.tone === 'green' ? 'border-hive-green/50' : meta.tone === 'rose' ? 'border-hive-rose/50' : 'border-hive-honey/50';

  return (
    <div className={`bg-hive-paper border-2 ${toneCard} rounded-hive-lg p-4`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-[12px] bg-hive-honey-soft text-hive-honey-dk flex items-center justify-center text-xl shrink-0">
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-nunito font-extrabold text-[13px]">{meta.label}</p>
            <span className="text-[11px] text-hive-muted">{dateLine}</span>
          </div>
          <p className="font-nunito font-black text-lg leading-tight mt-0.5">{amountLine}</p>
          <p className="text-[12px] text-hive-muted mt-1 leading-snug">{req.description}</p>
          <p className="text-[11px] text-hive-muted mt-1">
            For <strong className="text-hive-navy">{kid?.name || 'unknown kid'}</strong>
          </p>
          {req.type === 'create_group_chat' && req.proposedMembers && req.proposedMembers.length > 0 && (
            <div className="mt-2 rounded-hive border border-hive-line bg-hive-cream p-2.5">
              <p className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Members</p>
              <div className="flex flex-wrap gap-1.5">
                {req.proposedMembers.map((m) => (
                  <span key={m.uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-hive-pill bg-hive-paper border border-hive-line text-[11.5px] font-nunito font-bold">
                    <span>{m.avatar && (m.avatar.startsWith('http') || m.avatar.startsWith('data:')) ? '👤' : (m.avatar || '👤')}</span>
                    <span>{m.name}</span>
                    <span className="text-hive-muted text-[10px] capitalize">· {m.role}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {req.type === 'business_hp' && req.businessId && (
            <div className="mt-2">
              <button type="button" onClick={toggleDetails} className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                {showDetails ? 'Hide details ▴' : '🔎 View stock-take details ▾'}
              </button>
              {showDetails && (
                <div className="mt-2 rounded-hive border border-hive-line bg-hive-cream p-2.5">
                  {takeState === 'loading' ? (
                    <p className="text-[12px] text-hive-muted">Loading…</p>
                  ) : take ? (
                    <>
                      <p className="text-[12px] text-hive-ink font-bold">
                        📦 {take.itemsTouched} item{take.itemsTouched === 1 ? '' : 's'} updated
                        {take.note ? ` · “${take.note}”` : ''}
                      </p>
                      {take.counts && take.counts.length > 0 && (
                        <ul className="mt-1.5 divide-y divide-hive-line/60 rounded-hive border border-hive-line bg-hive-paper">
                          {take.counts.map((c) => (
                            <li key={c.itemId} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                              <span className="text-[12px] text-hive-ink truncate">{c.name}</span>
                              <span className="text-[12px] font-nunito font-extrabold text-hive-navy shrink-0">
                                {c.qty}{c.unitLabel ? ` ${c.unitLabel}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {(() => {
                        const media = take.media && take.media.length
                          ? take.media
                          : (take.photoUrl ? [{ url: take.photoUrl, kind: 'photo' as const }] : []);
                        return media.length > 0 ? (
                          <div className={`mt-2 grid gap-2 ${media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                            {media.map((m, i) => (m.kind === 'video' ? (
                              <video key={i} src={m.url} controls playsInline className="w-full aspect-square rounded-hive object-cover border border-hive-line bg-black" />
                            ) : (
                              <button
                                key={i}
                                type="button"
                                onClick={() => downloadImage(m.url, suggestedPhotoFilename()).catch((err) => console.error('Photo download failed', err))}
                                aria-label="Download photo"
                                className="block p-0 border-0 bg-transparent cursor-pointer"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.url} alt="" loading="lazy" className="w-full aspect-square rounded-hive object-cover border border-hive-line" />
                              </button>
                            )))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-hive-muted italic mt-1">No photos on this stock-take.</p>
                        );
                      })()}
                      <Link href={`/business/${req.businessId}`} className="inline-block mt-2 text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                        Open business →
                      </Link>
                    </>
                  ) : (
                    <p className="text-[12px] text-hive-muted">Couldn’t load the stock-take.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {needTwo && (
            <p className="text-[11px] font-nunito font-bold text-hive-honey-dk mt-1">
              {haveOne ? '🔓 One parent approved — needs the other parent' : '🔒 Both parents must approve'}
            </p>
          )}
        </div>
      </div>

      {!showReject ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => act('approved')}
            disabled={!!resolving}
            className="flex-1 h-10 rounded-hive-pill bg-hive-green text-white font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition"
          >
            {resolving === 'approve' ? 'Approving…' : '✓ Approve'}
          </button>
          <button
            onClick={() => setShowReject(true)}
            disabled={!!resolving}
            className="h-10 px-4 rounded-hive-pill bg-[#FCEAEA] text-hive-rose font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-95 transition"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, kid sees this)"
            maxLength={120}
            className="w-full h-10 px-3 bg-hive-cream rounded-hive-pill text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-rose/40"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => act('rejected')}
              disabled={!!resolving}
              className="flex-1 h-10 rounded-hive-pill bg-hive-rose text-white font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition"
            >
              {resolving === 'reject' ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              onClick={() => { setShowReject(false); setReason(''); }}
              disabled={!!resolving}
              className="h-10 px-4 rounded-hive-pill bg-hive-cream text-hive-muted font-nunito font-extrabold text-[12px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}
    </div>
  );
}
