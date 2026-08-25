'use client';

// Kaya Business 2.0 · 📝 Business Review (R18–R21).
//
// The kid's cadence-based self-evaluation (weekly / every 2 weeks / monthly).
// The period's numbers arrive PRE-FILLED from the ledger — the kid CONFIRMS
// rather than re-counts (flaw F7: never quiz the kid on numbers the books
// already know; a mismatch is the teaching moment). Then two reflections
// ("What went well?" · "One thing to try?") and Kaya closes with one
// specific, kind piece of advice computed from the real numbers (R20).
//
// Completing a review earns HP on the same parent-review rail as stock-takes
// (R21) and the review lands in a history the parent console can read.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, LedgerEntry, BusinessReview,
  subscribeToBusiness, subscribeToLedger, subscribeToBusinessReviews,
  readBusinessConfig, resolvePricingModel, pricingModelMeta,
  reviewCadenceDays, reviewDue, todayKey,
  saveBusinessReview, requestReviewHp,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';
import { Page, BTN_INLINE_LG } from '@/components/layout/Page';

export default function BusinessReviewPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const celebrate = useCelebrate();
  const familyId = profile?.familyId;
  const currency = config.currency;
  const coachName = readBusinessConfig(family).coachName;

  const [business, setBusiness] = useState<Business | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [reviews, setReviews] = useState<BusinessReview[]>([]);
  const [wentWell, setWentWell] = useState('');
  const [tryNext, setTryNext] = useState('');
  const [advice, setAdvice] = useState('');
  const [adviceBusy, setAdviceBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToLedger(familyId, businessId, setLedger, 200);
    const u3 = subscribeToBusinessReviews(familyId, businessId, setReviews, 12);
    return () => { u1(); u2(); u3(); };
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const model = business ? resolvePricingModel(business) : 'unit_stocked';
  const modelMeta = pricingModelMeta(model);
  const cadence = business?.reviewCadence || 'weekly';
  const periodDays = reviewCadenceDays(cadence);
  const today = todayKey();
  const lastReview = reviews[0] || null;
  const due = reviewDue(lastReview?.date ?? null, cadence, today);
  const doneToday = lastReview?.date === today;

  // Pre-fill from the books (F7) — paid sales + costs in the window.
  const period = useMemo(() => {
    const cutoff = Date.now() - periodDays * 86_400_000;
    let units = 0, revenue = 0, costs = 0, salesCount = 0;
    const customers = new Set<string>();
    const perProduct: Record<string, { units: number; revenue: number }> = {};
    for (const e of ledger) {
      if (e.voided) continue;
      const ms = (e.occurredAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? 0;
      if (ms < cutoff) continue;
      if (e.kind === 'sale' && e.paymentStatus === 'paid') {
        salesCount += 1;
        units += e.qty || 0;
        revenue += e.amountCents;
        const who = (e.customerRef || e.customerLabel || '').trim();
        if (who) customers.add(who.toLowerCase());
        const p = (e.productName || '').trim();
        if (p) {
          perProduct[p] = perProduct[p] || { units: 0, revenue: 0 };
          perProduct[p].units += e.qty || 0;
          perProduct[p].revenue += e.amountCents;
        }
      } else if (e.kind === 'cost') {
        costs += e.amountCents;
      }
    }
    const best = Object.entries(perProduct).sort((a, b) => b[1].revenue - a[1].revenue)[0]?.[0];
    return { units, revenue, costs, profit: revenue - costs, salesCount, customers: customers.size, best };
  }, [ledger, periodDays]);

  const unitWord = model === 'hour' ? 'hours worked' : model === 'session' ? 'sessions held' : model === 'job' ? 'jobs done' : `${modelMeta.unitLabel === 'pcs' ? 'units' : modelMeta.unitLabel + 's'} sold`;

  const getAdvice = async () => {
    if (adviceBusy || !business) return;
    setAdviceBusy(true);
    try {
      const r = await fetch('/api/business-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loop: 'review', coachName, currency,
          facts: {
            business: business.name,
            period: `last ${periodDays} days`,
            [unitWord]: period.units,
            customersServed: period.customers,
            sales: period.salesCount,
            moneyIn: formatCash(period.revenue, currency),
            costs: formatCash(period.costs, currency),
            profit: formatCash(period.profit, currency),
            ...(period.best ? { bestProduct: period.best } : {}),
            ...(wentWell.trim() ? { kidSaysWentWell: wentWell.trim() } : {}),
            ...(tryNext.trim() ? { kidWantsToTry: tryNext.trim() } : {}),
          },
        }),
      });
      const j = await r.json();
      if (j?.message) setAdvice(String(j.message));
      else if (j?.skipped) setAdvice('');
    } catch { /* advice is a bonus — never blocks the review */ }
    finally { setAdviceBusy(false); }
  };

  const save = async () => {
    if (!familyId || !business || !profile?.uid || saving) return;
    setSaving(true); setError('');
    try {
      // Fetch advice at save time if the kid didn't ask for it yet.
      let finalAdvice = advice;
      if (!finalAdvice && !adviceBusy) {
        try {
          const r = await fetch('/api/business-coach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              loop: 'review', coachName, currency,
              facts: {
                business: business.name, period: `last ${periodDays} days`,
                [unitWord]: period.units, customersServed: period.customers,
                moneyIn: formatCash(period.revenue, currency), profit: formatCash(period.profit, currency),
                ...(wentWell.trim() ? { kidSaysWentWell: wentWell.trim() } : {}),
                ...(tryNext.trim() ? { kidWantsToTry: tryNext.trim() } : {}),
              },
            }),
          });
          const j = await r.json();
          if (j?.message) { finalAdvice = String(j.message); setAdvice(finalAdvice); }
        } catch { /* fine without */ }
      }
      const reviewId = await saveBusinessReview(familyId, businessId, {
        date: today,
        ownerId: business.ownerId,
        periodDays,
        cadence,
        unitsSold: period.units,
        customersServed: period.customers,
        salesCount: period.salesCount,
        revenueCents: period.revenue,
        profitCents: period.profit,
        wentWell: wentWell.trim() || undefined,
        tryNext: tryNext.trim() || undefined,
        aiAdvice: finalAdvice || undefined,
      }, profile.uid);

      // R21 — completing a review earns HP (parent-review rail, D2 parity).
      const hp = readBusinessConfig(family).hpAward;
      const already = lastReview?.id === reviewId && (lastReview?.hpRequested || lastReview?.hpGranted);
      if (hp.perDayHp > 0 && !already && !doneToday) {
        try {
          await requestReviewHp(familyId, business, hp.perDayHp, reviewId, profile.uid);
        } catch { /* best-effort */ }
      }
      celebrate({ kind: 'milestone', title: 'Review done! 📝', subtitle: 'You looked at your real numbers like a boss.' });
      router.push(`/business/${businessId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save the review.');
      setSaving(false);
    }
  };

  if (!business) {
    return <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center text-hive-muted text-sm">Loading…</div>;
  }

  const row = 'flex items-center justify-between py-2 border-b border-dashed border-hive-line last:border-0 text-[13px]';
  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-4';

  return (
    <Page width="narrow">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">📝</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Business Review</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business.name} · last {periodDays} days</div>
        </div>
        <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Dashboard →</Link>
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can run the review.</p>
      ) : (
        <>
          {!due && lastReview && !doneToday && (
            <div className="bg-[#E2F0E2] border border-[#2F7D32]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#2F7D32] font-nunito font-bold">
              ✓ Reviewed on {lastReview.date} — next one comes {cadence === 'weekly' ? 'next week' : cadence === 'biweekly' ? 'in two weeks' : 'next month'}. You can still run one early.
            </div>
          )}
          {doneToday && (
            <div className="bg-[#E2F0E2] border border-[#2F7D32]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#2F7D32] font-nunito font-bold">
              ✓ Today&apos;s review is saved — saving again updates it.
            </div>
          )}

          {/* The books' numbers — the kid confirms, never re-counts (F7). */}
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-nunito font-extrabold text-[14px]">Your books say…</h3>
              <span className={`text-[11px] font-nunito font-black px-2 py-0.5 rounded-hive-pill ${period.profit >= 0 ? 'bg-[#E2F0E2] text-[#2F7D32]' : 'bg-[#FCEAD6] text-[#B25E16]'}`}>
                {period.profit >= 0 ? 'In the black' : 'In the red'}
              </span>
            </div>
            <div className={row}><span className="capitalize">{unitWord}</span><span className="font-nunito font-extrabold">{period.units}</span></div>
            <div className={row}><span>Customers served</span><span className="font-nunito font-extrabold">{period.customers}</span></div>
            <div className={row}><span>Money in</span><span className="font-nunito font-extrabold text-[#2F7D32]">+{formatCash(period.revenue, currency)}</span></div>
            <div className={row}><span>Costs</span><span className="font-nunito font-extrabold text-hive-rose">−{formatCash(period.costs, currency)}</span></div>
            <div className={row}><span>Profit</span><span className="font-nunito font-extrabold">{formatCash(period.profit, currency)}</span></div>
            {period.best && <div className={row}><span>Best product</span><span className="font-nunito font-extrabold">{period.best}</span></div>}
            <p className="text-[11px] text-hive-muted mt-2 leading-snug">
              Remember more sales than this? Then some didn&apos;t make it into the books — log every sale so your review tells the true story. 📒
            </p>
          </div>

          {/* Reflections (R19) */}
          <div className={label}>🌟 What went well?</div>
          <textarea value={wentWell} onChange={(e) => setWentWell(e.target.value)} maxLength={300} rows={2}
            placeholder="e.g. Auntie bought twice — she loves the mango one!"
            className="w-full px-3 py-2.5 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />

          <div className={label}>🌱 One thing to try next time?</div>
          <textarea value={tryNext} onChange={(e) => setTryNext(e.target.value)} maxLength={300} rows={2}
            placeholder="e.g. Sell at the football game on Saturday"
            className="w-full px-3 py-2.5 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />

          {/* Kaya's advice (R20) */}
          <div className="mt-4">
            {advice ? (
              <div className="rounded-[16px_16px_16px_4px] bg-hive-navy text-hive-cream p-3.5">
                <div className="text-[10px] font-nunito font-black uppercase tracking-wider text-hive-honey mb-1">🤖 {coachName} · from your real numbers</div>
                <p className="text-[13px] leading-relaxed">{advice}</p>
              </div>
            ) : (
              <button type="button" onClick={getAdvice} disabled={adviceBusy}
                className="w-full h-11 rounded-hive bg-hive-cream border border-hive-honey/60 text-hive-navy font-nunito font-extrabold text-[13px] disabled:opacity-40 hover:brightness-95 transition">
                {adviceBusy ? 'Reading your books… ✨' : `✨ Ask ${coachName} for one tip`}
              </button>
            )}
          </div>

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

          <div className="lg:flex lg:justify-end">
            <button type="button" onClick={save} disabled={saving}
              className={`w-full mt-4 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition ${BTN_INLINE_LG}`}>
              {saving ? 'Saving…' : 'Finish my review 📝'}
            </button>
          </div>
          <p className="text-[11px] text-hive-muted text-center mt-2">
            Saves to your review history — and earns the usual House Points once a parent OKs it.
          </p>

          {/* Past reviews */}
          {reviews.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-5 mb-8">
              <h3 className="font-nunito font-extrabold text-[13px] mb-1">📚 Past reviews</h3>
              {reviews.map((r) => (
                <div key={r.id} className="py-2 border-b border-dashed border-hive-line last:border-0">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-nunito font-extrabold">{r.date}</span>
                    <span className={`font-nunito font-extrabold ${r.profitCents >= 0 ? 'text-[#2F7D32]' : 'text-hive-rose'}`}>{formatCash(r.profitCents, currency)} profit</span>
                  </div>
                  <div className="text-[11px] text-hive-muted">{r.unitsSold} {model === 'hour' ? 'hrs' : 'sold'} · {r.customersServed} customers{r.tryNext ? ` · tried: “${r.tryNext.slice(0, 40)}${r.tryNext.length > 40 ? '…' : ''}”` : ''}</div>
                  {r.parentNote && <div className="text-[11.5px] text-hive-navy/80 mt-0.5">💬 Parent: “{r.parentNote}”</div>}
                </div>
              ))}
            </div>
          )}

          <p className="text-center mb-8">
            <Link href={`/business/${businessId}/weekly`} className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
              Just the numbers? Weekly recap →
            </Link>
          </p>
        </>
      )}
    </Page>
  );
}
