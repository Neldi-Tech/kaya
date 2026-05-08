'use client';

// Tiny "100 HP = 1 🍯" pill matching the v2 design. Used on the Hive Home
// summary, on the convert screens (PR-Hive-B), and anywhere we want to
// remind the kid what the family's current rates are.

export default function RatePill({
  hpToHoneyRate,
  honeyToCashRate,
  variant = 'hp-to-honey',
  currency = 'USD',
}: {
  hpToHoneyRate: number;
  honeyToCashRate: number;
  variant?: 'hp-to-honey' | 'honey-to-cash' | 'both';
  currency?: string;
}) {
  const symbol = currency === 'USD' ? '$' : currency;
  if (variant === 'hp-to-honey') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
        ⇆ {hpToHoneyRate} HP = 1 🍯
      </span>
    );
  }
  if (variant === 'honey-to-cash') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
        ⇆ 1 🍯 = {symbol}{honeyToCashRate.toFixed(2)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
      <span>⇆ {hpToHoneyRate} HP = 1 🍯</span>
      <span className="opacity-50">·</span>
      <span>1 🍯 = {symbol}{honeyToCashRate.toFixed(2)}</span>
    </span>
  );
}
