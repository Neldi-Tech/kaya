// Per-module, per-month spend series for the Finances/Dashboard Trends
// view (2026-06-15). Pure aggregation over the closed requests + spend
// ledger the pages already subscribe to — no extra reads. Mirrors the
// roll-up logic on the Finances page, just bucketed across a window of
// months instead of one.

import { type PurchaseRequest, type PurchaseModule, budgetMonthKeyFor } from './purchase';
import { type SpendLedgerEntry } from './spendLedger';

const monthKeyOfDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export interface ModuleSeries {
  /** Month keys, oldest first — the x-axis. */
  months: string[];
  /** module → spend (cents) per month, aligned to `months`. */
  perModule: Record<string, number[]>;
  /** Total spend (cents) per month, aligned to `months`. */
  totals: number[];
}

/** Build a per-module spend series across the given month keys. */
export function buildModuleSeries(
  modules: PurchaseModule[],
  closed: PurchaseRequest[],
  ledger: SpendLedgerEntry[],
  months: string[],
): ModuleSeries {
  const idx = new Map(months.map((k, i) => [k, i]));
  const perModule: Record<string, number[]> = {};
  for (const m of modules) perModule[m] = months.map(() => 0);
  const totals = months.map(() => 0);

  for (const r of closed) {
    if (r.status !== 'closed') continue;
    const k = budgetMonthKeyFor(r);
    const i = k != null ? idx.get(k) : undefined;
    if (i == null) continue;
    const m = (r.module ?? 'pantry') as PurchaseModule;
    if (!perModule[m]) continue;
    const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    perModule[m][i] += cents;
    totals[i] += cents;
  }
  for (const e of ledger) {
    if (e.isProfessionalExpense) continue;
    const at = e.occurredOn?.toDate?.();
    if (!at) continue;
    const i = idx.get(monthKeyOfDate(at));
    if (i == null) continue;
    const m = e.sourceModule as PurchaseModule;
    if (!perModule[m]) continue;
    const cents = e.amountHousehold || 0;
    perModule[m][i] += cents;
    totals[i] += cents;
  }
  return { months, perModule, totals };
}

/** Modules that have any spend across the window (keeps charts uncluttered). */
export function activeModulesIn(series: ModuleSeries, modules: PurchaseModule[]): PurchaseModule[] {
  return modules.filter((m) => (series.perModule[m] ?? []).some((v) => v > 0));
}

export interface ModuleDelta {
  module: PurchaseModule;
  prev: number;
  curr: number;
  deltaCents: number;
  /** null when prev was 0 (can't compute a %). */
  deltaPct: number | null;
}

/** Per-module mean monthly spend across the window (cents). Drives the
 *  what-if simulator's baselines. */
export function monthlyAverages(series: ModuleSeries, modules: PurchaseModule[]): Record<string, number> {
  const out: Record<string, number> = {};
  const n = Math.max(1, series.months.length);
  for (const m of modules) {
    const arr = series.perModule[m] ?? [];
    out[m] = arr.reduce((a, v) => a + v, 0) / n;
  }
  return out;
}

export interface HeadlineSignal {
  tone: 'hi' | 'win' | 'mid';
  emoji: string;
  module: PurchaseModule;
  text: string;
}

/** The single most noteworthy movement in the window — for the quiet
 *  "Kaya noticed" banner on the Overview tab (surprise #2). Prefers an
 *  anomaly, then the biggest riser, then the biggest win. Returns null
 *  when there's nothing worth flagging. */
export function headlineSignal(
  series: ModuleSeries,
  modules: PurchaseModule[],
  labelOf: (m: PurchaseModule) => string,
): HeadlineSignal | null {
  const n = series.months.length;
  // Anomaly — latest vs trailing average.
  if (n >= 3) {
    let best: { m: PurchaseModule; pct: number } | null = null;
    for (const m of modules) {
      const arr = series.perModule[m] ?? [];
      const latest = arr[n - 1] ?? 0;
      const past = arr.slice(0, n - 1);
      const avg = past.reduce((a, v) => a + v, 0) / Math.max(1, past.length);
      if (avg > 0 && latest > avg * 1.3) {
        const pct = Math.round(((latest - avg) / avg) * 100);
        if (!best || pct > best.pct) best = { m, pct };
      }
    }
    if (best) return { tone: 'hi', emoji: '📈', module: best.m, text: `${labelOf(best.m)} is ${best.pct}% above its recent average` };
  }
  const deltas = lastTwoDeltas(series, modules);
  const riser = deltas.find((d) => d.deltaCents > 0);
  if (riser && riser.deltaPct != null && riser.deltaPct >= 15) {
    return { tone: 'hi', emoji: '⚡', module: riser.module, text: `${labelOf(riser.module)} is up ${riser.deltaPct}% vs last month` };
  }
  const win = [...deltas].sort((a, b) => a.deltaCents - b.deltaCents)[0];
  if (win && win.deltaCents < 0 && win.deltaPct != null) {
    return { tone: 'win', emoji: '✅', module: win.module, text: `${labelOf(win.module)} is down ${Math.abs(win.deltaPct)}% vs last month` };
  }
  return null;
}

/** Month-over-month deltas (last two months in the window), biggest first. */
export function lastTwoDeltas(series: ModuleSeries, modules: PurchaseModule[]): ModuleDelta[] {
  const n = series.months.length;
  if (n < 2) return [];
  const out: ModuleDelta[] = [];
  for (const m of modules) {
    const arr = series.perModule[m] ?? [];
    const curr = arr[n - 1] ?? 0;
    const prev = arr[n - 2] ?? 0;
    if (curr === 0 && prev === 0) continue;
    const deltaCents = curr - prev;
    const deltaPct = prev > 0 ? Math.round((deltaCents / prev) * 100) : null;
    out.push({ module: m, prev, curr, deltaCents, deltaPct });
  }
  return out.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}
