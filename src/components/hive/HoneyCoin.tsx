'use client';

// HoneyCoin — the Hive's Honey Coin (HC), as a minted 3D gold coin with a
// faceted triangular honey-mountain and molten honey cresting the peak
// (Elia's pick, 2026-05-23 v3 · option 2 "pure mountain, no wings").
//
// Pure vector so it stays crisp from a 16px wallet chip to a hero, and a
// distinct, premium mark — NOT the 🍯 Honey Pot (which now means only the
// Treasury Reserve). Gradient/filter ids are made unique per instance so
// multiple coins on a page never collide.

import { useId } from 'react';

export default function HoneyCoin({
  size = 24, className, title = 'Honey Coin',
}: { size?: number; className?: string; title?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const metal = `hc-m-${raw}`, mtnL = `hc-l-${raw}`, mtnD = `hc-d-${raw}`,
    lava = `hc-v-${raw}`, glow = `hc-g-${raw}`, soft = `hc-s-${raw}`;
  return (
    <svg width={size} height={size} viewBox="0 0 150 150" className={className} role="img" aria-label={title}>
      <defs>
        <radialGradient id={metal} cx="33%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#FFF8D6" />
          <stop offset="30%" stopColor="#F6CD62" />
          <stop offset="64%" stopColor="#D8991E" />
          <stop offset="88%" stopColor="#A66B0B" />
          <stop offset="100%" stopColor="#7A4D05" />
        </radialGradient>
        <linearGradient id={mtnL} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFE9A2" /><stop offset="100%" stopColor="#E0A52A" />
        </linearGradient>
        <linearGradient id={mtnD} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C98A1A" /><stop offset="100%" stopColor="#6E4304" />
        </linearGradient>
        <radialGradient id={lava} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#FFF1B0" /><stop offset="45%" stopColor="#FF9E2C" /><stop offset="100%" stopColor="#D2620A" />
        </radialGradient>
        <filter id={glow} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.4" /></filter>
        <filter id={soft} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4" /></filter>
      </defs>
      {/* minted gold body */}
      <circle cx="75" cy="75" r="70" fill={`url(#${metal})`} />
      {/* milled (reeded) edge */}
      <circle cx="75" cy="75" r="68.5" fill="none" stroke="#5E3B04" strokeWidth="5" strokeDasharray="2.4 3" opacity="0.6" />
      {/* beveled rim: bright top arc + dark bottom arc */}
      <path d="M21 62 A56 56 0 0 1 129 62" fill="none" stroke="#FFF3CF" strokeWidth="3" opacity="0.8" filter={`url(#${soft})`} />
      <path d="M21 88 A56 56 0 0 0 129 88" fill="none" stroke="#6E4304" strokeWidth="3" opacity="0.7" filter={`url(#${soft})`} />
      <circle cx="75" cy="75" r="58" fill="none" stroke="#8F5C06" strokeWidth="1.5" opacity="0.55" />
      {/* faceted triangular honey-mountain: lit + shadow faces + ridge */}
      <path d="M75 40 L44 110 L75 103 Z" fill={`url(#${mtnL})`} />
      <path d="M75 40 L75 103 L106 110 Z" fill={`url(#${mtnD})`} />
      <path d="M75 40 L75 103" stroke="#FFF3CF" strokeWidth="1.4" opacity="0.7" />
      <path d="M44 110 L106 110" stroke="#5E3B04" strokeWidth="2" opacity="0.5" />
      {/* molten honey cresting the peak (subtle) */}
      <circle cx="75" cy="42" r="9.5" fill={`url(#${lava})`} opacity="0.9" filter={`url(#${glow})`} />
      <path d="M67 44 C69 37 81 37 83 44 C81 49 69 49 67 44 Z" fill={`url(#${lava})`} stroke="#C0590A" strokeWidth="1" />
      {/* top specular sheen */}
      <ellipse cx="58" cy="44" rx="30" ry="14" fill="#FFFFFF" opacity="0.26" filter={`url(#${glow})`} />
    </svg>
  );
}
