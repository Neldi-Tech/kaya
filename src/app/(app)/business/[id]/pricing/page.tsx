'use client';

// Kaya Business 2.0 · 💰 Pricing Studio (R7–R13 + Price Lab).
//
// The kid BUILDS each price from cost + profit, so the concept sticks:
//   Step 1 · "What goes into ONE glass?" — ingredient/cost lines (Kaya AI
//            suggests starters from the product name; the kid edits).
//   Step 2 · "How much do you want to KEEP?" — profit as an amount OR a %
//            ("on top" of cost), live-mirrored both ways.
//   Step 3 · Price = cost + profit, rounded to a friendly number for the
//            family currency; the shown profit re-derives from the final
//            price and Kaya narrates what rounding gave or took.
//   Price Lab · a what-if slider — drag the price, watch profit-per-unit and
//            "if you sell 10 / 20" move, with warm zone commentary.
//
// Below-cost prices are blocked with an explanation (never silently fixed).
// A kid's price outside the parent's priceBand routes to the existing
// business_price_change approval. Every save stores the cost basis + recipe
// on the item (R11) so the coach can reason in real margins.
//
// This page is also the MENU MANAGER for no-stock businesses — add/remove
// menu entries here (Inventory stays the stock manager for stocked ones).

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, BusinessItem, CostRecipeLine,
  subscribeToBusiness, subscribeToBusinessItems, readBusinessConfig,
  resolvePricingModel, pricingModelMeta, keepsStock,
  roundPriceCents, priceRoundingStepCents,
  updateBusinessItem, addBusinessItem, updateBusiness, requestPriceChange,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';
import { Page, BTN_INLINE_LG } from '@/components/layout/Page';

// ── The concept glossary (R12) — cost / price / profit in kid words ──
const GLOSSARY: Array<{ key: string; emoji: string; word: string; meaning: string; example: string }> = [
  { key: 'cost',      emoji: '💸', word: 'Cost',       meaning: 'What YOU spend to make ONE.', example: 'One glass of juice: 3 oranges (600) + sugar (100) + cup (150) = cost 850.' },
  { key: 'price',     emoji: '🏷️', word: 'Price',      meaning: 'What your CUSTOMER pays for one.', example: 'You charge 1,300 for the glass — that is the price.' },
  { key: 'profit',    emoji: '💰', word: 'Profit',     meaning: 'What you KEEP: Price − Cost.', example: '1,300 − 850 = 450 stays with you on every glass.' },
  { key: 'margin',    emoji: '📊', word: 'Margin',     meaning: 'Profit as a share of the price.', example: '450 out of 1,300 ≈ 35% — of every 100 the customer pays, you keep 35.' },
  { key: 'breakeven', emoji: '🏁', word: 'Break-even', meaning: 'Selling enough to win back what you spent.', example: 'A 14,000 blender ÷ 450 profit per glass → about 32 glasses to pay it back.' },
];

interface LineRow { id: string; name: string; cost: string }
const rid = () => Math.random().toString(36).slice(2, 9);
const newLine = (): LineRow => ({ id: rid(), name: '', cost: '' });

const parseCents = (s: string): number => {
  const n = parseFloat((s || '').replace(/,/g, ''));
  return Number.isNaN(n) || n <= 0 ? 0 : Math.round(n * 100);
};

export default function PricingStudioPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const celebrate = useCelebrate();
  const familyId = profile?.familyId;
  const bizConfig = useMemo(() => readBusinessConfig(family), [family]);
  const currency = config.currency;
  const coachName = bizConfig.coachName;
  const rounding = bizConfig.priceRounding ?? 'auto';

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [glossaryKey, setGlossaryKey] = useState<string | null>(null);

  // Studio state (for the selected item)
  const [lines, setLines] = useState<LineRow[]>([newLine()]);
  const [profitMode, setProfitMode] = useState<'amount' | 'pct'>('amount');
  const [profitStr, setProfitStr] = useState('');
  const [manualPrice, setManualPrice] = useState(''); // '' = follow cost + profit
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiOff, setAiOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askSent, setAskSent] = useState(false);
  const [error, setError] = useState('');
  // Add-to-menu inline form
  const [newName, setNewName] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToBusinessItems(familyId, businessId, setItems);
    return () => { u1(); u2(); };
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const model = business ? resolvePricingModel(business) : 'unit_stocked';
  const modelMeta = pricingModelMeta(model);
  const stocked = business ? keepsStock(business) : true;

  // Priceable products: menu + stock, not archived / written off.
  const priceable = useMemo(
    () => items
      .filter((it) => (it.kind === 'menu' || it.kind === 'stock') && !it.archived && !it.loss)
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'menu' ? -1 : 1)),
    [items],
  );
  const selected = priceable.find((it) => it.id === selectedId) || null;

  // Seed the Studio from the selected item.
  useEffect(() => {
    if (!selected) return;
    const rec = (selected.costRecipe || []).map((l) => ({ id: rid(), name: l.name, cost: l.costCents > 0 ? String(l.costCents / 100) : '' }));
    setLines(rec.length ? rec : [newLine()]);
    const cost = selected.unitCostCents || 0;
    const price = selected.unitMarketCents || 0;
    if (price > 0 && cost > 0 && price > cost) { setProfitMode('amount'); setProfitStr(String((price - cost) / 100)); }
    else setProfitStr('');
    setManualPrice('');
    setAiMsg(''); setError(''); setSaved(false); setAskSent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── The math (R7–R9) ──
  const costCents = lines.reduce((s, l) => s + parseCents(l.cost), 0);
  const profitInput = parseFloat((profitStr || '').replace(/,/g, ''));
  const profitOk = !Number.isNaN(profitInput) && profitInput > 0;
  const chosenProfitCents = !profitOk ? 0
    : profitMode === 'amount' ? Math.round(profitInput * 100)
    : Math.round((costCents * profitInput) / 100);
  const rawPriceCents = costCents + chosenProfitCents;
  const autoPriceCents = rawPriceCents > 0 ? roundPriceCents(rawPriceCents, rounding) : 0;
  const manualCents = parseCents(manualPrice);
  const priceCents = manualCents > 0 ? manualCents : autoPriceCents;
  const realProfitCents = priceCents - costCents;
  const marginPct = priceCents > 0 ? Math.round((realProfitCents / priceCents) * 100) : 0;
  const markupPct = costCents > 0 ? Math.round((chosenProfitCents / costCents) * 100) : 0;
  const roundingDiff = manualCents > 0 ? 0 : autoPriceCents - rawPriceCents;
  const belowCost = priceCents > 0 && costCents > 0 && priceCents < costCents; // R10

  // priceBand (R13): a kid's price outside the band needs a parent OK.
  const band = business?.priceBand;
  const outsideBand = !!band && priceCents > 0 && (priceCents < band.minCents || priceCents > band.maxCents);
  const needsParentOk = outsideBand && !isParent;

  const canSave = !!selected && priceCents > 0 && !belowCost && !needsParentOk && !saving;

  // ── Price Lab slider range ──
  const labMax = Math.max(costCents * 3, autoPriceCents * 2, priceCents * 2, 2000);
  const labStep = Math.max(1, priceRoundingStepCents(labMax));
  const labZone = costCents <= 0 ? null
    : priceCents < costCents ? { emoji: '❌', label: 'Losing money', tone: 'text-hive-rose' }
    : realProfitCents / costCents < 0.15 ? { emoji: '😟', label: 'Very thin', tone: 'text-[#B25E16]' }
    : realProfitCents / costCents <= 0.6 ? { emoji: '😊', label: 'Sweet spot', tone: 'text-[#2F7D32]' }
    : realProfitCents / costCents <= 1.2 ? { emoji: '🙂', label: 'Bold', tone: 'text-[#B25E16]' }
    : { emoji: '🤔', label: 'Getting pricey', tone: 'text-hive-rose' };

  const patchLine = (id: string, patch: Partial<LineRow>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : [newLine()]));

  const askKaya = async () => {
    if (!selected || aiBusy) return;
    setAiBusy(true); setError('');
    try {
      const r = await fetch('/api/business-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'cost_recipe', product: selected.name, unit: selected.unitLabel || modelMeta.unitLabel,
          name: business?.name || '', pricingModel: model, currency, coachName,
        }),
      });
      const j = await r.json();
      if (j?.skipped) { setAiOff(true); return; }
      if (!r.ok || j?.error) { setError(j?.error || 'Kaya could not help just now.'); return; }
      const got: Array<{ name: string; costCents: number }> = Array.isArray(j.lines) ? j.lines : [];
      if (got.length) {
        setLines(got.map((l) => ({ id: rid(), name: l.name, cost: l.costCents > 0 ? String(l.costCents / 100) : '' })));
      }
      setAiMsg((j.message || '').toString());
    } catch { setError('Kaya could not help just now.'); }
    finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!familyId || !selected || !canSave) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const recipe: CostRecipeLine[] = lines
        .filter((l) => l.name.trim())
        .map((l) => ({ name: l.name.trim(), costCents: parseCents(l.cost) }));
      await updateBusinessItem(familyId, businessId, selected.id, {
        unitMarketCents: priceCents,
        unitCostCents: costCents,
        costRecipe: recipe,
      });
      // Single-product businesses keep the headline price in sync.
      if (priceable.length === 1) {
        await updateBusiness(familyId, businessId, { unitPriceCents: priceCents, unitLabel: selected.unitLabel || modelMeta.unitLabel });
      }
      setSaved(true);
      celebrate({
        kind: 'milestone',
        title: 'Price set! 💰',
        subtitle: `Each ${selected.unitLabel || 'one'} you keep ${formatCash(Math.max(0, realProfitCents), currency)}`,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save the price.');
    } finally { setSaving(false); }
  };

  const askParent = async () => {
    if (!familyId || !business || !selected || !profile?.uid || asking) return;
    setAsking(true); setError('');
    try {
      await requestPriceChange(familyId, business, { id: selected.id, name: selected.name }, priceCents, profile.uid);
      setAskSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send the request.');
    } finally { setAsking(false); }
  };

  const addMenuItem = async () => {
    if (!familyId || !profile?.uid || !newName.trim() || addBusy) return;
    setAddBusy(true);
    try {
      const id = await addBusinessItem(familyId, businessId, {
        kind: stocked ? 'stock' : 'menu',
        name: newName.trim(),
        qty: 0,
        unitLabel: modelMeta.unitLabel,
        countedInWorth: stocked,
      }, profile.uid);
      setNewName('');
      setSelectedId(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not add it.');
    } finally { setAddBusy(false); }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-4';
  const field = 'h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40';
  const g = GLOSSARY.find((x) => x.key === glossaryKey) || null;

  if (!business) {
    return <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center text-hive-muted text-sm">Loading…</div>;
  }

  return (
    <Page width="narrow">
      {/* Header */}
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">💰</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Pricing Studio</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business.name} · {modelMeta.emoji} {modelMeta.label}</div>
        </div>
        <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Dashboard →</Link>
      </div>

      {/* The 3-line concept frame (R12) — each word tap-opens its meaning. */}
      <div className="bg-hive-cream border border-hive-honey/60 rounded-hive p-3.5 text-[12.5px] leading-relaxed text-hive-navy">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {GLOSSARY.map((x) => (
            <button key={x.key} type="button" onClick={() => setGlossaryKey(x.key)}
              className="px-2.5 py-1 rounded-hive-pill bg-hive-paper border border-hive-line text-[11.5px] font-nunito font-extrabold text-hive-navy hover:border-hive-honey transition">
              {x.emoji} {x.word}
            </button>
          ))}
        </div>
        💸 <b>Cost</b> — what you spend to make ONE. · 🏷️ <b>Price</b> — what your customer pays. · 💰 <b>Profit</b> — what you keep: <b>Price − Cost</b>.
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can set prices.</p>
      ) : (
        <>
          {/* Product picker */}
          <div className={label}>{stocked ? 'Pick a product to price' : model === 'unit_made' ? 'Your menu' : 'What you offer'}</div>
          {priceable.length === 0 && (
            <p className="text-[12.5px] text-hive-muted mb-2">Nothing here yet — add {model === 'unit_made' ? 'your first menu item' : 'what you sell'} below.</p>
          )}
          <div className="space-y-2">
            {priceable.map((it) => {
              const active = it.id === selectedId;
              const hasBoth = (it.unitMarketCents || 0) > 0 && (it.unitCostCents || 0) > 0;
              const m = hasBoth ? Math.round((((it.unitMarketCents || 0) - (it.unitCostCents || 0)) / (it.unitMarketCents || 1)) * 100) : null;
              return (
                <button key={it.id} type="button" onClick={() => setSelectedId(active ? null : it.id)}
                  className={`w-full rounded-hive p-3 text-left border-2 flex items-center gap-3 transition ${
                    active ? 'border-hive-navy bg-hive-navy text-hive-honey' : 'border-hive-line bg-hive-paper text-hive-navy'
                  } hover:border-hive-honey active:scale-[0.99]`}>
                  {it.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.photoUrl} alt="" className="w-10 h-10 rounded-[10px] object-cover shrink-0" />
                  ) : (
                    <span className="w-10 h-10 rounded-[10px] bg-hive-cream flex items-center justify-center text-[18px] shrink-0">{it.kind === 'menu' ? '🧾' : '📦'}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-nunito font-extrabold truncate">{it.name}</div>
                    <div className={`text-[11px] ${active ? 'text-hive-honey-soft/80' : 'text-hive-muted'}`}>
                      {(it.unitMarketCents || 0) > 0
                        ? <>{formatCash(it.unitMarketCents || 0, currency)} / {it.unitLabel || 'unit'}{m !== null ? ` · keeps ${m}%` : ' · no cost set yet'}</>
                        : 'No price yet — tap to build one'}
                    </div>
                  </div>
                  <span className={`text-[12px] font-nunito font-black shrink-0 ${active ? 'text-hive-honey' : 'text-hive-honey-dk'}`}>{active ? '▲' : 'Price it →'}</span>
                </button>
              );
            })}
          </div>

          {/* Add product / menu item */}
          <div className="flex gap-2 mt-2.5">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={50}
              placeholder={model === 'unit_made' ? 'Add to menu — e.g. Orange juice' : stocked ? 'Add a product' : 'Add an offering — e.g. Homework help'}
              className={`${field} flex-1 min-w-0`} />
            <button type="button" onClick={addMenuItem} disabled={addBusy || !newName.trim()}
              className="h-11 px-4 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition shrink-0">
              {addBusy ? '…' : '＋ Add'}
            </button>
          </div>

          {/* ── The Studio for the selected product ── */}
          {selected && (
            <div className="mt-4 space-y-4">
              {/* Step 1 · Cost */}
              <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="font-nunito font-extrabold text-[14px]">1 · What goes into ONE {selected.unitLabel || modelMeta.unitLabel}? 💸</h3>
                  {!aiOff && (
                    <button type="button" onClick={askKaya} disabled={aiBusy}
                      className="h-9 px-3 rounded-hive bg-hive-cream border border-hive-honey/60 text-hive-navy font-nunito font-extrabold text-[12px] disabled:opacity-40 hover:brightness-95 transition shrink-0">
                      {aiBusy ? 'Thinking… ✨' : '✨ Ask Kaya'}
                    </button>
                  )}
                </div>
                <p className="text-[11.5px] text-hive-muted mb-2.5">
                  {model === 'hour' || model === 'session' || model === 'job'
                    ? 'Your time is the main thing you give — add material lines only if you use them (paper, soap…).'
                    : `List what one ${selected.unitLabel || 'unit'} takes to make. Kaya can suggest starters — you fix the real numbers.`}
                </p>
                {aiMsg && (
                  <div className="rounded-[14px_14px_14px_4px] bg-hive-navy text-hive-cream p-3 mb-2.5 text-[12px] leading-relaxed">
                    <span className="text-hive-honey font-nunito font-black text-[10px] uppercase tracking-wider mr-1.5">🤖 {coachName}</span>
                    {aiMsg}
                  </div>
                )}
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.id} className="flex gap-2 items-center">
                      <input value={l.name} onChange={(e) => patchLine(l.id, { name: e.target.value })} maxLength={60}
                        placeholder="e.g. 3 oranges" className={`${field} flex-1 min-w-0 bg-white`} />
                      <div className="relative w-32 shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-hive-muted font-nunito font-bold pointer-events-none">{currency}</span>
                        <input value={l.cost} onChange={(e) => patchLine(l.id, { cost: e.target.value })} inputMode="decimal" placeholder="0"
                          className={`${field} w-full pl-11 pr-2 text-right bg-white`} />
                      </div>
                      <button type="button" onClick={() => removeLine(l.id)} title="Remove line"
                        className="w-7 h-7 rounded-hive-pill bg-hive-cream text-hive-muted text-[12px] shrink-0 hover:brightness-95">✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])}
                  className="mt-2 h-9 px-3 rounded-hive bg-hive-cream text-hive-navy font-nunito font-extrabold text-[12px] hover:brightness-95 transition">
                  ＋ Add a line
                </button>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-dashed border-hive-line">
                  <span className="text-[13px] font-nunito font-extrabold">💸 Cost per {selected.unitLabel || 'one'}</span>
                  <span className="font-nunito font-black text-[16px]">{formatCash(costCents, currency)}</span>
                </div>
              </div>

              {/* Step 2 · Profit (amount ⇄ %) */}
              <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
                <h3 className="font-nunito font-extrabold text-[14px] mb-1">2 · How much do you want to KEEP? 💰</h3>
                <p className="text-[11.5px] text-hive-muted mb-2.5">
                  {costCents > 0 ? 'Your profit on every one you sell — as money or as a % on top of cost. Both mean the same thing.' : `What is one ${selected.unitLabel || 'unit'} of your work worth? With no costs, the whole price is yours to keep.`}
                </p>
                <div className="flex gap-2 items-center">
                  {costCents > 0 && (
                    <div className="flex gap-1 bg-hive-cream border border-hive-line rounded-hive-pill p-1 shrink-0">
                      {(['amount', 'pct'] as const).map((m2) => (
                        <button key={m2} type="button" onClick={() => { setProfitMode(m2); setProfitStr(''); setManualPrice(''); }}
                          className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold transition ${profitMode === m2 ? 'bg-hive-navy text-hive-honey' : 'text-hive-muted'}`}>
                          {m2 === 'amount' ? currency : '%'}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="relative flex-1">
                    {profitMode === 'amount' && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-hive-muted font-nunito font-bold pointer-events-none">{currency}</span>
                    )}
                    <input value={profitStr} onChange={(e) => { setProfitStr(e.target.value); setManualPrice(''); setSaved(false); }} inputMode="decimal"
                      placeholder={profitMode === 'amount' ? '0' : 'e.g. 50'}
                      className={`${field} w-full ${profitMode === 'amount' ? 'pl-12' : 'pl-3'} pr-3 text-right bg-white`} />
                    {profitMode === 'pct' && (
                      <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] text-hive-muted font-nunito font-bold pointer-events-none" />
                    )}
                  </div>
                </div>
                {profitOk && costCents > 0 && (
                  <p className="text-[12px] text-hive-navy/80 font-nunito font-bold mt-2">
                    {profitMode === 'amount'
                      ? <>= <b>{markupPct}%</b> on top of your cost</>
                      : <>= <b>{formatCash(chosenProfitCents, currency)}</b> on every {selected.unitLabel || 'one'}</>}
                  </p>
                )}
              </div>

              {/* Step 3 · Friendly price + narration (R9) */}
              <div className="rounded-hive p-4 bg-hive-navy text-hive-cream">
                <h3 className="font-nunito font-extrabold text-[14px] mb-2 text-hive-honey-soft">3 · Your price 🏷️</h3>
                <div className="flex items-center justify-between py-1.5 text-[13px]">
                  <span className="text-hive-cream/80">💸 Cost</span><span className="font-nunito font-extrabold">{formatCash(costCents, currency)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 text-[13px] border-b border-white/15">
                  <span className="text-hive-cream/80">💰 Profit you chose</span><span className="font-nunito font-extrabold">{formatCash(chosenProfitCents, currency)}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="font-nunito font-black text-[15px] text-hive-honey-soft">🏷️ Friendly price</span>
                  <span className="font-nunito font-black text-[24px] text-hive-honey">{formatCash(priceCents, currency)}</span>
                </div>
                {roundingDiff !== 0 && manualCents === 0 && (
                  <p className="text-[11.5px] text-hive-honey-soft/90 italic">
                    {roundingDiff > 0
                      ? <>Rounding up gave you <b>{formatCash(roundingDiff, currency)} EXTRA</b> profit on every one — nice!</>
                      : <>Rounding down costs you {formatCash(-roundingDiff, currency)} each — friendlier to pay, easier to sell.</>}
                  </p>
                )}
                {priceCents > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/15 text-[12.5px]">
                    ✨ So each {selected.unitLabel || 'one'} you really keep{' '}
                    <b className="text-hive-honey">{formatCash(realProfitCents, currency)}</b>
                    {priceCents > 0 && costCents > 0 ? <> ({marginPct}% of the price)</> : null}
                  </div>
                )}

                {/* Or type your own */}
                <div className="mt-3">
                  <div className="text-[10.5px] font-nunito font-extrabold uppercase tracking-wider text-hive-cream/60 mb-1">…or type your own price</div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-hive-cream/60 font-nunito font-bold pointer-events-none">{currency}</span>
                    <input value={manualPrice} onChange={(e) => { setManualPrice(e.target.value); setSaved(false); }} inputMode="decimal" placeholder={autoPriceCents > 0 ? String(autoPriceCents / 100) : '0'}
                      className="w-full h-11 pl-12 pr-3 text-right bg-white/10 rounded-hive border border-white/20 text-[14px] text-hive-cream focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
                  </div>
                </div>

                {/* R10 — below cost is blocked with an explanation. */}
                {belowCost && (
                  <div className="mt-3 bg-hive-rose/20 border border-hive-rose/50 rounded-hive p-3 text-[12.5px]">
                    ❌ <b>Hold on — you&apos;d LOSE {formatCash(costCents - priceCents, currency)} on every {selected.unitLabel || 'one'}.</b>{' '}
                    Each one costs you {formatCash(costCents, currency)} to make, but the customer would only pay {formatCash(priceCents, currency)}.
                    Set the price at least at your cost — profit is what keeps a business alive.
                  </div>
                )}
              </div>

              {/* 🎚️ Price Lab (what-if slider) */}
              {priceCents > 0 && (
                <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
                  <h3 className="font-nunito font-extrabold text-[14px] mb-1">🎚️ Price Lab — what if…?</h3>
                  <p className="text-[11.5px] text-hive-muted mb-2">Drag the price and watch your profit move.</p>
                  <input
                    type="range"
                    min={0}
                    max={labMax}
                    step={labStep}
                    value={Math.min(priceCents, labMax)}
                    onChange={(e) => { setManualPrice(String(Number(e.target.value) / 100)); setSaved(false); }}
                    className="w-full accent-[#F39C2F]"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="font-nunito font-black text-[16px]">{formatCash(priceCents, currency)}</span>
                    {labZone && <span className={`text-[12.5px] font-nunito font-black ${labZone.tone}`}>{labZone.emoji} {labZone.label}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2.5">
                    {[10, 20].map((n) => (
                      <div key={n} className="bg-hive-cream rounded-hive p-2.5 text-center">
                        <div className="text-[10.5px] font-nunito font-extrabold uppercase tracking-wide text-hive-muted">Sell {n}, keep</div>
                        <div className={`font-nunito font-black text-[15px] ${realProfitCents >= 0 ? 'text-[#2F7D32]' : 'text-hive-rose'}`}>
                          {formatCash(realProfitCents * n, currency)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* priceBand (R13) */}
              {outsideBand && band && (
                <div className="bg-[#FCEAD6] border border-[#B25E16]/30 rounded-hive p-3 text-[12.5px] text-[#7a4410]">
                  🔒 This price is outside the band a parent set ({formatCash(band.minCents, currency)} – {formatCash(band.maxCents, currency)}).
                  {needsParentOk
                    ? askSent
                      ? <b> Request sent — waiting for a parent. ⏳</b>
                      : <> Ask a parent to approve it:
                          <button type="button" onClick={askParent} disabled={asking}
                            className="mt-2 w-full h-10 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[12.5px] disabled:opacity-40">
                            {asking ? 'Sending…' : '🙋 Ask a parent to approve this price'}
                          </button>
                        </>
                    : ' As a parent you can save it directly.'}
                </div>
              )}

              {error && <p className="text-hive-rose text-[12px] font-bold">{error}</p>}

              <div className="lg:flex lg:justify-end">
                <button type="button" onClick={save} disabled={!canSave}
                  className={`w-full h-12 rounded-hive bg-hive-honey text-hive-navy font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-105 active:scale-[0.99] transition ${BTN_INLINE_LG}`}>
                  {saving ? 'Saving…' : saved ? '✓ Price saved' : `Save — charge ${priceCents > 0 ? formatCash(priceCents, currency) : '…'} per ${selected.unitLabel || 'one'}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Glossary sheet (R12) */}
      {g && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setGlossaryKey(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-hive-paper rounded-t-[20px] p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full bg-hive-line mx-auto mb-4" />
            <div className="text-[28px] mb-1">{g.emoji}</div>
            <h3 className="font-nunito font-black text-[18px]">{g.word}</h3>
            <p className="text-[14px] mt-1.5 leading-relaxed">{g.meaning}</p>
            <div className="bg-hive-cream border border-hive-line rounded-hive p-3 mt-3 text-[12.5px] text-hive-navy/85 leading-relaxed">
              🧃 <b>Example:</b> {g.example}
            </div>
            <button type="button" onClick={() => setGlossaryKey(null)}
              className="w-full mt-4 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px]">Got it</button>
          </div>
        </div>
      )}
    </Page>
  );
}
