'use client';

// /parent/hive-deposit — manual cash deposit. Parent can:
//   - Pick one OR several kids at once (each gets the same deposit).
//   - Pick a category (allowance / gift / business / other).
//   - Optionally enter the amount in a *different* currency at a given
//     exchange rate. We always store in the family's default currency.
// No approval is required because the parent IS the approver.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { depositCash, CURRENCIES } from '@/lib/hive';
import { fetchFxRates, suggestedRate, formatRate, FxRates } from '@/lib/fxRates';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import { formatCash } from '@/components/hive/format';
import NumberInput from '@/components/hive/NumberInput';

const CATEGORIES = [
  { id: 'allowance' as const, emoji: '💵', label: 'Allowance',     desc: 'Regular pocket money' },
  { id: 'gift'      as const, emoji: '🎁', label: 'Gift',          desc: 'Birthday, holiday, milestone' },
  { id: 'business'  as const, emoji: '🌳', label: 'Business',      desc: 'Earnings from a side hustle' },
  { id: 'other'     as const, emoji: '✨', label: 'Other',         desc: 'Anything else' },
];

export default function HiveDepositPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const { config } = useHive();
  const defaultCurrency = config.currency;

  const [kidIds, setKidIds] = useState<string[]>([]);
  /** Source amount in MAJOR units of `sourceCurrency` (or default currency
   *  if FX is off). Held as a number so the NumberInput stays clean. */
  const [amount, setAmount] = useState<number>(0);
  const [category, setCategory] = useState<typeof CATEGORIES[number]['id']>('allowance');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ kidNames: string[]; cents: number; perKid: boolean } | null>(null);
  const [error, setError] = useState('');

  // Source-currency toggle. When ON, the parent enters the amount in the
  // source currency and a 1-unit-source-to-default-currency rate; we
  // compute the destination cents and store that. Receipts (descriptions)
  // record both sides so the audit trail is unambiguous.
  const [useFx, setUseFx] = useState(false);
  const [sourceCurrency, setSourceCurrency] = useState(defaultCurrency);
  const [fxRate, setFxRate] = useState<number>(1);
  // Live exchange rates from open.er-api.com (no key, free, cached daily
  // in localStorage). Drives the "Suggested rate" pill so a parent doesn't
  // have to pull up Google Finance every time.
  const [fx, setFx] = useState<FxRates | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFxRates('USD').then((r) => { if (!cancelled) setFx(r); });
    return () => { cancelled = true; };
  }, []);

  const fxSuggestion = useFx && sourceCurrency !== defaultCurrency
    ? suggestedRate(fx, sourceCurrency, defaultCurrency)
    : null;
  // Auto-fill the suggested rate when the parent opens the FX panel for
  // the first time (or switches source currency). They can override.
  useEffect(() => {
    if (fxSuggestion && fxSuggestion > 0) {
      setFxRate(parseFloat(formatRate(fxSuggestion).replace(/,/g, '')) || 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCurrency, useFx, fx]);

  const toggleKid = (id: string) => {
    setKidIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // Compute the destination amount (in cents of the family's default
  // currency). Without FX it's just amount × 100. With FX it's
  // sourceAmount × fxRate × 100.
  const sourceAmount = amount;
  const fxNum = fxRate;
  const destCents = useFx
    ? Math.round(sourceAmount * fxNum * 100)
    : Math.round(sourceAmount * 100);

  const sourceMeta = CURRENCIES.find((c) => c.code === sourceCurrency);
  const sourceSym = sourceMeta?.symbol || '$';

  const submit = async () => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    if (kidIds.length === 0) { setError('Pick at least one kid.'); return; }
    if (destCents <= 0) { setError('Pick an amount.'); return; }
    if (useFx && fxNum <= 0) { setError('Pick a positive exchange rate.'); return; }

    // Description records both sides so the parent can read the ledger
    // later and reconstruct what actually happened.
    const baseDesc = description.trim() || CATEGORIES.find((c) => c.id === category)!.label;
    const recordDesc = useFx && sourceCurrency !== defaultCurrency
      ? `${baseDesc} · ${sourceSym}${sourceAmount.toFixed(2)} ${sourceCurrency} @ ${fxNum} → ${defaultCurrency}`
      : baseDesc;

    setSubmitting(true);
    try {
      // One deposit per kid. We do them sequentially so a partial failure
      // (e.g. one kid's wallet doesn't exist yet) doesn't block the rest.
      await Promise.all(
        kidIds.map((kidId) => depositCash(
          profile.familyId, kidId, destCents, category, recordDesc, profile.uid,
        )),
      );
      const kidNames = children.filter((c) => kidIds.includes(c.id)).map((c) => c.name);
      setSuccess({ kidNames, cents: destCents, perKid: kidIds.length > 1 });
      setAmount(0);
      setDescription('');
      setKidIds([]);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e?.message || 'Deposit failed.');
    }
    setSubmitting(false);
  };

  if (success) {
    const formatNames = (names: string[]) => {
      if (names.length === 1) return names[0];
      if (names.length === 2) return `${names[0]} & ${names[1]}`;
      return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
    };
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 lg:pt-24 text-center">
        <div className="text-6xl mb-4">💸</div>
        <h2 className="font-nunito font-black text-3xl mb-2">
          {success.perKid ? 'Deposited to all!' : 'Deposited!'}
        </h2>
        <p className="text-hive-muted text-sm">
          {formatNames(success.kidNames)} got{' '}
          <span className="text-hive-green font-bold">
            +{formatCash(success.cents, defaultCurrency)}
            {success.perKid ? ' each' : ''}
          </span>{' '}
          in their Cash balance.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Deposit cash 💸</h1>
        <p className="text-sm text-hive-muted mt-2">
          Allowance, gifts, or business income — credits each kid&apos;s Cash balance instantly.
          You can disburse to several kids at once.
        </p>
      </div>

      <div className="space-y-4">
        {/* Multi-select kid picker */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
              For who?
              {kidIds.length > 0 && (
                <span className="ml-2 text-hive-honey-dk normal-case">{kidIds.length} selected</span>
              )}
            </p>
            {children.length > 1 && (
              kidIds.length === children.length ? (
                <button onClick={() => setKidIds([])} className="text-[11px] font-nunito font-extrabold text-hive-muted hover:text-hive-rose">
                  Clear
                </button>
              ) : (
                <button onClick={() => setKidIds(children.map((c) => c.id))} className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                  Select all
                </button>
              )
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {children.map((c) => {
              const sel = kidIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleKid(c.id)}
                  aria-pressed={sel}
                  className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-hive border-2 transition-all ${
                    sel ? 'bg-hive-honey text-white border-transparent shadow-sm' : 'bg-hive-paper border-hive-line text-hive-muted hover:border-hive-honey/50'
                  }`}
                >
                  <KidAvatar child={c} size="sm" />
                  <span className="font-nunito font-extrabold text-[13px]">{c.name}</span>
                  {sel && (
                    <span className="ml-auto inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px] font-black">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount + currency. Toggle reveals the FX inputs. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">How much?</p>
            <button
              onClick={() => {
                setUseFx((v) => !v);
                if (useFx) {
                  setSourceCurrency(defaultCurrency);
                  setFxRate(1);
                }
              }}
              className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline"
            >
              {useFx ? 'Same as default currency' : 'Different currency?'}
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-nunito font-black text-4xl text-hive-muted">
              {(useFx ? sourceSym : (CURRENCIES.find((c) => c.code === defaultCurrency)?.symbol || '$')).trim() || '$'}
            </span>
            <NumberInput
              value={amount}
              onChange={setAmount}
              allowDecimal
              min={0}
              ariaLabel="Deposit amount"
              placeholder="0.00"
              className="font-nunito font-black text-4xl bg-transparent outline-none flex-1 placeholder:text-hive-muted/30 min-w-0"
            />
          </div>
          {useFx && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted mb-1">Source currency</p>
                  <select
                    value={sourceCurrency}
                    onChange={(e) => setSourceCurrency(e.target.value)}
                    className="w-full h-10 px-2 bg-hive-cream rounded-[10px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted mb-1">
                    Rate · 1 {sourceCurrency} = ? {defaultCurrency}
                  </p>
                  <NumberInput
                    value={fxRate}
                    onChange={setFxRate}
                    allowDecimal
                    min={0}
                    ariaLabel="Exchange rate"
                    placeholder="1.00"
                    className="w-full h-10 px-3 bg-hive-cream rounded-[10px] font-nunito font-extrabold text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                  />
                </div>
              </div>

              {/* Suggested rate pill — fetched live from open.er-api.com,
                  cached for the day. Only renders when source ≠ default
                  AND we got a usable rate. */}
              {fxSuggestion && (
                <button
                  type="button"
                  onClick={() => setFxRate(parseFloat(formatRate(fxSuggestion).replace(/,/g, '')) || 0)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-hive-pill bg-hive-honey-soft/70 text-hive-honey-dk text-[11px] font-nunito font-extrabold hover:brightness-105"
                >
                  💡 Today: 1 {sourceCurrency} ≈ {formatRate(fxSuggestion)} {defaultCurrency} ·
                  {' '}{Math.abs(fxNum - fxSuggestion) < fxSuggestion * 0.001 ? '✓ already using this' : 'Use suggested'}
                </button>
              )}

              {/* Verbose commentary — keeps the parent oriented as they
                  type. Mirrors what the receipt will say in the ledger. */}
              {sourceAmount > 0 && fxNum > 0 ? (
                <div className="rounded-hive bg-hive-cream border border-hive-line p-3 text-[12px] leading-relaxed">
                  <p className="font-nunito font-extrabold text-hive-honey-dk uppercase tracking-[1.5px] text-[10px] mb-1">Conversion</p>
                  <p>
                    <strong>{sourceSym}{sourceAmount.toLocaleString('en-US')} {sourceCurrency}</strong>{' '}
                    × <strong>{fxNum}</strong> ={' '}
                    <strong className="text-hive-green">{formatCash(destCents, defaultCurrency)}</strong>{' '}
                    stored as {defaultCurrency}.
                    {kidIds.length > 1 && (
                      <> Per kid · <strong>{kidIds.length} kids</strong> = total{' '}
                        <strong>{formatCash(destCents * kidIds.length, defaultCurrency)}</strong>.</>
                    )}
                  </p>
                  {fx && fxSuggestion && Math.abs(fxNum - fxSuggestion) > fxSuggestion * 0.05 && (
                    <p className="mt-1 text-hive-muted text-[11px]">
                      ⚠ {Math.round(Math.abs(fxNum - fxSuggestion) / fxSuggestion * 100)}% off today&apos;s market rate
                      ({formatRate(fxSuggestion)}). Worth a double-check.
                    </p>
                  )}
                </div>
              ) : (
                !fxSuggestion && (
                  <p className="text-[11px] text-hive-muted leading-relaxed">
                    Tip: enter the rate from your bank or a search like &quot;1 {sourceCurrency} to {defaultCurrency}&quot;.
                  </p>
                )
              )}
            </div>
          )}
        </div>

        {/* Category */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Category</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => {
              const sel = category === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`flex items-start gap-2 p-2.5 rounded-hive border-2 text-left transition-all ${
                    sel ? 'border-hive-honey bg-hive-honey-soft/50' : 'border-hive-line bg-hive-paper hover:border-hive-honey/40'
                  }`}
                >
                  <span className="text-xl shrink-0">{c.emoji}</span>
                  <div className="min-w-0">
                    <p className="font-nunito font-extrabold text-[13px] leading-tight">{c.label}</p>
                    <p className="text-[10px] text-hive-muted leading-snug">{c.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional note */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Note (optional)</p>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Birthday gift from Auntie Sarah"
            maxLength={120}
            className="w-full h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>

        {error && (
          <p className="text-hive-rose text-sm font-bold">{error}</p>
        )}

        <button
          onClick={submit}
          disabled={submitting || isGuest}
          className="w-full h-12 rounded-hive bg-hive-green hover:brightness-110 text-white font-nunito font-black text-sm disabled:opacity-40 transition shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]"
        >
          {submitting
            ? 'Depositing…'
            : kidIds.length > 1 && destCents > 0
              ? `Deposit ${formatCash(destCents, defaultCurrency)} to ${kidIds.length} kids`
              : `Deposit ${destCents > 0 ? formatCash(destCents, defaultCurrency) : ''}`}
        </button>
      </div>
    </div>
  );
}
