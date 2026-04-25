'use client';

import { useRouter } from 'next/navigation';

interface BackButtonProps {
  label?: string;
  href?: string;
  onClick?: () => void;
}

export default function BackButton({ label = 'Dashboard', href = '/dashboard', onClick }: BackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push(href);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 text-kaya-sand text-sm font-semibold mb-3 -ml-0.5 group"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="group-hover:-translate-x-0.5 transition-transform"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </button>
  );
}
