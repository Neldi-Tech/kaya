'use client';

// ── Web-Fit page primitives (W0, 2026-08-23) ──────────────────────────
//
// Why: the AppShell has been desktop-ready for a long time (260px
// sidebar + top bar), but ~71% of pages rendered their content in a
// phone-width column (`max-w-md … lg:max-w-3xl`) with no multi-column
// layout — so Kaya looked like a phone app floating in a web page.
// Root cause: no shared page container; every page hand-rolled
//   <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
//
// These primitives replace that line. THE CONTRACT:
//   • Below `lg` the output is byte-identical to the old scaffold
//     (`mx-auto max-w-md w-full px-4 pt-4`). Approved mobile designs
//     stay frozen — only `lg+` changes.
//   • Three desktop tiers (approved by Elia 2026-08-23):
//       narrow   720px  — forms, wizards, money flows, chat threads
//       content 1040px  — lists, feeds, detail pages (+ optional rail)
//       wide    1280px  — hubs, dashboards, settings, reports, tables
//   • Forms stay narrow; buttons become inline (`w-full lg:w-auto`).
//   • Lists render as dense rows at `lg` (DataRows), cards on mobile.
//
// Usage:
//   <Page width="wide">
//     <PageHeader actions={<button …>＋ New</button>}>
//       …existing eyebrow / h1 / subtitle markup (unchanged)…
//     </PageHeader>
//     <PageGrid cols={{ base: 2, lg: 3, xl: 4 }} className="gap-3">…tiles…</PageGrid>
//     <PageSplit rail={<Aside />} railMobile="last">…main…</PageSplit>
//     <DataRows tone="hive">…rows (append DATA_ROW to each card)…</DataRows>
//   </Page>

import type { ReactNode } from 'react';

export type PageWidth = 'narrow' | 'content' | 'wide';

/** Desktop max-width per tier. Mobile stays `max-w-md` (448px). */
export const PAGE_WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: 'lg:max-w-[720px]',
  content: 'lg:max-w-[1040px]',
  wide: 'lg:max-w-[1280px]',
};

/** Numeric px, for places that need the value (rare). */
export const PAGE_WIDTH_PX: Record<PageWidth, number> = { narrow: 720, content: 1040, wide: 1280 };

/**
 * Page container. Mobile: exactly today's scaffold. Desktop: the tier's
 * max width. `pad` = the standard `px-4 lg:px-8 pt-4 lg:pt-8` (default
 * on); pass `pad={false}` when the page needs its own vertical rhythm
 * and add padding yourself.
 */
export function Page({
  width = 'content',
  pad = true,
  className = '',
  children,
}: {
  width?: PageWidth;
  pad?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto max-w-md w-full ${PAGE_WIDTH_CLASS[width]} ${
        pad ? 'px-4 lg:px-8 pt-4 lg:pt-8' : ''
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/**
 * Page header frame. Children = the page's existing eyebrow / h1 /
 * subtitle markup (left untouched, so mobile is identical). `actions`
 * render on the right at `lg+` ONLY — the page keeps its mobile button
 * wherever it was (mark that one `lg:hidden`).
 */
export function PageHeader({
  actions,
  className = 'mb-3',
  children,
}: {
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${className} lg:flex lg:items-end lg:justify-between lg:gap-6`}>
      <div className="min-w-0 lg:flex-1">{children}</div>
      {actions && (
        <div className="hidden lg:flex items-center gap-2 shrink-0 pb-1">{actions}</div>
      )}
    </div>
  );
}

// Static class tables — Tailwind JIT needs literal strings, so we map
// numbers → classes here instead of composing `lg:grid-cols-${n}`.
const BASE_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
const SM_COLS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' };
const LG_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6',
};
const XL_COLS: Record<number, string> = {
  1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6',
};

/** Class string for a responsive grid — usable on any element. */
export function gridCols(cols: { base?: number; sm?: number; lg?: number; xl?: number }): string {
  return [
    'grid',
    BASE_COLS[cols.base ?? 1] ?? 'grid-cols-1',
    cols.sm ? SM_COLS[cols.sm] : '',
    cols.lg ? LG_COLS[cols.lg] : '',
    cols.xl ? XL_COLS[cols.xl] : '',
  ].filter(Boolean).join(' ');
}

/**
 * Responsive tile/card grid. `base` = today's mobile column count
 * (keep it what the page already had), `lg`/`xl` = desktop.
 */
export function PageGrid({
  cols,
  className = '',
  children,
}: {
  cols: { base?: number; sm?: number; lg?: number; xl?: number };
  className?: string;
  children: ReactNode;
}) {
  return <div className={`${gridCols(cols)} ${className}`.trim()}>{children}</div>;
}

/**
 * Main + rail split at `lg+`. Below `lg` everything stacks in DOM
 * order — `railMobile` controls where the rail sits on mobile so the
 * mobile reading order can stay exactly what it was:
 *   'last'   (default) rail after main
 *   'first'  rail before main
 *   'hidden' rail is desktop-only
 */
export function PageSplit({
  rail,
  railMobile = 'last',
  railWidth = 320,
  sticky = true,
  className = '',
  mainClassName = '',
  railClassName = '',
  children,
}: {
  rail: ReactNode;
  railMobile?: 'first' | 'last' | 'hidden';
  railWidth?: 300 | 320 | 360;
  sticky?: boolean;
  className?: string;
  mainClassName?: string;
  railClassName?: string;
  children: ReactNode;
}) {
  const cols =
    railWidth === 300 ? 'lg:grid-cols-[minmax(0,1fr)_300px]'
    : railWidth === 360 ? 'lg:grid-cols-[minmax(0,1fr)_360px]'
    : 'lg:grid-cols-[minmax(0,1fr)_320px]';
  // Below `lg` the wrapper is a plain block, so mobile order = DOM
  // order (and margins collapse exactly as before). At `lg` we place
  // both cells explicitly, so DOM order doesn't matter there.
  const main = (
    <div className={`min-w-0 lg:col-start-1 lg:row-start-1 ${mainClassName}`.trim()}>{children}</div>
  );
  const aside = (
    <aside
      className={`min-w-0 lg:col-start-2 lg:row-start-1 ${railMobile === 'hidden' ? 'hidden lg:block' : ''} ${
        sticky ? 'lg:sticky lg:top-[72px]' : ''
      } ${railClassName}`.trim()}
    >
      {rail}
    </aside>
  );
  return (
    <div className={`lg:grid ${cols} lg:gap-6 lg:items-start ${className}`.trim()}>
      {railMobile === 'first' ? (<>{aside}{main}</>) : (<>{main}{aside}</>)}
    </div>
  );
}

/**
 * List container: cards with gaps on mobile (unchanged), one bordered
 * panel of dense divided rows at `lg+`. Append `DATA_ROW` to each row's
 * own card classes so its border/radius drop inside the panel.
 */
export function DataRows({
  tone = 'kaya',
  className = '',
  children,
}: {
  tone?: 'kaya' | 'hive';
  className?: string;
  children: ReactNode;
}) {
  const panel =
    tone === 'hive'
      ? 'lg:rounded-hive lg:border lg:border-hive-line lg:bg-hive-paper lg:divide-y lg:divide-hive-line'
      : 'lg:rounded-kaya lg:border lg:border-kaya-warm-dark lg:bg-white lg:divide-y lg:divide-kaya-warm-dark/60';
  return (
    <div className={`flex flex-col gap-2 lg:gap-0 lg:overflow-hidden ${panel} ${className}`.trim()}>
      {children}
    </div>
  );
}

/** Row classes to append to each card inside <DataRows>. */
export const DATA_ROW = 'lg:border-0 lg:rounded-none lg:shadow-none';

/** Row hover (use on interactive rows inside <DataRows>). */
export const DATA_ROW_HOVER = 'lg:hover:bg-black/[0.025] lg:transition-colors';

/** Full-width on mobile, inline on desktop — the standard button rule. */
export const BTN_INLINE_LG = 'lg:w-auto lg:px-6';

/** KPI strip — 2-up on mobile (keep what the page had), 4-up on desktop. */
export function KpiStrip({ className = '', children, base = 2, lg = 4 }: { className?: string; children: ReactNode; base?: 1 | 2 | 3; lg?: 2 | 3 | 4 | 5 | 6 }) {
  return <div className={`${gridCols({ base, lg })} ${className}`.trim()}>{children}</div>;
}
