// The real Kaya brand mark — house silhouette with a heart inside, honey
// orange. Paths copied verbatim from Kaya Logo/svg/kaya-icon.svg (the
// brand asset), rendered as a reusable component so marketing + login can
// size it freely. Do not redraw these paths — they are the brand.

type Props = {
  className?: string;
  size?: number;
  title?: string;
};

export default function KayaIcon({ className, size = 28, title = 'Kaya' }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <path
        fill="#F39C2F"
        d="M 338 210 L 338 138 Q 338 124 352 124 L 374 124 Q 388 124 388 138 L 388 210 Z"
      />
      <path
        fillRule="evenodd"
        fill="#F39C2F"
        d="M 116 432 Q 96 432 96 412 L 96 246 Q 96 240 102 234 L 244 92 Q 256 80 268 92 L 410 234 Q 416 240 416 246 L 416 412 Q 416 432 396 432 L 116 432 Z M 256 320 C 256 290 216 290 216 312 C 216 344 236 360 256 380 C 276 360 296 344 296 312 C 296 290 256 290 256 320 Z"
      />
    </svg>
  );
}
