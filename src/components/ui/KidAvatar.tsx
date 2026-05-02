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
}: {
  child: AvatarChild;
  size?: Size;
  shape?: Shape;
  bgOpacity?: string;
  className?: string;
}) {
  const sizeCls = SIZE_CLASSES[size];
  const shapeCls = SHAPE_CLASSES[shape];
  const bg = `${child.houseColor}${bgOpacity}`;

  if (child.avatarPhoto) {
    return (
      <div
        className={`${sizeCls} ${shapeCls} overflow-hidden flex items-center justify-center shrink-0 ${className}`}
        style={{ backgroundColor: bg }}
      >
        <img
          src={child.avatarPhoto}
          alt={child.avatarEmoji}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeCls} ${shapeCls} flex items-center justify-center shrink-0 ${className}`}
      style={{ backgroundColor: bg }}
    >
      <span>{child.avatarEmoji}</span>
    </div>
  );
}
