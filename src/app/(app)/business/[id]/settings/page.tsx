'use client';

// Kaya Business · per-business settings (Phase 2). Today: the daily stock-take
// reminder time. The local hour the parent picks is converted to a UTC hour so
// the hourly reminder cron needs no per-family timezone. (A3 adds the House-
// Points award mode here next.)

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, subscribeToBusiness, setBusinessReminder, updateBusiness, UNIT_SUGGESTIONS,
  setBusinessStockTakeSchedule, DEFAULT_STOCKTAKE_SCHEDULE, type StockTakeSchedule,
  keepsStock, PRICING_MODELS, type PricingModel, resolvePricingModel,
  REVIEW_CADENCES, type ReviewCadence,
  changeBusinessNature, requestBusinessNatureChange, subscribeToBusinessRequests,
} from '@/lib/business';
import type { ApprovalRequest } from '@/lib/hive';
import type { DayOfWeek } from '@/lib/firestore';
import { Page, BTN_INLINE_LG } from '@/components/layout/Page';

function labelForHour(h: number): string {
  const d = new Date(); d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function hourToUtc(h: number): number {
  const d = new Date(); d.setHours(h, 0, 0, 0);
  return d.getUTCHours();
}

export default function BusinessSettingsPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { config } = useHive();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(18); // local hour (default 6pm)
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [init, setInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  // Stock-take Workplan schedule (drives the synthetic kid Workplan row).
  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedDays, setSchedDays] = useState<DayOfWeek[]>(DEFAULT_STOCKTAKE_SCHEDULE.daysOfWeek);
  const [schedTime, setSchedTime] = useState('');
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedSaved, setSchedSaved] = useState(false);
  const [schedError, setSchedError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    return subscribeToBusiness(familyId, businessId, (b) => {
      setBusiness(b);
      if (b && !init) {
        setEnabled(b.reminder?.enabled ?? false);
        // Best-effort: map stored hourUtc back to a local hour for the picker.
        if (b.reminder) {
          const offset = new Date().getTimezoneOffset() / 60; // UTC = local + offset
          setHour(((b.reminder.hourUtc - offset) % 24 + 24) % 24);
        }
        setUnit(b.unitLabel ?? '');
        if (typeof b.unitPriceCents === 'number') setPrice((b.unitPriceCents / 100).toString());
        // Seed schedule from the stored value or the back-compat default.
        const s = b.stockTakeSchedule ?? DEFAULT_STOCKTAKE_SCHEDULE;
        setSchedEnabled(s.enabled !== false);
        setSchedDays(s.daysOfWeek ?? DEFAULT_STOCKTAKE_SCHEDULE.daysOfWeek);
        setSchedTime(s.timeLocal ?? '');
        setInit(true);
      }
    });
  }, [familyId, businessId, init]);

  const savePrice = async () => {
    if (!familyId) return;
    setPriceSaved(false); setPriceSaving(true);
    try {
      const n = parseFloat(price.replace(/,/g, ''));
      const cents = !Number.isNaN(n) && n > 0 ? Math.round(n * 100) : 0;
      await updateBusiness(familyId, businessId, {
        unitLabel: unit.trim() || undefined,
        unitPriceCents: cents > 0 ? cents : undefined,
      });
      setPriceSaved(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save the price.');
    } finally {
      setPriceSaving(false);
    }
  };

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canEdit = isParent || isOwner;
  // Business 2.0 (R15) — schedule/reminder copy follows the stock switch.
  const stocked = business ? keepsStock(business) : true;
  const habitWord = stocked ? 'stock-take' : 'check-in';

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ h, label: labelForHour(h) })), []);

  const save = async () => {
    if (!familyId) return;
    setError(''); setSaving(true); setSaved(false);
    try {
      await setBusinessReminder(familyId, businessId, {
        enabled, hourUtc: hourToUtc(hour), localLabel: labelForHour(hour),
      });
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const ALL_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const WEEKDAYS: DayOfWeek[]  = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const MWF: DayOfWeek[]       = ['mon', 'wed', 'fri'];
  const DAY_INITIAL: Record<DayOfWeek, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
  const sameSet = (a: DayOfWeek[], b: DayOfWeek[]) => a.length === b.length && a.every((d) => b.includes(d));
  const isDaily = sameSet(schedDays, ALL_DAYS);
  const isWeekdays = sameSet(schedDays, WEEKDAYS);
  const isMwf = sameSet(schedDays, MWF);

  const toggleSchedDay = (d: DayOfWeek) => {
    setSchedSaved(false);
    setSchedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };
  const applyPreset = (days: DayOfWeek[]) => {
    setSchedSaved(false);
    setSchedDays(days);
  };

  const saveSchedule = async () => {
    if (!familyId) return;
    setSchedError(''); setSchedSaved(false); setSchedSaving(true);
    try {
      const time = schedTime.trim();
      // Validate HH:MM if a value was entered. Empty = "anytime today".
      if (time && !/^\d{2}:\d{2}$/.test(time)) {
        setSchedError('Time must look like 17:30 — or leave it empty.');
        return;
      }
      const next: StockTakeSchedule = {
        enabled: schedEnabled,
        daysOfWeek: schedDays,
        ...(time ? { timeLocal: time } : {}),
      };
      await setBusinessStockTakeSchedule(familyId, businessId, next);
      setSchedSaved(true);
    } catch (e: any) {
      setSchedError(e?.message || 'Could not save the schedule.');
    } finally {
      setSchedSaving(false);
    }
  };

  // Web-Fit (2026-08-23): content tier. Desktop: the settings cards
  // sit in a 2-col grid and each card's save button goes inline/right.
  // Mobile unchanged (lg-only classes).
  return (
    <Page width="content">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">⚙️</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Settings</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Loading…'}</div>
        </div>
        {business && (
          <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Dashboard →</Link>
        )}
      </div>

      {!canEdit ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can change settings.</p>
      ) : (
        <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        {/* Business 2.0 (R16–R18) — nature + review cadence. */}
        {business && familyId && profile?.uid && (
          <NatureCard business={business} familyId={familyId} businessId={businessId} isParent={isParent} uid={profile.uid} />
        )}
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <h3 className="font-nunito font-extrabold text-[14px] mb-2">Pricing</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Unit</div>
              <input value={unit} onChange={(e) => { setUnit(e.target.value); setPriceSaved(false); }} maxLength={20} placeholder="pcs, kg, wash"
                className="w-full h-11 px-3 bg-hive-cream rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
            </div>
            <div>
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Price / unit ({config.currency})</div>
              <input value={price} onChange={(e) => { setPrice(e.target.value); setPriceSaved(false); }} inputMode="decimal" placeholder="0"
                className="w-full h-11 px-3 bg-hive-cream rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {UNIT_SUGGESTIONS.map((u) => (
              <button key={u} type="button" onClick={() => { setUnit(u); setPriceSaved(false); }}
                className={`px-2.5 py-1 rounded-hive-pill text-[11.5px] font-nunito font-bold border transition ${unit === u ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>{u}</button>
            ))}
          </div>
          <p className="text-[11px] text-hive-muted mt-2">Change the price anytime — new sales use it; past sales keep what they sold for.</p>
          <div className="lg:flex lg:justify-end">
          <button onClick={savePrice} disabled={priceSaving}
            className={`w-full mt-3 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition ${BTN_INLINE_LG}`}>
            {priceSaving ? 'Saving…' : priceSaved ? '✓ Saved' : 'Save price'}
          </button>
          </div>
        </div>

        {/* Stock-take Workplan schedule — drives the synthetic "Stock-take · [Business]"
            row in the owner kid's /workplan. No HP/streak logic — that's still in the
            reminder card and the instant-cadence path below. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-nunito font-extrabold text-[14px]">{stocked ? '📋 Stock-take schedule' : '☀️ Check-in schedule'}</h3>
              <p className="text-[12px] text-hive-muted mt-0.5">Lands as a task in the owner kid&apos;s Workplan on these days.</p>
            </div>
            <button
              onClick={() => { setSchedEnabled((v) => !v); setSchedSaved(false); }}
              aria-pressed={schedEnabled}
              aria-label={schedEnabled ? 'Disable schedule' : 'Enable schedule'}
              className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${schedEnabled ? 'bg-[#2F7D32]' : 'bg-hive-line'}`}
            >
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${schedEnabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {schedEnabled && (
            <>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {([
                  { label: 'Daily',         days: ALL_DAYS,  active: isDaily },
                  { label: 'Weekdays',      days: WEEKDAYS,  active: isWeekdays && !isDaily },
                  { label: 'Mon · Wed · Fri', days: MWF,     active: isMwf },
                ] as const).map((p) => (
                  <button key={p.label} type="button" onClick={() => applyPreset([...p.days])}
                    className={`px-2.5 py-1 rounded-hive-pill text-[11.5px] font-nunito font-bold border transition ${p.active ? 'bg-hive-honey-soft text-hive-honey-dk border-hive-honey' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5 mt-3">
                {ALL_DAYS.map((d) => {
                  const on = schedDays.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => toggleSchedDay(d)}
                      aria-pressed={on}
                      className={`w-9 h-9 rounded-hive text-[12px] font-nunito font-extrabold border transition ${on ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-cream text-hive-muted border-hive-line'}`}>
                      {DAY_INITIAL[d]}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">
                  Time (optional · empty = anytime today)
                </div>
                <input
                  type="time"
                  value={schedTime}
                  onChange={(e) => { setSchedTime(e.target.value); setSchedSaved(false); }}
                  className="w-full h-11 px-3 bg-hive-cream rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                />
              </div>

              <p className="text-[11px] text-hive-muted mt-2 leading-snug">
                Tapping the Workplan task opens the {habitWord} page. Saving it ticks it complete and grants the usual House Points (instant-cadence) — this schedule only controls when the row appears.
              </p>
            </>
          )}

          {schedError && <p className="text-hive-rose text-[12px] font-bold mt-3">{schedError}</p>}
          {schedSaved && <p className="text-[#2F7D32] text-[12px] font-bold mt-3">✓ Saved</p>}

          <div className="lg:flex lg:justify-end">
          <button onClick={saveSchedule} disabled={schedSaving || (schedEnabled && schedDays.length === 0)}
            className={`w-full mt-4 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition ${BTN_INLINE_LG}`}>
            {schedSaving ? 'Saving…' : 'Save schedule'}
          </button>
          </div>
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-nunito font-extrabold text-[14px]">{stocked ? 'Daily stock-take reminder' : 'Daily check-in reminder'}</h3>
              <p className="text-[12px] text-hive-muted mt-0.5">{stocked ? 'A gentle nudge to update counts + snap a photo.' : 'A gentle nudge to log the day\u2019s sales.'}</p>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              aria-pressed={enabled}
              className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-[#2F7D32]' : 'bg-hive-line'}`}
            >
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {enabled && (
            <div className="mt-3">
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Remind at</div>
              <select
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value))}
                className="w-full h-11 px-3 bg-hive-cream rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
              >
                {hours.map((o) => <option key={o.h} value={o.h}>{o.label}</option>)}
              </select>
              <p className="text-[11px] text-hive-muted mt-1.5">Sent to {business?.ownerId ? 'the kid + parents' : 'parents'} each day, unless the {habitWord} is already done.</p>
            </div>
          )}

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}
          {saved && <p className="text-[#2F7D32] text-[12px] font-bold mt-3">✓ Saved</p>}

          <div className="lg:flex lg:justify-end">
          <button onClick={save} disabled={saving}
            className={`w-full mt-4 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition ${BTN_INLINE_LG}`}>
            {saving ? 'Saving…' : 'Save reminder'}
          </button>
          </div>
        </div>
        </div>
      )}
    </Page>
  );
}

// ── Business 2.0 · How your business works (R16–R18) ─────────────
// The five pricing-model cards + the stock switch + the review cadence.
// A PARENT's change applies instantly (changeBusinessNature — archives /
// un-archives stock, D1); a KID's nature change files a
// business_nature_change approval and waits. Cadence saves directly for
// both (it moves no money). Ledger/milestones/streaks always survive.
function NatureCard({ business, familyId, businessId, isParent, uid }: {
  business: Business;
  familyId: string;
  businessId: string;
  isParent: boolean;
  uid: string;
}) {
  const storedModel = resolvePricingModel(business);
  const storedStock = keepsStock(business);
  const [model, setModel] = useState<PricingModel>(storedModel);
  const [stock, setStock] = useState(storedStock);
  const [cadence, setCadence] = useState<ReviewCadence>(business.reviewCadence || 'weekly');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'' | 'saved' | 'sent'>('');
  const [err, setErr] = useState('');

  // Track the live pending nature request so the kid sees the waiting state.
  useEffect(() => subscribeToBusinessRequests(familyId, setRequests), [familyId]);
  const pendingNature = requests.find((r) =>
    r.businessId === businessId && r.type === 'business_nature_change' && r.status === 'pending');

  // Re-seed if the business doc changes underneath (e.g. approval landed).
  useEffect(() => {
    setModel(storedModel); setStock(storedStock);
    setCadence(business.reviewCadence || 'weekly');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedModel, storedStock, business.reviewCadence]);

  const natureChanged = model !== storedModel || stock !== storedStock;
  const cadenceChanged = cadence !== (business.reviewCadence || 'weekly');

  const save = async () => {
    if (busy) return;
    setBusy(true); setErr(''); setDone('');
    try {
      if (cadenceChanged) await updateBusiness(familyId, businessId, { reviewCadence: cadence });
      if (natureChanged) {
        if (isParent) {
          await changeBusinessNature(familyId, businessId, { pricingModel: model, stockTaking: stock });
          setDone('saved');
        } else {
          await requestBusinessNatureChange(familyId, business, { pricingModel: model, stockTaking: stock }, uid);
          setDone('sent');
        }
      } else if (cadenceChanged) {
        setDone('saved');
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
      <h3 className="font-nunito font-extrabold text-[14px]">🧭 How your business works</h3>
      <p className="text-[12px] text-hive-muted mt-0.5 mb-2.5">
        Life changes — your business can too. Your sales history, milestones and streaks always stay.
      </p>

      {pendingNature && (
        <div className="bg-[#FCEAD6] border border-[#B25E16]/30 rounded-hive p-2.5 mb-2.5 text-[12px] text-[#7a4410] font-nunito font-bold">
          ⏳ A change is waiting for a parent&apos;s OK.
        </div>
      )}

      <div className="space-y-1.5">
        {PRICING_MODELS.map((m) => {
          const active = model === m.key;
          return (
            <button key={m.key} type="button" onClick={() => { setModel(m.key); setStock(m.stockTaking); setDone(''); }}
              className={`w-full rounded-hive px-3 py-2 text-left border-2 flex items-center gap-2.5 transition ${
                active ? 'border-hive-navy bg-hive-navy text-hive-honey' : 'border-hive-line bg-hive-cream text-hive-navy'
              } hover:border-hive-honey`}>
              <span className="text-[18px] shrink-0">{m.emoji}</span>
              <span className="text-[12.5px] font-nunito font-extrabold min-w-0 truncate">{m.label}</span>
              {m.stockTaking && (
                <span className={`ml-auto shrink-0 text-[9px] font-nunito font-black uppercase tracking-wide px-1.5 py-0.5 rounded-hive-pill ${active ? 'bg-hive-honey text-hive-navy' : 'bg-hive-paper text-hive-muted'}`}>stock</span>
              )}
            </button>
          );
        })}
      </div>

      {/* The stock switch (R2) — override the model default. */}
      <div className="flex items-center justify-between mt-3">
        <div className="min-w-0">
          <div className="text-[13px] font-nunito font-extrabold">📦 Count stock daily?</div>
          <p className="text-[11px] text-hive-muted mt-0.5 leading-snug">
            {stock ? 'Keeps the daily stock-take + inventory worth.' : 'No counting — the ☀️ Daily Check-in replaces it (same House Points).'}
          </p>
        </div>
        <button
          onClick={() => { setStock((v) => !v); setDone(''); }}
          aria-pressed={stock}
          className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${stock ? 'bg-[#2F7D32]' : 'bg-hive-line'}`}
        >
          <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${stock ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {storedStock && !stock && (
        <p className="text-[11px] text-[#B25E16] font-nunito font-bold mt-1.5 leading-snug">
          Your stock items will be safely archived (never deleted) — switching back brings them home.
        </p>
      )}

      {/* Review cadence (R18) */}
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3.5">📝 Business Review — how often?</div>
      <div className="flex gap-1.5">
        {REVIEW_CADENCES.map((c) => (
          <button key={c.key} type="button" onClick={() => { setCadence(c.key); setDone(''); }}
            className={`flex-1 h-9 rounded-hive-pill text-[11.5px] font-nunito font-extrabold border transition ${cadence === c.key ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {err && <p className="text-hive-rose text-[12px] font-bold mt-3">{err}</p>}
      {done === 'saved' && <p className="text-[#2F7D32] text-[12px] font-bold mt-3">✓ Saved</p>}
      {done === 'sent' && <p className="text-[#B25E16] text-[12px] font-bold mt-3">🙋 Sent to a parent for approval</p>}

      <div className="lg:flex lg:justify-end">
        <button onClick={save} disabled={busy || (!natureChanged && !cadenceChanged) || (natureChanged && !!pendingNature && !isParent)}
          className={`w-full mt-3 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition ${BTN_INLINE_LG}`}>
          {busy ? 'Saving…' : natureChanged && !isParent ? '🙋 Ask a parent to change it' : 'Save'}
        </button>
      </div>
    </div>
  );
}
