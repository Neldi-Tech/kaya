'use client';

// /admin/upgrade-requests — operator-only.
//
// Two stacked sections:
//   1. Pending requests   — newest first. "Generate code →" opens the
//      modal pre-filled with the requested tier + addons.
//   2. Generated codes    — history with Fresh / Redeemed / Expired /
//      Revoked chips. Revoke action on fresh codes.
//
// The "Generate code" modal sends the code AUTOMATICALLY via Resend.
// The admin never sees the raw code. Confirmation toast shows whether
// the email landed.

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import {
  DEFAULT_ADDONS, DEFAULT_TIERS, type SubscriptionTierId,
} from '@/lib/tiers';
import {
  EXPIRY_OPTIONS, expiryCopy, statusChip,
  type ExpiryPreset, type TierCodeRow, type UpgradeRequestRow,
} from '@/lib/tierCodes';

export default function AdminUpgradeRequestsPage() {
  const [requests, setRequests] = useState<UpgradeRequestRow[]>([]);
  const [codes, setCodes] = useState<TierCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [generating, setGenerating] = useState<UpgradeRequestRow | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const headers = { authorization: `Bearer ${token}` };
      const [reqRes, codeRes] = await Promise.all([
        fetch('/api/admin/upgrade-requests', { headers }),
        fetch('/api/admin/tier-codes',       { headers }),
      ]);
      if (!reqRes.ok)  throw new Error(`requests-${reqRes.status}`);
      if (!codeRes.ok) throw new Error(`codes-${codeRes.status}`);
      const { requests: rs } = (await reqRes.json()) as { requests: UpgradeRequestRow[] };
      const { codes: cs }    = (await codeRes.json()) as { codes: TierCodeRow[] };
      setRequests(rs); setCodes(cs);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Auto-dismiss toast after 4 s.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const pending = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const handled = useMemo(() => requests.filter((r) => r.status !== 'pending').slice(0, 10), [requests]);

  const dismiss = async (id: string) => {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch(`/api/admin/upgrade-requests/${id}/dismiss`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`dismiss-${res.status}`);
      await reload();
    } catch (e) {
      setToast({ kind: 'err', msg: `Dismiss failed: ${String(e instanceof Error ? e.message : e)}` });
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this code? Family can\'t redeem it after this.')) return;
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch(`/api/admin/tier-codes/${id}/revoke`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`revoke-${res.status}`);
      await reload();
      setToast({ kind: 'ok', msg: 'Code revoked.' });
    } catch (e) {
      setToast({ kind: 'err', msg: `Revoke failed: ${String(e instanceof Error ? e.message : e)}` });
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[1100px] mx-auto px-5 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl grid place-items-center"
                 style={{ background: 'rgba(212,168,71,0.18)', border: '1px solid rgba(212,168,71,0.3)' }}>
              <span className="text-base">🎟</span>
            </div>
            <h1 className="font-display font-black text-2xl text-white tracking-tight m-0">Upgrade requests &amp; codes</h1>
          </div>
          <p className="text-white/55 text-[13px] font-semibold ml-12">
            Pending requests from families · generate per-family codes · they ship to the family by email automatically.
          </p>
        </header>

        {err && (
          <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/30 rounded-2xl px-4 py-3 text-[#FF7676] text-[13px] font-bold mb-4">{err}</div>
        )}
        {loading && <div className="text-white/55 text-sm py-12 text-center">Loading…</div>}

        {!loading && !err && (
          <>
            {/* Pending */}
            <section className="mb-9">
              <h2 className="text-[12px] font-black text-white/55 uppercase tracking-wider mb-3">
                Pending · {pending.length}
              </h2>
              {pending.length === 0 ? (
                <div className="text-white/45 text-sm py-8 text-center bg-white/5 rounded-2xl border border-white/8">
                  No pending requests. Quiet day. 🌻
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {pending.map((rq) => (
                    <RequestRow key={rq.id} rq={rq}
                      onGenerate={() => setGenerating(rq)}
                      onDismiss={() => dismiss(rq.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Handled (recently) */}
            {handled.length > 0 && (
              <section className="mb-9">
                <h2 className="text-[12px] font-black text-white/45 uppercase tracking-wider mb-3">
                  Recently handled
                </h2>
                <div className="flex flex-col gap-1">
                  {handled.map((rq) => (
                    <div key={rq.id} className="text-[12px] text-white/55 font-semibold px-3 py-1.5 rounded-lg bg-white/4">
                      <span className="text-white/80">{rq.familyName}</span> · {rq.requestedTier} ·{' '}
                      <span style={{ color: rq.status === 'fulfilled' ? '#5BB85B' : '#D4A847' }}>{rq.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Generated codes */}
            <section>
              <h2 className="text-[12px] font-black text-white/55 uppercase tracking-wider mb-3">
                Generated codes · {codes.length}
              </h2>
              {codes.length === 0 ? (
                <div className="text-white/45 text-sm py-8 text-center bg-white/5 rounded-2xl border border-white/8">
                  No codes generated yet.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {codes.map((c) => <CodeRow key={c.id} code={c} onRevoke={() => revoke(c.id)} />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {generating && (
        <GenerateModal
          request={generating}
          onCancel={() => setGenerating(null)}
          onDone={(result) => {
            setGenerating(null);
            setToast(result.emailSent
              ? { kind: 'ok', msg: `Code sent to ${result.recipientEmail} ✓` }
              : { kind: 'err', msg: `Code saved but email failed: ${result.emailError ?? 'unknown'}` });
            reload();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-[13px] font-black shadow-lg max-w-[480px]"
             style={toast.kind === 'ok'
               ? { background: 'rgba(91,184,91,0.95)', color: 'white' }
               : { background: 'rgba(232,92,92,0.95)', color: 'white' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function RequestRow({
  rq, onGenerate, onDismiss,
}: {
  rq: UpgradeRequestRow;
  onGenerate: () => void;
  onDismiss: () => void;
}) {
  const tier = DEFAULT_TIERS[rq.requestedTier];
  const since = relTime(rq.createdAtMs);
  return (
    <div className="rounded-2xl px-4 py-3"
         style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-start gap-3">
        <div className="text-2xl flex-shrink-0">{tier.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-black text-[14px]">{rq.familyName}</span>
            {rq.familyHandle && <span className="text-[#D4A847] text-[11px] font-bold">@{rq.familyHandle}</span>}
            <span className="text-white/50 text-[11px] font-bold">· {since}</span>
          </div>
          <div className="text-white/65 text-[12px] font-bold mt-1">
            Requesting <span className="text-white">{tier.name}</span>
            {rq.requestedAddons.length > 0 && <> · {rq.requestedAddons.length} add-on{rq.requestedAddons.length === 1 ? '' : 's'}</>}
            {rq.requesterEmail && <> · {rq.requesterEmail}</>}
          </div>
          {rq.note && (
            <div className="text-white/45 text-[12px] font-semibold mt-1 italic">"{rq.note}"</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onGenerate}
                className="text-[12px] font-black px-3 py-1.5 rounded-lg"
                style={{ background: '#D4A847', color: '#0F1F44' }}>
          Generate code →
        </button>
        <button onClick={onDismiss}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function CodeRow({ code, onRevoke }: { code: TierCodeRow; onRevoke: () => void }) {
  const tier = DEFAULT_TIERS[code.tierId];
  const chip = statusChip(code.status);
  // Code string is hidden — admin doesn't need it. Show last-4 only.
  const last4 = code.code.slice(-4);
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center gap-3"
         style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-lg flex-shrink-0">{tier.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-black text-[13px] truncate">
          {code.familyName}
          {code.familyHandle && <span className="text-[#D4A847] font-bold ml-1.5">@{code.familyHandle}</span>}
        </div>
        <div className="text-white/55 text-[11px] font-semibold flex items-center gap-2 flex-wrap mt-0.5">
          <span>{tier.name}</span>
          <span>·</span>
          <span title={code.code}>·····{last4}</span>
          <span>·</span>
          <span>{expiryCopy(code.expiresAtMs)}</span>
          <span>·</span>
          <span>sent to {code.recipientEmail}</span>
          {!code.emailSent && code.emailError && (
            <>
              <span>·</span>
              <span style={{ color: '#FF7676' }}>email failed</span>
            </>
          )}
        </div>
      </div>
      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full flex-shrink-0"
            style={{ background: chip.bg, color: chip.fg }}>
        {chip.label}
      </span>
      {code.status === 'fresh' && (
        <button onClick={onRevoke}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(232,92,92,0.15)', color: '#FF7676', border: '1px solid rgba(232,92,92,0.3)' }}>
          Revoke
        </button>
      )}
    </div>
  );
}

function GenerateModal({
  request,
  onCancel,
  onDone,
}: {
  request: UpgradeRequestRow;
  onCancel: () => void;
  onDone: (result: { emailSent: boolean; emailError: string | null; recipientEmail: string }) => void;
}) {
  const [tierId, setTierId] = useState<SubscriptionTierId>(request.requestedTier);
  const [addons, setAddons] = useState<Set<string>>(new Set(request.requestedAddons));
  const [expiry, setExpiry] = useState<ExpiryPreset>('30d');
  const [recipientEmail, setRecipientEmail] = useState(request.requesterEmail || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCastle = tierId === 'castle';

  const submit = async () => {
    setSubmitting(true); setErr(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/admin/tier-codes', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          familyId: request.familyId,
          requestId: request.id,
          tierId,
          addons: isCastle ? [] : [...addons],
          expiry,
          recipientEmail: recipientEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'unknown' }));
        throw new Error(error || 'generate-failed');
      }
      const result = await res.json() as { emailSent: boolean; emailError: string | null; recipientEmail: string };
      onDone(result);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50 px-4 py-6"
         style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
         onClick={onCancel}>
      <div className="w-full max-w-[480px] rounded-3xl p-6 max-h-[85vh] overflow-y-auto"
           style={{ background: '#162954', border: '1px solid rgba(255,255,255,0.1)' }}
           onClick={(e) => e.stopPropagation()}>

        <div className="mb-4">
          <div className="text-white font-black text-lg">Generate code for {request.familyName}</div>
          <div className="text-white/55 text-[12px] font-semibold">
            Code emails directly. You won't see it — only the family will.
          </div>
        </div>

        {/* Tier */}
        <section className="mb-4">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Tier</div>
          <div className="flex gap-2">
            {(['nest', 'home', 'castle'] as SubscriptionTierId[]).map((id) => {
              const t = DEFAULT_TIERS[id];
              const selected = tierId === id;
              return (
                <button key={id} onClick={() => setTierId(id)}
                  className="flex-1 rounded-xl px-3 py-2.5 text-center transition-colors"
                  style={{
                    background: selected ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
                    border: selected ? '1px solid rgba(212,168,71,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  <div className="text-xl">{t.emoji}</div>
                  <div className="text-[11px] font-black text-white mt-1">{t.name.replace('Kaya ', '')}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Addons */}
        <section className="mb-4">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">
            Add-ons {isCastle && <span className="text-[#D4A847] normal-case font-bold ml-1">— Castle includes all</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_ADDONS.map((a) => {
              const on = addons.has(a.id);
              return (
                <button key={a.id} disabled={isCastle}
                  onClick={() => {
                    const next = new Set(addons);
                    if (on) next.delete(a.id); else next.add(a.id);
                    setAddons(next);
                  }}
                  className="text-left rounded-lg px-2.5 py-2 flex items-center gap-2 disabled:opacity-50"
                  style={{
                    background: on ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
                    border: on ? '1px solid rgba(212,168,71,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  <span>{a.emoji}</span>
                  <span className="text-white font-bold text-[11px] truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Expiry */}
        <section className="mb-4">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Expires</div>
          <div className="flex gap-2 flex-wrap">
            {EXPIRY_OPTIONS.map((opt) => {
              const selected = expiry === opt.id;
              return (
                <button key={opt.id} onClick={() => setExpiry(opt.id)}
                  className="rounded-full px-3 py-1.5 text-[12px] font-black"
                  style={{
                    background: selected ? 'rgba(212,168,71,0.22)' : 'rgba(255,255,255,0.04)',
                    color: selected ? '#D4A847' : 'rgba(255,255,255,0.65)',
                    border: selected ? '1px solid rgba(212,168,71,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Recipient email override */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Send to</div>
          <input value={recipientEmail}
                 onChange={(e) => setRecipientEmail(e.target.value)}
                 placeholder="auto · resolved from family"
                 className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-[13px] font-bold outline-none" />
          <div className="text-[10px] text-white/45 font-semibold mt-1">
            Leave blank to use the requester's email · or the family creator's email as a fallback.
          </div>
        </section>

        {err && (
          <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/30 rounded-xl px-3 py-2 text-[#FF7676] text-[12px] font-bold mb-4">{err}</div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-white/10">
          <button onClick={onCancel} disabled={submitting}
                  className="flex-1 text-[13px] font-bold py-2.5 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}
                  className="flex-1 text-[13px] font-black py-2.5 rounded-xl disabled:opacity-50"
                  style={{ background: '#D4A847', color: '#0F1F44' }}>
            {submitting ? 'Sending…' : 'Generate &amp; email →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function relTime(ms: number): string {
  if (!ms) return 'just now';
  const diff = Date.now() - ms;
  const min = 60_000, hr = 60 * min, day = 24 * hr;
  if (diff < min)      return 'just now';
  if (diff < hr)       return `${Math.round(diff / min)}m ago`;
  if (diff < day)      return `${Math.round(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
