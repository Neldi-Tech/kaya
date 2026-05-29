// Referral badges — flat, iconic seals (the "verified-tick" idiom in five
// Kaya colours). Ported 1:1 from the approved v7 design proposal
// (Kaya_Referral-Rewards_Design-Proposal-v7_2026-05-29.html). One scalloped
// seal silhouette · one bold white glyph · one colour per rung. The name sits
// beside the mark in the UI — never engraved on it.
//
// Founding Family is the apex: gold seal + crown + sparkles.

import { useId } from 'react';
import { BADGES, type BadgeId } from '@/lib/referral';

// Scalloped seal silhouette — centre disc + 12 rim bumps. Fill applied on the
// parent <g> (solid colour for the four flat badges, gold gradient for apex).
const SEAL_BUMPS: Array<[number, number]> = [
  [100, 60], [94.64, 80], [80, 94.64], [60, 100], [40, 94.64], [25.36, 80],
  [20, 60], [25.36, 40], [40, 25.36], [60, 20], [80, 25.36], [94.64, 40],
];

function Seal({ fill }: { fill: string }) {
  return (
    <g fill={fill}>
      <circle cx={60} cy={60} r={40} />
      {SEAL_BUMPS.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={10} />
      ))}
    </g>
  );
}

function Glyph({ id, color }: { id: BadgeId; color: string }) {
  switch (id) {
    case 'friend': // sprout
      return (
        <g fill="#fff">
          <path d="M56 82 C56 70 56 62 58 54 L62 54 C64 62 64 70 64 82 Z" />
          <path d="M60 64 C46 62 38 52 36 41 C50 41 59 51 60 64 Z" />
          <path d="M61 56 C75 54 83 44 85 33 C71 33 62 43 61 56 Z" />
        </g>
      );
    case 'tribe': // group of three
      return (
        <g fill="#fff">
          <circle cx={41} cy={55} r={7} /><path d="M29 86 C29 70 53 70 53 86 Z" />
          <circle cx={79} cy={55} r={7} /><path d="M67 86 C67 70 91 70 91 86 Z" />
          <circle cx={60} cy={48} r={9.5} /><path d="M43 88 C43 67 77 67 77 88 Z" />
        </g>
      );
    case 'champion': // five-point star
      return (
        <polygon
          fill="#fff"
          points="60,34 65.9,51.9 84.8,52.6 69.5,63.1 75.1,81.4 60,70 44.9,81.4 50.5,63.1 35.2,52.6 54.1,51.9"
        />
      );
    case 'patron': // gem
      return (
        <>
          <polygon fill="#fff" points="46,46 74,46 84,58 60,86 36,58" />
          <g stroke={color} strokeWidth={2} fill="none" opacity={0.6} strokeLinejoin="round">
            <line x1={36} y1={58} x2={84} y2={58} />
            <line x1={46} y1={46} x2={54} y2={58} />
            <line x1={74} y1={46} x2={66} y2={58} />
            <line x1={54} y1={58} x2={60} y2={86} />
            <line x1={66} y1={58} x2={60} y2={86} />
          </g>
        </>
      );
    case 'founding': // crown
      return (
        <g>
          <path d="M38 73 L43 50 L52 63 L60 44 L68 63 L77 50 L82 73 Z" fill="#fff" />
          <rect x={38} y={72} width={44} height={7} rx={2.5} fill="#fff" />
          <circle cx={43} cy={50} r={3} fill="#E0A93C" />
          <circle cx={60} cy={44} r={3.4} fill="#E0A93C" />
          <circle cx={77} cy={50} r={3} fill="#E0A93C" />
        </g>
      );
    default:
      return null;
  }
}

export type ReferralBadgeProps = {
  id: BadgeId;
  size?: number;
  /** Render dimmed/desaturated (not yet earned). */
  locked?: boolean;
  /** Accessible label + native tooltip. Defaults to "<name> badge". */
  title?: string;
  className?: string;
};

export function ReferralBadge({ id, size = 64, locked = false, title, className }: ReferralBadgeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const badge = BADGES.find((b) => b.id === id);
  if (!badge) return null;

  const apex = !!badge.apex;
  const goldId = `kbadge-gold-${uid}`;
  const label = title ?? `${badge.name} badge`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      className={className}
      style={locked ? { filter: 'grayscale(1) opacity(0.4)' } : undefined}
    >
      <title>{label}</title>
      {apex && (
        <defs>
          <radialGradient id={goldId} cx="0.4" cy="0.34" r="0.9">
            <stop offset="0%" stopColor="#FCE9A8" />
            <stop offset="55%" stopColor="#E0A93C" />
            <stop offset="100%" stopColor="#B9831F" />
          </radialGradient>
        </defs>
      )}

      {/* apex sparkles */}
      {apex && (
        <g fill="#FCE9A8">
          <path d="M16 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
          <path d="M104 26 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" />
          <path d="M100 92 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4 z" />
        </g>
      )}

      <Seal fill={apex ? `url(#${goldId})` : badge.color} />
      <circle cx={60} cy={60} r={40} fill="none" stroke="#fff" strokeWidth={1.5} opacity={apex ? 0.25 : 0.18} />
      <Glyph id={id} color={badge.color} />
    </svg>
  );
}

export default ReferralBadge;
