'use client';

// /parent/hive-deposit — Deposit 2.0 (CASH UPGRADE, design v1 screen F).
// Parent can:
//   - Pick one OR several kids at once (each gets the same deposit).
//   - Pick the destination: 🍯 Honey Pot (app money, the default) or
//     💵 Cash (recording real money being handed over right now).
//   - Pick a category — built-ins + categories the FAMILY created (＋ New);
//     Money Buddy 🤖 suggests one from the note and remembers choices.
//   - Optionally enter the amount in a *different* currency at a given
//     exchange rate. We always store in the family's default currency.
// No approval is required because the parent IS the approver.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { depositCash, depositToTreasury, setHiveConfig, CURRENCIES } from '@/lib/hive';
import {
  depositCategories, suggestDepositCategory, customCategoryId,
  learnDepositChoicePatch, type DepositCategory,
} from '@/lib/moneyBuddy';
import { fetchFxRates, suggestedRate, formatRate, FxRates } from '@/lib/fxRates';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import { formatCash } from '@/components/hive/format';
import NumberInput from '@/components/hive/NumberInput';

const NEW_CAT_EMOJIS = ['🍪', '🎨', '⚽', '📱', '🎓', '🧸', '🚌', '💊', '✨'];

export default function HiveDepositPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const { config } = useHive();
  const defaultCurrency = config.currency;

  const [kidIds, setKidIds] = useState<string[]>([]);
  /** Source amount in MAJOR units of `sourceCurrency` (or default currency
   *  if FX is off). Held as a number so the NumberInput stays clean. */
  const [amount, setAmount] = useState<number>(0);
  const [dest, setDest] = useState<'cash' | 'treasury'>('treasury');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ kidNames: string[]; cents: number; perKid: boolean; dest: 'cash' | 'treasury' } | null>(null);
  const [error, setError] = useState('');

  // ── Categories: built-ins + family customs, most-used first ─────
  const cats = useMemo(() => depositCategories(config), [config]);
  const [categoryId, setCategoryId] = useState<string>('allowance');
  const selectedCat: DepositCategory =
    cats.find((c) => c.id === categoryId) || cats[0];
  // ＋ New category inline form.
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState(NEW_CAT_EMOJIS[0]);
  const [savingCat, setSavingCat] = useState(false);

  // ── Money Buddy 🤖 — suggest from the note; dismissible per note ─
  const suggestion = useMemo(
    () => suggestDepositCategory(description, config),
    [description, config],
  );
  const [dismissedFor, setDismissedFor] = useState('');
  const showSuggestion =
    !!suggestion && suggestion.category.id !== categoryId && dismissedFor !== description;

  // Source-currency toggle. When ON, the parent enters the amount in the
  // source currency and a 1-unit-source-to-default-currency rate; we
  // compute the destination cents and store that. Receipts (descriptions)
  // record both sides so the audit trail is unambiguous.
  const [useFx, setUseFx] = useState(false);
  const [sourceCurrency, setSourceCurrency] = useState(defaultCurrency);
  const [fxRate, setFxRate] = useState<number>(1);
  const [fx, setFx] = useState<FxRates | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFxRates('USD').then((r) => { if (!cancelled) setFx(r); });
    return () => { cancelled = true; };
  }, []);

  const fxSuggestion = useFx && sourceCurrency !== defaultCurrency
    ? suggestedRate(fx, sourceCurrency, defaultCurrency)
    : null;
  useEffect(() => {
    if (fxSuggestion && fxSuggestion > 0) {
      setFxRate(parseFloat(formatRate(fxSuggestion).replace(/,/g, '')) || 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCurrency, useFx, fx]);

  const toggleKid = (id: string) => {
    setKidIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const sourceAmount = amount;
  const fxNum = fxRate;
  const destCents = useFx
    ? Math.round(sourceAmount * fxNum * 100)
    : Math.round(sourceAmount * 100);

  const sourceMeta = CURRENCIES.find((c) => c.code === sourceCurrency);
  const sourceSym = sourceMeta?.symbol || '$';

  const addCustomCategory = async () => {
    if (!profile?.familyId || isGuest) return;
    const label = newCatLabel.trim();
    if (!label) return;
    const id = customCategoryId(label);
    if (!id.replace('custom:', '')) return;
    if (cats.some((c) => c.id === id || c.label.toLowerCase() === label.toLowerCase())) {
      setCategoryId(cats.find((c) => c.label.toLowerCase() === label.toLowerCase())?.id || id);
      setShowNewCat(false); setNewCatLabel('');
      return;
    }
    setSavingCat(true);
    try {
      await setHiveConfig(profile.familyId, {
        depositCategories: [
          ...(config.depositCategories || []),
          { id, emoji: newCatEmoji, label },
        ],
      });
      setCategoryId(id);
      setShowNewCat(false);
      setNewCatLabel('');
    } catch (e: any) {
      setError(e?.message || 'Couldn’t save the category.');
    }
    setSavingCat(false);
  };

  const submit = async () => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    if (kidIds.length === 0) { setError('Pick at least one kid.'); return; }
    if (destCents <= 0) { setError('Pick an amount.'); return; }
    if (useFx && fxNum <= 0) { setError('Pick a positive exchange rate.'); return; }

    // Description records both sides so the parent can read the ledger
    // later and reconstruct what actually happened. Custom categories keep
    // their label in the row text (the ledger's TxCategory for them is 'other').
    const baseDesc = description.trim() || selectedCat.label;
    const recordDesc = useFx && sourceCurrency !== defaultCurrency
      ? `${baseDesc} · ${sourceSym}${sourceAmount.toFixed(2)} ${sourceCurrency} @ ${fxNum} → ${defaultCurrency}`
      : baseDesc;

    setSubmitting(true);
    try {
      await Promise.all(
        kidIds.map((kidId) => dest === 'treasury'
          ? depositToTreasury(
              profile.familyId, kidId, destCents,
              selectedCat.txCategory, recordDesc, profile.uid,
            )
          : depositCash(
              profile.familyId, kidId, destCents, selectedCat.txCategory, recordDesc, profile.uid,
            )),
      );
      // Teach Money Buddy 🤖 — note keywords → this category, usage bump for
      // chip ordering. Best-effort: a failed lesson never blocks the deposit.
      setHiveConfig(
        profile.familyId,
        learnDepositChoicePatch(description, selectedCat.id, config),
      ).catch(() => {});
      const kidNames = children.filter((c) => kidIds.includes(c.id)).map((c) => c.name);
      setSuccess({ kidNames, cents: destCents, perKid: kidIds.length > 1, dest });
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
        <div className="text-6xl mb-4">{success.dest === 'treasury' ? '🍯' : '💸'}</div>
        <h2 className="font-nunito font-black text-3xl mb-2">
          {success.perKid ? 'Deposited to all!' : 'Deposited!'}
        </h2>
        <p className="text-hive-muted text-sm">
          {formatNames(success.kidNames)} got{' '}
          <span className="text-hive-green font-bold">
            +{formatCash(success.cents, defaultCurrency)}
            {success.perKid ? ' each' : ''}
          </span>{' '}
          in their {success.dest === 'treasury' ? 'Honey Pot 🍯' : '💵 Cash'}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · Deposit</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">Top up the Hive 🍯</h1>
        <p className="text-sm text-hive-muted mt-2">
          Allowance, gifts, rewards or business income — into the Honey Pot (their bank)
          or 💵 Cash when you&apos;re handing real money now. Several kids at once is fine.
        </p>
      </div>

      <div className="space-y-4">
        {/* Multi-select kid picker */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
              Who for?
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

        {/* Destination — 🍯 Pot (app money, default) or 💵 Cash (real handover). */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Where to?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDest('treasury')}
              aria-pressed={dest === 'treasury'}
              className={`p-3 rounded-hive border-2 text-left transition-all ${dest === 'treasury' ? 'border-hive-honey bg-hive-honey-soft/40' : 'border-hive-line bg-hive-paper hover:border-hive-honey/40'}`}
            >
              <p className="font-nunito font-extrabold text-[13px]">🍯 Honey Pot</p>
              <p className="text-[10.5px] text-hive-muted leading-snug mt-0.5">App money — lands in their bank. A 🏧 withdrawal turns it into real cash.</p>
            </button>
            <button
              onClick={() => setDest('cash')}
              aria-pressed={dest === 'cash'}
              className={`p-3 rounded-hive border-2 text-left transition-all ${dest === 'cash' ? 'border-hive-green bg-[#EAF7F0]' : 'border-hive-line bg-hive-paper hover:border-hive-green/40'}`}
            >
              <p className="font-nunito font-extrabold text-[13px]">💵 Cash</p>
              <p className="text-[10.5px] text-hive-muted leading-snug mt-0.5">I&apos;m handing real money now — records it straight into their hand.</p>
            </button>
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

        {/* Note — Money Buddy reads this to suggest a category. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Note (optional)</p>
          <input
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDismissedFor(''); }}
            placeholder="e.g. July pocket money"
            maxLength={120}
            className="w-full h-11 px-3 bg-hive-cream rounded-[12px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          />
        </div>

        {/* Money Buddy 🤖 suggestion — learned hints beat first-run instincts. */}
        {showSuggestion && suggestion && (
          <div className="rounded-hive border border-[#DCD0F5] bg-[#F1EBFC] p-3 flex items-start gap-2.5">
            <span className="text-xl shrink-0">🤖</span>
            <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
              {suggestion.learned
                ? <>I remembered — you usually file this as <strong>{suggestion.category.emoji} {suggestion.category.label}</strong>.</>
                : <>Looks like <strong>{suggestion.category.emoji} {suggestion.category.label}</strong> — tap to confirm, or pick another. I&apos;ll remember your choice for next time.</>}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => setCategoryId(suggestion.category.id)}
                  className="px-3 py-1 rounded-hive-pill bg-[#8E6FD8] text-white text-[11px] font-nunito font-extrabold hover:brightness-110"
                >
                  Use {suggestion.category.label}
                </button>
                <button
                  onClick={() => setDismissedFor(description)}
                  className="px-3 py-1 rounded-hive-pill bg-white/70 text-hive-muted text-[11px] font-nunito font-extrabold"
                >
                  No thanks
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Category — built-ins + family customs, most-used first, ＋ New. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => {
              const sel = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition-colors ${
                    sel ? 'bg-hive-honey text-white border-transparent' : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-honey/50'
                  }`}
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
            <button
              onClick={() => setShowNewCat((v) => !v)}
              className="px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border border-dashed border-hive-honey text-hive-honey-dk bg-hive-paper hover:bg-hive-honey-soft/40 transition-colors"
            >
              ＋ New
            </button>
          </div>
          {(config.depositCategories?.length || 0) > 0 && (
            <p className="text-[11px] text-hive-muted mt-2">
              Categories <b>your family</b> created stay here — Kaya keeps the ones you use up front.
            </p>
          )}
          {showNewCat && (
            <div className="mt-3 rounded-hive border border-hive-line bg-hive-cream p-3 space-y-2">
              <div className="flex flex-wrap gap-1">
                {NEW_CAT_EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => setNewCatEmoji(e)}
                    className={`w-8 h-8 rounded-[10px] text-base flex items-center justify-center border transition-colors ${
                      newCatEmoji === e ? 'bg-hive-honey-soft border-hive-honey' : 'bg-hive-paper border-hive-line'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  placeholder="e.g. School Snacks"
                  maxLength={24}
                  className="flex-1 h-10 px-3 bg-hive-paper rounded-[10px] text-sm border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                  autoFocus
                />
                <button
                  onClick={addCustomCategory}
                  disabled={savingCat || !newCatLabel.trim()}
                  className="h-10 px-4 rounded-[10px] bg-hive-honey text-white font-nunito font-extrabold text-[12px] disabled:opacity-40"
                >
                  {savingCat ? 'Saving…' : 'Add'}
                </button>
              </div>
            </div>
          )}
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
              ? `Deposit ${formatCash(destCents, defaultCurrency)} to ${kidIds.length} kids → ${dest === 'treasury' ? 'Honey Pot 🍯' : '💵 Cash'}`
              : `Deposit ${destCents > 0 ? formatCash(destCents, defaultCurrency) : ''} → ${dest === 'treasury' ? 'Honey Pot 🍯' : '💵 Cash'}`}
        </button>
      </div>
    </div>
  );
}
