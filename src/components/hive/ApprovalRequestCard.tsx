'use client';

// Single pending-approval card for the parent inbox. Shows kid name, type
// (with appropriate emoji), the amount, the description, and Approve /
// Reject buttons. Reject opens an inline reason input. The actual write
// goes through resolveApprovalRequest in src/lib/hive.ts.

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { resolveApprovalRequest, ApprovalRequest } from '@/lib/hive';
import { formatCash, formatHoney, formatHp } from './format';

const TYPE_META: Record<ApprovalRequest['type'], { emoji: string; label: string; tone: 'honey' | 'green' | 'rose' }> = {
  hp_to_honey:   { emoji: '⇆', label: 'Save HP → 🍯',      tone: 'honey' },
  cash_out:      { emoji: '🍯', label: 'Cash out 🍯 → $',  tone: 'green' },
  spend:         { emoji: '🛒', label: 'Cash spend',        tone: 'rose'  },
  business_sale: { emoji: '💼', label: 'Business sale',     tone: 'green' },
  business_cost: { emoji: '🧾', label: 'Business cost',     tone: 'rose'  },
};

export default function ApprovalRequestCard({ req }: { req: ApprovalRequest }) {
  const { profile } = useAuth();
  const { children } = useFamily();
  const kid = children.find((c) => c.id === req.kidId);
  const meta = TYPE_META[req.type];
  const [resolving, setResolving] = useState<'approve' | 'reject' | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const amountLine = (() => {
    if (req.type === 'hp_to_honey') {
      return `${formatHp(req.hpAmount || 0)} HP → ${formatHoney(req.honeyAmount || 0)} 🍯`;
    }
    if (req.type === 'cash_out') {
      return `${formatHoney(req.honeyAmount || 0)} 🍯 → ${formatCash(req.amountCents || 0)}`;
    }
    return formatCash(req.amountCents || 0);
  })();

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
      await resolveApprovalRequest(profile.familyId, req.id, decision, profile.uid, decision === 'rejected' ? reason : undefined);
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
