'use client';

// HpValueCommentary — a one-line "your HP is worth ~X" card for the Honey
// Pot home. Translates the kid's HP balance through the family's actual
// rates into a tangible cash estimate so the points stop feeling abstract.
//
// Four states, each with its own copy:
//   0. Empty       — kid has zero HP. Encouragement to start earning.
//   1. Sub-Honey   — kid has HP but not enough for even one Honey Coin.
//                    Show how many more HP they need + what that first
//                    Honey is worth so the target feels concrete.
//   2. Has value   — kid has at least 1 Honey's worth of convertible HP.
//                    Show the full conversion: HP → Honey → cash.
//   3. All locked  — kid has HP but all of it sits under the family's
//                    minHpReserve floor (so nothing is convertible).
//                    Explain that all HP is in the safety pot.
//
// The card is purely informational — no actions, no buttons. Sits between
// the rate pill and the spending plan card so kids see "what's it worth"
// right after they see the rates themselves.

import { formatCashClean, formatHoney, formatHp, honeyToCashCents } from './format';
import HoneyCoin from './HoneyCoin';

// 🍯 in this card always means a Honey *Coin* (the unit), not the Pot.
const Coin = () => <HoneyCoin size={14} className="inline align-middle -mt-px" />;

interface Props {
  housePoints: number;
  hpToHoneyRate: number;
  honeyToCashRate: number;
  /** Family's minimum HP reserve (0 = off). HP under this floor can't
   *  convert, so we subtract it from "convertible" for the estimate. */
  minHpReserve: number;
  /** Live USD→family-currency FX (1 for USD families). */
  fxUsdToFamily: number;
  currency: string;
}

export default function HpValueCommentary({
  housePoints, hpToHoneyRate, honeyToCashRate, minHpReserve, fxUsdToFamily, currency,
}: Props) {
  const ppHP = Math.max(1, hpToHoneyRate);
  const usableHp = Math.max(0, housePoints - minHpReserve);
  const potentialHoney = Math.floor(usableHp / ppHP);
  const potentialCashCents = honeyToCashCents(potentialHoney, honeyToCashRate, fxUsdToFamily);
  const oneHoneyCashCents = honeyToCashCents(1, honeyToCashRate, fxUsdToFamily);
  // HP needed to mint the next Honey Coin from the kid's current convertible
  // balance — for the "earn N more" nudge in the sub-Honey state.
  const hpToNextHoney = ppHP - (usableHp % ppHP);

  // State pick — ordered most-specific first so a zero-balance kid doesn't
  // fall into the "sub-Honey" copy.
  let body: React.ReactNode;
  let tone: 'empty' | 'sub' | 'has' | 'locked';

  if (housePoints === 0) {
    tone = 'empty';
    // Show concrete per-HP value + first-Honey milestone so the kid sees
    // what they're earning toward, not just a generic "go earn" nudge.
    // perHpCents = oneHoneyCashCents / hpToHoneyRate, used to render the
    // "Every HP ≈ TZS X" line. Falls back gracefully if either rate is 0.
    const perHpCents = Math.round(oneHoneyCashCents / ppHP);
    body = (
      <>
        💡 Every HP you earn ≈ <strong>{formatCashClean(perHpCents, currency)}</strong>.{' '}
        Earn <strong>{formatHp(ppHP)} HP</strong> for your first <Coin /> worth{' '}
        <strong>{formatCashClean(oneHoneyCashCents, currency)}</strong>.
      </>
    );
  } else if (usableHp === 0 && minHpReserve > 0) {
    tone = 'locked';
    body = (
      <>
        🛟 All your {formatHp(housePoints)} HP is in the {formatHp(minHpReserve)}-HP
        safety reserve right now. Earn more to start saving into <Coin />.
      </>
    );
  } else if (potentialHoney >= 1) {
    tone = 'has';
    body = (
      <>
        💡 Your <strong>{formatHp(usableHp)} HP</strong>{minHpReserve > 0 ? ' usable' : ''}{' '}
        could become <strong>{formatHoney(potentialHoney)} <Coin /></strong>{' '}
        ≈ <strong>{formatCashClean(potentialCashCents, currency)}</strong> if you save it all.
      </>
    );
  } else {
    // Has some usable HP but not enough for even 1 Honey yet.
    tone = 'sub';
    body = (
      <>
        💪 You&apos;re <strong>{formatHp(hpToNextHoney)} HP</strong> away from your{' '}
        first <Coin /> — worth about <strong>{formatCashClean(oneHoneyCashCents, currency)}</strong>.
        Keep earning!
      </>
    );
  }

  // Visual tone per state — the locked state stays muted (it's a
  // constraint message); empty / sub / has all get the warm honey-tint
  // because they're all "here's what value looks like" content and
  // should feel inviting, not bureaucratic.
  const bgClass =
    tone === 'locked'
      ? 'bg-hive-paper border-hive-line'
      : 'bg-gradient-to-br from-hive-honey-soft/60 to-hive-cream border-hive-honey/40';

  return (
    <div className={`rounded-hive border px-4 py-3 mb-4 ${bgClass}`}>
      <p className="text-[12px] text-hive-ink/85 leading-relaxed text-center">
        {body}
      </p>
    </div>
  );
}
