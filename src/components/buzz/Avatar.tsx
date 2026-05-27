'use client';

import { avatarStyle } from '@/lib/buzz';

export function BuzzAvatar({
  avatarKey,
  displayName,
  size = 28,
}: { avatarKey: string; displayName: string; size?: number }) {
  const style = avatarStyle(avatarKey);
  const initials = avatarKey === 'anon' ? '🕶' : initialsFor(displayName);
  return (
    <span
      className="inline-grid place-items-center rounded-full font-bold"
      style={{
        width: size, height: size,
        ...style,
        fontSize: size < 28 ? 11 : 12,
      }}
      aria-label={displayName}
    >
      {initials}
    </span>
  );
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
