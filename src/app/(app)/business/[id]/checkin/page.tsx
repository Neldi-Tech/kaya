'use client';

// Kaya Business 2.0 · ☀️ Daily Check-in (R14).
//
// The no-stock business's daily touchpoint — the 1:1 replacement for the
// stock-take, so nobody loses the daily House-Points loop by going
// stock-free (flaw F2 in the approved Logic Test): same stockTakes record
// (flagged isCheckin), same streak, same HP rail (auto or parent-review),
// same reminder cron — only the words change.
//
// "How did today go?" — tap what you sold/worked today (0.5-hour steps for
// hour-priced businesses), add an optional note + photo. Each sold line logs
// a REAL sale through logSale (money sweeps the Honey Pot exactly like the
// sale screen — earning stays frictionless), so the ledger keeps being the
// single source the Business Review pre-fills from. A quiet day still
// counts: saving with zero sales is honest bookkeeping.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, BusinessItem, StockTake, StockMedia,
  subscribeToBusiness, subscribeToBusinessItems, subscribeToStockTakes,
  saveStockTake, todayKey, stockTakeStreak, logSale,
  readBusinessConfig, requestStockTakeHp, flagStockTakeHp,
  resolvePricingModel, pricingModelMeta, keepsStock,
} from '@/lib/business';
import { uploadBusinessPhoto } from '@/lib/businessPhoto';
import { auth } from '@/lib/firebase';
import { formatCash } from '@/components/hive/format';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';
import StockTakeHistory from '@/components/business/StockTakeHistory';
import { Page, PageSplit, BTN_INLINE_LG } from '@/components/layout/Page';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function DailyCheckinPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const familyId = profile?.familyId;
  const currency = config.currency;

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [sold, setSold] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [media, setMedia] = useState<Array<{ id: string; file: File; preview: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const celebrate = useCelebrate();
  const MAX_PHOTOS = 3;

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToBusinessItems(familyId, businessId, setItems);
    const u3 = subscribeToStockTakes(familyId, businessId, setTakes, 30);
    return () => { u1(); u2(); u3(); };
  }, [familyId, businessId]);

  // Stocked businesses do the real stock-take — bounce old links across.
  useEffect(() => {
    if (business && keepsStock(business)) router.replace(`/business/${businessId}/stocktake`);
  }, [business, businessId, router]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const model = business ? resolvePricingModel(business) : 'unit_made';
  const modelMeta = pricingModelMeta(model);
  const halfSteps = !!modelMeta.halfSteps; // hours log in 0.5 steps (R6)
  const stepSize = halfSteps ? 0.5 : 1;

  const today = todayKey();
  const doneToday = takes.some((t) => t.date === today);
  const streak = useMemo(() => stockTakeStreak(takes), [takes]);
  const weekDates = useMemo(() => {
    const out: string[] = [];
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) { out.push(todayKey(d)); d.setDate(d.getDate() + 1); }
    return out;
  }, [today]);
  const doneSet = useMemo(() => new Set(takes.map((t) => t.date)), [takes]);

  // Sellable lines: the menu (plus any un-archived stock items, for a
  // business that switched nature mid-life).
  const sellable = useMemo(
    () => items
      .filter((it) => (it.kind === 'menu' || it.kind === 'stock') && !it.archived && !it.loss)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [items],
  );
  const priceFor = (it: BusinessItem): number => it.unitMarketCents || business?.unitPriceCents || 0;

  const soldLines = sellable.filter((it) => (sold[it.id] || 0) > 0);
  const totalCents = soldLines.reduce((s, it) => s + Math.round((sold[it.id] || 0) * priceFor(it)), 0);

  const step = (id: string, delta: number) =>
    setSold((p) => ({ ...p, [id]: Math.max(0, Math.round(((p[id] ?? 0) + delta) * 2) / 2) }));

  const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const pickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMedia((prev) => {
      const room = MAX_PHOTOS - prev.length;
      const add = files.slice(0, Math.max(0, room)).map((f) => ({ id: rid(), file: f, preview: URL.createObjectURL(f) }));
      return [...prev, ...add];
    });
    e.target.value = '';
  };

  const save = async () => {
    if (!familyId || !business || !profile?.uid) return;
    setError(''); setSaving(true);
    try {
      // 1 · Book today's sales for real (each line sweeps the Honey Pot).
      for (const it of soldLines) {
        const q = sold[it.id] || 0;
        const price = priceFor(it);
        if (q <= 0 || price <= 0) continue;
        await logSale(familyId, businessId, {
          qty: q,
          halfSteps,
          unitPriceCents: price,
          itemId: it.id,
          productName: it.name,
          paymentMethod: 'hive_transfer',
          description: `${it.name} (check-in)`,
        }, { uid: profile.uid, ownerId: business.ownerId });
      }
      // 2 · Photos (optional for a check-in).
      const uploaded: StockMedia[] = [];
      for (const m of media) {
        try {
          const url = await uploadBusinessPhoto(familyId, businessId, m.file);
          if (url) uploaded.push({ url, kind: 'photo' });
        } catch { /* photos are optional — keep going */ }
      }
      // 3 · The day's record — same collection as stock-takes, so the streak,
      //     reminders and HP all just work (R14).
      await saveStockTake(familyId, businessId, {
        date: today, ownerId: business.ownerId, itemsTouched: soldLines.length,
        note: note.trim() || undefined, media: uploaded, isCheckin: true,
      }, profile.uid);

      // 4 · Instant-cadence House Points — identical to the stock-take path
      //     (D2: check-in HP = stock-take HP, same config, no new settings).
      let earnedHp = 0;
      const hp = readBusinessConfig(family).hpAward;
      const prior = takes.find((t) => t.date === today);
      if (hp.cadence === 'instant' && hp.perDayHp > 0 && !(prior?.hpGranted || prior?.hpRequested)) {
        const bizRef = { id: businessId, ownerId: business.ownerId, name: business.name, emoji: business.emoji };
        const askParent = async () => {
          await requestStockTakeHp(familyId, bizRef, hp.perDayHp, today, profile!.uid, 'checkin');
          await flagStockTakeHp(familyId, businessId, today, { hpRequested: true });
        };
        try {
          if (hp.mode === 'auto') {
            let granted = false;
            try {
              const tok = await auth.currentUser?.getIdToken();
              if (tok) {
                const r = await fetch('/api/business/stocktake-hp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
                  body: JSON.stringify({ businessId, date: today }),
                });
                const j = await r.json();
                granted = !!j?.ok && !j?.skipped;
              }
            } catch { /* fall through */ }
            if (!granted) await askParent();
            else earnedHp = hp.perDayHp;
          } else {
            await askParent();
          }
        } catch { /* best-effort */ }
      }

      celebrate({
        kind: totalCents > 0 ? 'sale' : 'stocktake',
        points: earnedHp || undefined,
        streak: doneToday ? streak : streak + 1,
        ...(totalCents > 0 ? { subtitle: `${formatCash(totalCents, currency)} → your Honey Pot 🍯` } : {}),
      });
      router.push(`/business/${businessId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save the check-in.');
      setSaving(false);
    }
  };

  const rail = (
    <>
      <div className="rounded-hive p-3.5 mb-3 text-hive-cream" style={{ background: 'linear-gradient(135deg, #1F1A12 0%, #3D3320 100%)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-nunito font-extrabold text-hive-honey-soft">Streak</div>
            <div className="font-nunito font-black text-[22px]">{streak} {streak === 1 ? 'day' : 'days'} {streak > 0 ? '🔥' : ''}</div>
          </div>
          <div className="flex gap-1.5">
            {weekDates.map((d, i) => {
              const on = doneSet.has(d);
              return (
                <div key={d} className={`w-7 h-7 rounded-[8px] flex items-center justify-center text-[12px] font-nunito font-extrabold ${on ? 'bg-hive-honey text-hive-navy' : 'bg-white/10 text-hive-cream/50'}`}>
                  {DOW[i]}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <StockTakeHistory takes={takes} today={today} className="mb-3" />
    </>
  );

  return (
    <Page width="content">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">☀️</div>
        <div className="min-w-0">
          <div className="font-nunito font-black text-[16px]">Daily check-in</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">
            {business?.name || 'Loading…'} · {new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      <PageSplit rail={rail} railMobile="first" sticky={false}>
      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can do the check-in.</p>
      ) : (
        <>
          {doneToday && (
            <div className="bg-[#E2F0E2] border border-[#2F7D32]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#2F7D32] font-nunito font-bold">
              ✓ Checked in today — sold more since? Add it below, it adds on top.
            </div>
          )}

          {/* Today's sales */}
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-nunito font-extrabold text-[14px]">How did today go?</h3>
              <span className="text-[11px] text-hive-muted">{halfSteps ? 'tap +/− · half-hours ok' : 'tap +/−'}</span>
            </div>
            {sellable.length === 0 ? (
              <p className="text-[12px] text-hive-muted py-3 text-center">
                Nothing on your {model === 'unit_made' ? 'menu' : 'offer list'} yet —{' '}
                <Link href={`/business/${businessId}/pricing`} className="text-hive-honey-dk font-extrabold hover:underline">add it in the Pricing Studio →</Link>
              </p>
            ) : sellable.map((it) => {
              const q = sold[it.id] || 0;
              const price = priceFor(it);
              return (
                <div key={it.id} className="py-2 border-b border-dashed border-hive-line last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-nunito font-bold truncate">{it.name}</div>
                      <div className="text-[11px] text-hive-muted">
                        {price > 0
                          ? <>{formatCash(price, currency)} / {it.unitLabel || modelMeta.unitLabel}</>
                          : <Link href={`/business/${businessId}/pricing`} className="text-hive-honey-dk font-extrabold hover:underline">no price yet — Pricing Studio →</Link>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => step(it.id, -stepSize)} disabled={price <= 0}
                        className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px] disabled:opacity-30">−</button>
                      <span className={`w-14 h-8 flex items-center justify-center font-nunito font-black rounded-hive border border-hive-line bg-white text-[14px] ${q > 0 ? 'text-hive-honey-dk' : ''}`}>
                        {q}
                      </span>
                      <button onClick={() => step(it.id, stepSize)} disabled={price <= 0}
                        className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px] disabled:opacity-30">＋</button>
                    </div>
                  </div>
                  {q > 0 && price > 0 && (
                    <p className="text-[11px] text-[#2F7D32] font-nunito font-bold mt-1">
                      💵 {q} {it.unitLabel || modelMeta.unitLabel}{q !== 1 ? 's' : ''} → {formatCash(Math.round(q * price), currency)}
                    </p>
                  )}
                </div>
              );
            })}
            {totalCents > 0 && (
              <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-dashed border-hive-line">
                <span className="text-[13px] font-nunito font-extrabold">Today&apos;s sales</span>
                <span className="font-nunito font-black text-[16px] text-[#2F7D32]">{formatCash(totalCents, currency)} → 🍯</span>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">How was it? (optional)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Sold out at the football game! ⚽"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40 mb-3" />

          {/* Optional photos */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Today&apos;s photo (optional)</div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={pickPhotos} className="hidden" />
          <div className="flex flex-wrap gap-2 mb-3">
            {media.map((m) => (
              <div key={m.id} className="relative w-[72px] h-[72px] rounded-hive overflow-hidden border border-hive-line bg-hive-cream">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.preview} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setMedia((prev) => prev.filter((x) => x.id !== m.id))} aria-label="Remove"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-hive-rose text-white text-[11px] flex items-center justify-center border-2 border-white">✕</button>
              </div>
            ))}
            {media.length < MAX_PHOTOS && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-[72px] h-[72px] rounded-hive border-2 border-dashed border-hive-honey bg-[#FFFBEE] text-[#B25E16] text-[22px] font-black flex items-center justify-center">＋</button>
            )}
          </div>

          {error && <p className="text-hive-rose text-[12px] font-bold mb-2">{error}</p>}

          <div className="lg:flex lg:justify-end">
          <button onClick={save} disabled={saving}
            className={`w-full h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition ${BTN_INLINE_LG}`}>
            {saving ? 'Saving…'
              : totalCents > 0 ? `Save check-in — ${formatCash(totalCents, currency)} sold`
              : 'Save check-in (quiet day — still counts!)'}
          </button>
          </div>
          <p className="text-[11px] text-hive-muted text-center mt-2 lg:text-right lg:pb-8">
            Sales go into your books + Honey Pot, and your streak keeps growing — same House Points as a stock-take.
          </p>
        </>
      )}
      </PageSplit>
    </Page>
  );
}
