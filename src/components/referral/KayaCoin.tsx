// Kaya Coin — the wordless, rich-minted referral currency mark (Coin A from
// the approved v7 design proposal). Family-of-four relief · laurel wreath ·
// gloss. Zero text, no beaded rim, no crown. Family-level currency (KC),
// distinct from kid-earned Honey.
//
// Gradient/filter IDs are namespaced per instance (useId) so multiple coins on
// one page never collide.

import { useId } from 'react';

// The four embossed figures of the family-of-four relief — shared by the
// shadow layer and the main (gold) layer.
function FamilyRelief() {
  return (
    <>
      <circle cx={-36} cy={-30} r={12} /><rect x={-47} y={-20} width={24} height={38} rx={3} />
      <circle cx={36} cy={-30} r={12} /><rect x={23} y={-20} width={24} height={38} rx={3} />
      <circle cx={-13} cy={-26} r={9} /><rect x={-21} y={-18} width={17} height={33} rx={2.5} />
      <circle cx={13} cy={-26} r={9} /><rect x={4} y={-18} width={17} height={33} rx={2.5} />
    </>
  );
}

const LEAVES = [
  'translate(-78 4) rotate(-50)',
  'translate(-70 -6) rotate(-66)',
  'translate(-60 -14) rotate(-82)',
  'translate(-48 -19) rotate(-98)',
  'translate(-70 13) rotate(-30)',
  'translate(-56 21) rotate(-14)',
  'translate(-40 26) rotate(2)',
];

export type KayaCoinProps = {
  size?: number;
  className?: string;
};

export function KayaCoin({ size = 64, className }: KayaCoinProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const faceRich = `kc-faceRich-${uid}`;
  const faceDark = `kc-faceDark-${uid}`;
  const rimBright = `kc-rimBright-${uid}`;
  const rimReverse = `kc-rimReverse-${uid}`;
  const shadow = `kc-shadow-${uid}`;
  const leaf = `kc-leaf-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Kaya Coin"
      className={className}
    >
      <defs>
        <radialGradient id={faceRich} cx="0.35" cy="0.32" r="0.85">
          <stop offset="0%" stopColor="#FFF0BA" /><stop offset="22%" stopColor="#F5D77C" />
          <stop offset="48%" stopColor="#D4A847" /><stop offset="78%" stopColor="#9C7A2C" />
          <stop offset="100%" stopColor="#5C3F0D" />
        </radialGradient>
        <radialGradient id={faceDark} cx="0.35" cy="0.32" r="0.85">
          <stop offset="0%" stopColor="#E0BC65" /><stop offset="50%" stopColor="#A07900" /><stop offset="100%" stopColor="#3A2807" />
        </radialGradient>
        <linearGradient id={rimBright} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF0BA" /><stop offset="35%" stopColor="#D4A847" /><stop offset="100%" stopColor="#3A2807" />
        </linearGradient>
        <linearGradient id={rimReverse} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A2807" /><stop offset="60%" stopColor="#D4A847" /><stop offset="100%" stopColor="#FFF0BA" />
        </linearGradient>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodOpacity="0.5" floodColor="#000" />
        </filter>
        <path
          id={leaf}
          d="M 0 0 C -3 -8 -2 -16 4 -22 C 8 -16 8 -8 4 0 C 2 2 -1 2 0 0 Z"
          fill={`url(#${faceRich})`}
          stroke="#5C3F0D"
          strokeWidth={0.4}
        />
      </defs>

      {/* layered rim */}
      <circle cx={160} cy={160} r={152} fill={`url(#${rimReverse})`} />
      <circle cx={160} cy={160} r={146} fill={`url(#${rimBright})`} />
      <circle cx={160} cy={160} r={140} fill={`url(#${faceRich})`} filter={`url(#${shadow})`} />
      {/* inner field ring */}
      <circle cx={160} cy={160} r={120} fill="none" stroke="#7A5C18" strokeWidth={1.4} opacity={0.5} />

      {/* embossed family of four (bold relief) */}
      <g transform="translate(160 150)">
        <g fill="#3A2807" opacity={0.5} transform="translate(0 3)">
          <FamilyRelief />
        </g>
        <g fill={`url(#${faceDark})`} stroke="#5C3F0D" strokeWidth={1.3}>
          <FamilyRelief />
          <rect x={-49} y={18} width={98} height={4.5} rx={2.2} />
        </g>
        <g fill="#FFF0BA" opacity={0.55}>
          <ellipse cx={-39} cy={-34} rx={3.2} ry={1.6} /><ellipse cx={-44} cy={-15} rx={2.2} ry={7} />
          <ellipse cx={33} cy={-34} rx={3.2} ry={1.6} /><ellipse cx={28} cy={-15} rx={2.2} ry={7} />
          <ellipse cx={-15} cy={-29} rx={2.2} ry={1.3} /><ellipse cx={-19} cy={-13} rx={1.6} ry={5} />
          <ellipse cx={11} cy={-29} rx={2.2} ry={1.3} /><ellipse cx={7} cy={-13} rx={1.6} ry={5} />
        </g>
      </g>

      {/* laurel wreath base (decorative, no ribbon/text) */}
      <g transform="translate(160 204)">
        <g>{LEAVES.map((t, i) => <use key={i} href={`#${leaf}`} transform={t} />)}</g>
        <g transform="scale(-1 1)">{LEAVES.map((t, i) => <use key={i} href={`#${leaf}`} transform={t} />)}</g>
        {/* small star where the wreath meets */}
        <g transform="translate(0 20)" fill={`url(#${faceRich})`} stroke="#5C3F0D" strokeWidth={0.5}>
          <polygon points="0,-7 2,-2 7,-2 3,1.5 4.5,6.5 0,3.4 -4.5,6.5 -3,1.5 -7,-2 -2,-2" />
        </g>
      </g>

      {/* gloss */}
      <path d="M 56 70 A 110 110 0 0 1 160 38" stroke="white" strokeWidth={8} opacity={0.3} fill="none" strokeLinecap="round" />
      <path d="M 70 90 A 90 90 0 0 1 150 56" stroke="white" strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default KayaCoin;
