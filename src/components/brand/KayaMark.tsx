// Kaya · the house-with-K logomark, as a reusable React component.
//
// This is the REAL brand mark the app ships (public/brand/kaya-icon-k.svg) —
// a solid house silhouette with a compact K letterform inside. It is NOT a
// typographic "K" in a rounded box; Elia flagged that substitution on the
// COPPA/login v2 mockup (2026-05-29). Render this component anywhere the
// brand mark is needed so every surface stays pixel-identical to the asset.
//
// Geometry (paths + stroke-32 K) is copied verbatim from kaya-icon-k.svg so
// it reads cleanly from 16px (favicon) up to hero sizes.
//
// Variants — pick by the SURFACE the mark sits on:
//   • "dark"    chocolate house + gold-light K  → for LIGHT surfaces
//               (cream/white). Matches the live AppShell sidebar.
//   • "reverse" gold-light house + chocolate K  → for DARK surfaces
//               (the chocolate brand panel on /login, /signup, etc.).

export type KayaMarkVariant = 'dark' | 'reverse';

interface KayaMarkProps {
  /** Which colourway. Choose by the surface the mark sits on (see above). */
  variant?: KayaMarkVariant;
  /** Square size in px, applied to both width and height. Default 36. */
  size?: number;
  /** Extra classes on the <svg> (e.g. margin/positioning helpers). */
  className?: string;
  /**
   * Accessible label. When provided the mark is exposed to screen readers
   * with this name; when omitted it is decorative (aria-hidden) — use that
   * when an adjacent "Kaya" wordmark already carries the label.
   */
  title?: string;
}

// Exact brand hexes (mirror kaya.chocolate / kaya.gold-light in tailwind.config).
const CHOCOLATE = '#1E120B';
const GOLD_LIGHT = '#F5E6B8';

export default function KayaMark({
  variant = 'dark',
  size = 36,
  className,
  title,
}: KayaMarkProps) {
  // "dark" → chocolate house, gold-light K. "reverse" → swap the two.
  const houseFill = variant === 'reverse' ? GOLD_LIGHT : CHOCOLATE;
  const kStroke = variant === 'reverse' ? CHOCOLATE : GOLD_LIGHT;

  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {/* Chimney */}
      <path fill={houseFill} d="M 338 210 L 338 138 Q 338 124 352 124 L 374 124 Q 388 124 388 138 L 388 210 Z" />
      {/* House body (solid, no heart cutout) */}
      <path fill={houseFill} d="M 116 432 Q 96 432 96 412 L 96 246 Q 96 240 102 234 L 244 92 Q 256 80 268 92 L 410 234 Q 416 240 416 246 L 416 412 Q 416 432 396 432 L 116 432 Z" />
      {/* K letterform · vertically centred in the house body */}
      <g stroke={kStroke} strokeWidth={32} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="220" y1="280" x2="220" y2="375" />
        <line x1="220" y1="328" x2="290" y2="280" />
        <line x1="220" y1="328" x2="290" y2="375" />
      </g>
    </svg>
  );
}
