// Kaya Sparks · brand icon. Custom SVG mark replacing the ✨ emoji
// across user-facing surfaces (sidebar row, parent landing hero,
// any "Kaya Sparks" label that takes an iconNode).
//
// Concept A · "Bulb wearing a cap" — fusion of graduation cap + light
// bulb, drawn 2026-05-27 to give Sparks a distinct mark (the ✨ was
// generic AI shorthand). Filament inside the bulb adds the
// "idea forming" detail.
//
// Self-contained React component — pass className to size + colour via
// Tailwind utilities (the SVG uses fill rules that hold up at 16px).
// Colours are hard-coded to the Kaya palette (gold #D4A847, chocolate
// #1E120B, warm yellow #FFE9A0) so the mark always reads the same way
// regardless of the surface it sits in.

import type { SVGProps } from 'react';

export default function SparksIcon({
  className = '',
  ...rest
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* soft glow halo */}
      <circle cx="32" cy="38" r="22" fill="#FFD93D" opacity="0.18" />

      {/* bulb glass */}
      <path
        d="M20 36 C20 24, 26 18, 32 18 C38 18, 44 24, 44 36 C44 41, 41 44, 40 47 L24 47 C23 44, 20 41, 20 36 Z"
        fill="#FFE9A0"
        stroke="#1E120B"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* filament — idea forming */}
      <path
        d="M27 38 Q32 31 37 38 M30 41 L34 41"
        fill="none"
        stroke="#B8860B"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* bulb screw base */}
      <rect x="26" y="47" width="12" height="3.5" rx="1" fill="#1E120B" />
      <rect x="26" y="51" width="12" height="2.5" fill="#5A6488" />
      <rect x="26" y="54" width="12" height="2.5" fill="#5A6488" />
      <path d="M28 57 L36 57 L34 60 L30 60 Z" fill="#5A6488" />

      {/* mortarboard cap on top */}
      <path d="M14 16 L32 9 L50 16 L32 23 Z" fill="#1E120B" />
      {/* cap underside shadow */}
      <path d="M32 16 L32 23 L26 20 Z" fill="#3A2A1F" opacity="0.6" />

      {/* tassel cord */}
      <path
        d="M46 17 L46 24 Q46 27 49 27"
        fill="none"
        stroke="#D4A847"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* tassel pom */}
      <circle cx="49" cy="29" r="2.2" fill="#D4A847" />
      <path
        d="M47.5 30 L47.5 32.5 M49 30.5 L49 33 M50.5 30 L50.5 32.5"
        stroke="#B8860B"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
