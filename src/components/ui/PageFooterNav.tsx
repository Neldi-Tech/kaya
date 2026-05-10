'use client';

// Visible bottom-of-page navigation: a two-button box with ← Back
// and 🏠 Kaya Home. Mobile-only — the desktop sidebar already keeps
// these affordances persistently visible. AppShell injects this at
// the end of {children} on every route except the role's home, so a
// user who has scrolled to the bottom of a long page can tap back
// or home without scrolling back up to the top header.
//
// Renders inline with content (not fixed) so it doesn't compete
// with the bottom nav / section tab bars for screen real estate.

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PageFooterNav({ homePath }: { homePath: string }) {
  const router = useRouter();
  return (
    <div className="lg:hidden mt-8 px-4">
      <div className="mx-auto max-w-md">
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-kaya-sand mb-2">
          Navigate
        </p>
        <div className="grid grid-cols-2 gap-2 bg-white border-2 border-kaya-warm-dark rounded-kaya p-2 shadow-sm">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back to previous page"
            className="flex items-center justify-center gap-2 h-12 rounded-kaya-sm bg-kaya-cream border border-kaya-warm-dark/60 text-kaya-chocolate font-display font-extrabold text-[14px] hover:bg-kaya-warm transition-colors active:scale-[0.98]"
          >
            <span className="text-base leading-none">←</span>
            <span>Back</span>
          </button>
          <Link
            href={homePath}
            aria-label="Go to Kaya home"
            className="flex items-center justify-center gap-2 h-12 rounded-kaya-sm bg-kaya-chocolate text-white font-display font-extrabold text-[14px] hover:bg-kaya-chocolate-light transition-colors active:scale-[0.98] no-underline"
          >
            <span className="text-base leading-none">🏠</span>
            <span>Kaya Home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
