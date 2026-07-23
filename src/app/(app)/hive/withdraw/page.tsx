'use client';

// /hive/withdraw — the Kaya ATM 🏧 (CASH UPGRADE, design v1 screen B).
// The kid turns banked Honey Pot money into real, in-hand Cash: pick an
// amount → parent approves → real 🤝 handover (money moves only then).
// While a withdrawal is pending this page shows the 3-step tracker and the
// 4-digit handover code the kid presents at pickup.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { requestTreasuryToCash, cancelOwnRequest } from '@/lib/hive';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NumberInput from '@/components/hive/NumberInput';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';

// "Nice" quick-pick amounts scaled to the Pot: ~5% rounded to a clean
// 1/2/2.5/5 × 10ⁿ figure, then ×2 and ×5 of it (e.g. a TZS 103,200 Pot
// offers 5,000 / 10,000 / 25,000). Max fills the whole Pot.
function niceChipsCents(potCents: number): number[] {
  if (potCents <= 0) return [];
  const raw = potCents / 20;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10;
  const base = Math.round(nice * mag);
  return [base, base * 2, base * 5].filter((c) => c > 0 && c <= potCents);
}

export default function WithdrawPage() {
  const { profile, isGuest } = useAuth();
  const { activeKidId, wallet, config, myRequests } = useHive();

  const [amountInput, setAmountInput] = useState<number>(0);
  const [whatFor, setWhatFor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const potCents = wallet.treasuryCents || 0;
  const cents = Math.round(amountInput * 100) || 0;
  const chips = useMemo(() => niceChipsCents(potCents), [potCents]);

  // 🧞 Wish Jar deep-link: /hive/withdraw?amount=180000&for=My+wish… pre-fills
  // the form (same window.location pattern as the statement's ?layer=).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const amt = parseFloat(q.get('amount') || '');
    if (Number.isFinite(amt) && amt > 0) setAmountInput(amt);
    const forWhat = q.get('for');
    if (forWhat) setWhatFor(forWhat.slice(0, 120));
  }, []);

  const pendingWithdrawals = useMemo(
    () => myRequests.filter((r) => r.type === 'treasury_to_cash' && r.status === 'pending'),
    [myRequests],
  );

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    if (cents <= 0) { setError('Pick an amount.'); return; }
    if (cents > potCents) {
      setError(`Your Honey Pot has ${formatCash(potCents, config.currency)}.`);
      return;
    }
    setSubmitting(true);
    try {
      await requestTreasuryToCash(
        profile.familyId, activeKidId, cents, profile.uid,
        config.treasuryCashApprovers, whatFor.trim(),
      );
      setAmountInput(0);
      setWhatFor('');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit.');
    }
    setSubmitting(false);
  };

  const cancel = async (requestId: string) => {
    if (!profile?.familyId || isGuest) return;
    await cancelOwnRequest(profile.familyId, requestId, profile.uid);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Kaya ATM</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Get real cash 🏧</h1>
      </div>

      <KidSwitcher />

      {/* Pending withdrawal(s) — tracker + handover code (design screen B). */}
      {pendingWithdrawals.map((r) => {
        const atHandover = r.stage === 'handover';
        return (
          <div key={r.id} className="bg-hive-paper border-2 border-hive-honey/60 rounded-hive-lg p-4 mb-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-nunito font-black text-[14px]">🏧 {formatCash(r.amountCents || 0, config.currency)}</p>
              {!atHandover && (
                <button
                  onClick={() => cancel(r.id)}
                  className="px-3 py-1 rounded-[10px] bg-[#FCEAEA] text-hive-rose font-nunito font-extrabold text-[11px]"
                >
                  Cancel
                </button>
              )}
            </div>
            {r.description && r.description !== 'Withdraw to real cash 🏧' && (
              <p className="text-[12px] text-hive-muted mt-0.5">{r.description}</p>
            )}

            {/* 3-step tracker: Requested → Parent OK · handover → Cash in hand */}
            <div className="mt-3 flex items-center gap-1">
              {[
                { emoji: '✓', label: 'Requested', state: 'done' },
                { emoji: '🤝', label: atHandover ? 'Approved — collect!' : 'Parent OK · handover', state: atHandover ? 'now' : 'wait' },
                { emoji: '💵', label: 'Cash in hand', state: 'wait' },
              ].map((s, i) => (
                <div key={s.label} className="flex-1 flex items-center gap-1">
                  {i > 0 && <div className={`h-[3px] flex-1 rounded ${s.state === 'now' || (i === 1 && atHandover) ? 'bg-hive-green' : 'bg-hive-line'}`} />}
                  <div className="text-center shrink-0">
                    <div className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-[13px] ${
                      s.state === 'done' ? 'bg-hive-green text-white'
                        : s.state === 'now' ? 'bg-hive-honey text-white shadow-[0_0_0_4px_rgba(243,156,47,0.25)]'
                        : 'bg-hive-line/60'
                    }`}>{s.emoji}</div>
                    <p className="text-[9.5px] font-nunito font-extrabold text-hive-muted mt-1 leading-tight w-[76px]">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-hive-muted text-center mt-3">
              {atHandover
                ? '🎉 Approved! Show this code when you collect your money:'
                : 'Show this code when you collect your money:'}
            </p>
            <div className="mt-1.5 rounded-hive bg-hive-navy text-[#FFD57E] font-nunito font-black text-[26px] tracking-[10px] text-center py-2.5 pl-[10px]">
              {r.code || '· · · ·'}
            </div>
          </div>
        );
      })}

      {/* Request form */}
      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 space-y-3">
        <div>
          <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">How much?</label>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-nunito font-black text-3xl text-hive-muted">{config.currency}</span>
            <NumberInput
              value={amountInput}
              onChange={setAmountInput}
              allowDecimal
              min={0}
              ariaLabel="Withdrawal amount"
              placeholder="0"
              autoFocus
              className="font-nunito font-black text-3xl bg-transparent outline-none w-full max-w-[200px] placeholder:text-hive-muted/30 min-w-0"
            />
          </div>
          <p className="text-[11px] text-hive-muted mt-1">
            From your 🍯 Pot · {formatCash(potCents, config.currency)} available
          </p>
          {(chips.length > 0 || potCents > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() => setAmountInput(c / 100)}
                  className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                    cents === c ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                  }`}
                >
                  {formatCash(c, config.currency)}
                </button>
              ))}
              <button
                onClick={() => setAmountInput(potCents / 100)}
                className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                  cents === potCents ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted'
                }`}
              >
                Max
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
            What&apos;s it for? <span className="normal-case tracking-normal font-bold">(optional)</span>
          </label>
          <input
            value={whatFor}
            onChange={(e) => setWhatFor(e.target.value)}
            placeholder="e.g. Spinach seeds for my garden 🌱"
            maxLength={120}
            className="w-full mt-1 h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>

        {cents > 0 && cents <= potCents && (
          <p className="text-[12px] text-hive-muted">
            After: 🍯 {formatCash(potCents - cents, config.currency)} · 💵 {formatCash((wallet.cashCents || 0) + cents, config.currency)}
          </p>
        )}
        {error && <p className="text-hive-rose text-sm font-bold">{error}</p>}

        <button
          onClick={submit}
          disabled={submitting || cents <= 0 || isGuest || !activeKidId}
          className="w-full h-12 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-[14px] disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]"
        >
          {submitting ? 'Sending…' : `Ask ${config.treasuryCashApprovers >= 2 ? 'both parents' : 'parent'} for my cash →`}
        </button>
      </div>

      <p className="mt-3 text-[11px] text-hive-muted text-center leading-relaxed">
        Your parent approves, then hands you the real money 🤝 — your 💵 Cash
        updates the moment it&apos;s in your hand.
      </p>

      <div className="mt-6 flex items-center justify-center gap-4">
        <Link href="/hive" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">← Back to the Hive</Link>
        <span className="text-hive-line">·</span>
        <Link href="/hive/cash-out" className="text-[12px] font-nunito font-extrabold text-hive-muted hover:text-hive-honey-dk hover:underline">🛒 Spend my Cash</Link>
      </div>
    </div>
  );
}
