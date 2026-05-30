'use client';

// Stock change history — drop into two surfaces with the same data:
//
//   1. Spark · "Inventory & worth" detail screen
//        <StockChangeLog events={last7d} currency="TZS" mode="list" />
//
//   2. Admin · approval-doc review
//        <StockChangeLog events={last7d} currency="TZS" mode="summary" />
//
// One source of truth (the stock-take events), two presentations.
//
// Self-contained — no external imports beyond React. Tailwind classes
// use inline hex values so the file drops into any Tailwind setup
// without depending on a `tailwind.config` palette.

import React from 'react';

export type StockChangeKind = 'add' | 'sell' | 'spoil' | 'adjust';

export interface StockChangeEvent {
  id: string;
  kind: StockChangeKind;
  /** Net qty change (signed: + for in, − for out). */
  qty: number;
  unit?: string;
  /** Net value change in cents of `currency` (signed). */
  deltaCents: number;
  /** ISO timestamp or anything Date.parse can read. */
  at: string;
  /** Who triggered it. */
  by?: string;
  /** Short source/reason tag (e.g. "daily stock-take", "log sale"). */
  source?: string;
}

export interface StockChangeLogProps {
  events: StockChangeEvent[];
  currency: string;
  /** 'list' = full per-event row list (Inventory & worth screen).
   *  'summary' = tight inflows/outflows summary (Approval doc).   */
  mode?: 'list' | 'summary';
  onSeeAll?: () => void;
  /** Header text override. */
  title?: string;
  /** Suppress the header so the component can sit inside a parent card. */
  bare?: boolean;
}

const KIND_META: Record<StockChangeKind, { emoji: string; verb: string }> = {
  add:    { emoji: '📥', verb: 'added' },
  sell:   { emoji: '💵', verb: 'sold' },
  spoil:  { emoji: '🗑',  verb: 'spoiled' },
  adjust: { emoji: '✏️', verb: 'adjusted' },
};

function fmtCents(cents: number, currency: string): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  const abs = Math.abs(cents) / 100;
  return `${sign}${currency} ${abs.toLocaleString()}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function StockChangeLog({
  events,
  currency,
  mode = 'list',
  onSeeAll,
  title,
  bare = false,
}: StockChangeLogProps) {
  if (mode === 'summary') {
    const inflow  = events.filter((e) => e.deltaCents > 0);
    const outflow = events.filter((e) => e.deltaCents < 0);
    const inflowSum  = inflow.reduce((s, e) => s + e.deltaCents, 0);
    const outflowSum = outflow.reduce((s, e) => s + e.deltaCents, 0);
    return (
      <div className="space-y-2">
        {!bare && (
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#B57A00]">
            {title ?? 'Approval doc · what changed'}
          </p>
        )}
        {events.length === 0 ? (
          <p className="text-[12px] text-[#6B7280]">No stock changes in window.</p>
        ) : (
          <ul className="text-[12px] text-[#0E2240] space-y-1">
            {inflow.length > 0 && (
              <li className="flex items-center gap-2">
                <span className="text-[#1F8A4C]">▲</span>
                {inflow.length} inflow{inflow.length === 1 ? '' : 's'} · {fmtCents(inflowSum, currency)}
              </li>
            )}
            {outflow.length > 0 && (
              <li className="flex items-center gap-2">
                <span className="text-[#C0392B]">▼</span>
                {outflow.length} outflow{outflow.length === 1 ? '' : 's'} · {fmtCents(outflowSum, currency)}
              </li>
            )}
          </ul>
        )}
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[11px] font-extrabold text-[#B57A00]"
          >
            Open change log →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[20px] p-4 space-y-2">
      {!bare && (
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#0E2240]">
            {title ?? 'Recent stock changes'}
          </p>
          {onSeeAll && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-[11px] font-extrabold text-[#B57A00]"
            >
              See all →
            </button>
          )}
        </div>
      )}
      {events.length === 0 ? (
        <p className="text-[11px] text-[#6B7280]">No stock changes yet.</p>
      ) : (
        <ul className="divide-y divide-[#EDE3CC]">
          {events.map((e) => {
            const meta = KIND_META[e.kind];
            const tone = e.deltaCents > 0 ? 'in' : 'out';
            const qtySign = e.qty > 0 ? '+' : e.qty < 0 ? '−' : '';
            const qtyAbs = Math.abs(e.qty);
            return (
              <li key={e.id} className="py-2 flex items-center gap-3">
                <span className="w-7 h-7 rounded-[8px] bg-[#FFEDC0] text-[#B57A00] inline-flex items-center justify-center text-[14px] shrink-0">
                  {meta.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-extrabold text-[#0E2240] truncate">
                    {qtySign}{qtyAbs} {e.unit ?? 'unit'}{qtyAbs === 1 ? '' : 's'} {meta.verb}
                  </p>
                  <p className="text-[11px] text-[#6B7280] truncate">
                    {fmtDate(e.at)}
                    {e.by ? ` · ${e.by}` : ''}
                    {e.source ? ` · ${e.source}` : ''}
                  </p>
                </div>
                <p
                  className={`text-[12px] font-black shrink-0 ${
                    tone === 'in' ? 'text-[#1F8A4C]' : 'text-[#C0392B]'
                  }`}
                >
                  {fmtCents(e.deltaCents, currency)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
