'use client';

import type { Child } from '@/lib/firestore';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-9 h-9 text-base',
  lg: 'w-12 h-12 text-2xl',
  xl: 'w-16 h-16 text-3xl',
};

const SHAPE_CLASSES = {
  circle: 'rounded-full',
  square: 'rounded-[14px]',
} as const;

type Shape = keyof typeof SHAPE_CLASSES;

type AvatarChild = Pick<Child, 'houseColor' | 'avatarEmoji'> & { avatarPhoto?: string };

export default function KidAvatar({
  child,
  size = 'md',
  shape = 'circle',
  bgOpacity = '26',
  className = '',
  crown = false,
}: {
  child: AvatarChild;
  size?: Size;
  shape?: Shape;
  bgOpacity?: string;
  className?: string;
  /** Birthday 👑 — a little crown perched on top. Additive; defaults off. */
  crown?: boolean;
}) {
  const sizeCls = SIZE_CLASSES[size];
  const shapeCls = SHAPE_CLASSES[shape];
  const bg = `${child.houseColor}${bgOpacity}`;

  // When crowned, external positioning classes apply to the wrapper so the
  // crown can overhang; otherwise they apply to the avatar itself.
  const innerCls = crown ? '' : className;

  const inner = child.avatarPhoto ? (
    <div
      className={`${sizeCls} ${shapeCls} overflow-hidden flex items-center justify-center shrink-0 ${innerCls}`}
      style={{ backgroundColor: bg }}
    >
      <img
        src={child.avatarPhoto}
        alt={child.avatarEmoji}
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
      />
    </div>
  ) : (
    <div
      className={`${sizeCls} ${shapeCls} flex items-center justify-center shrink-0 ${innerCls}`}
      style={{ backgroundColor: bg }}
    >
      <span>{child.avatarEmoji}</span>
    </div>
  );

  if (!crown) return inner;

  return (
    <div className={`relative inline-flex shrink-0 ${className}`}>
      {inner}
      <span
        aria-hidden
        className="absolute -top-2 left-1/2 -translate-x-1/2 text-[13px] leading-none rotate-[10deg]"
        style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.3))' }}
      >
        👑
      </span>
    </div>
  );
}
