// Kaya Fun · brand icon. The Kaya house mark (from the master logo) with
// a play ▶ inside — "fun, at home". Marks the Kaya Fun nav section that
// groups Games + Videos. Concept I, approved 2026-05-31.
//
// Self-contained — pass className to size via Tailwind (w-4 h-4 etc.).
// Honey house (#F39C2F) reads on both light + navy(active) nav rows; the
// cream play triangle (#FFF8EC) sits inside the house. Holds up at 16px.

import type { SVGProps } from 'react';

export default function KayaFunIcon({ className = '', ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Kaya Fun"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {/* House silhouette — same roofline as the Kaya master mark */}
      <path
        fill="#F39C2F"
        d="M 116 432 Q 96 432 96 412 L 96 246 Q 96 240 102 234 L 244 92 Q 256 80 268 92 L 410 234 Q 416 240 416 246 L 416 412 Q 416 432 396 432 L 116 432 Z"
      />
      {/* Play triangle, centred where the heart sits on the master logo */}
      <path d="M 214 250 L 214 360 L 312 305 Z" fill="#FFF8EC" />
    </svg>
  );
}
