'use client';

// Auto vs Manual billing toggle. The single most important field on a
// Subscription per spec §3.7 — drives all reminder + check-in behaviour.
//
//   Auto    — card on file / standing order. System tracks only.
//             Reminder rows default to [] (or [2] if "notify on renewal").
//   Manual  — user pays each cycle (M-Pesa, bank, cash). System fires
//             pre-due reminders + post-due "did you pay?" check.
//             Reminder rows default to [7, 2, 0].

import type { SubscriptionBillingMode } from '@/lib/subscriptions';

export function AutoManualToggle({
  value,
  onChange,
  label = 'Billing mode',
}: {
  value: SubscriptionBillingMode;
  onChange: (v: SubscriptionBillingMode) => void;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold uppercase tracking-wide text-pulse-navy/65">
        {label}
      </label>
      <div className="grid grid-cols-2 gap-0 rounded-full bg-pulse-navy/8 p-1">
        <Pill active={value === 'auto'}   onClick={() => onChange('auto')}   subtitle="Card on file / standing order">Auto</Pill>
        <Pill active={value === 'manual'} onClick={() => onChange('manual')} subtitle="You pay each cycle">Manual</Pill>
      </div>
      <p className="text-xs font-semibold text-pulse-navy/55">
        {value === 'auto'
          ? 'System tracks only — no payment reminders. Renewal heads-up optional.'
          : 'Pre-due reminders (7d, 2d, day-of) + post-due check + utilisation watch.'}
      </p>
    </div>
  );
}

function Pill({
  active, onClick, children, subtitle,
}: { active: boolean; onClick: () => void; children: React.ReactNode; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 transition-colors ${
        active
          ? 'bg-pulse-navy text-pulse-cream'
          : 'text-pulse-navy/70 hover:text-pulse-navy'
      }`}
    >
      <div className="font-display font-extrabold">{children}</div>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${active ? 'text-pulse-cream/75' : 'text-pulse-navy/45'}`}>
        {subtitle}
      </div>
    </button>
  );
}
