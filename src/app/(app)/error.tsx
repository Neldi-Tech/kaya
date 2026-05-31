'use client';

// App-wide error boundary for everything under the (app) shell.
//
// Next.js renders this in place of a route segment whenever a client-side
// exception is thrown while rendering it — instead of the bare white
// "Application error: a client-side exception has occurred" screen. The app
// shell (nav) stays mounted around this, and we give the user reliable
// escapes so they can ALWAYS get back a step without reloading the whole app:
//   • Go back   → router.back() (the common case — a page hiccuped on entry)
//   • Try again → reset() re-renders the segment (recovers transient errors)
//   • Reload    → last-resort hard refresh
//
// Kept dependency-light on purpose: an error boundary must not import the
// same app components that might be implicated in the crash.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Surface to the console for debugging (digest ties to server logs).
    console.error('[Kaya] route error:', error);
  }, [error]);

  return (
    <div className="min-h-[70vh] grid place-items-center px-5 py-10">
      <div className="w-full max-w-md rounded-kaya bg-white border border-pulse-navy/10 shadow-sm px-6 py-8 text-center">
        <div className="text-5xl" aria-hidden>🙈</div>
        <h1 className="mt-3 font-display text-xl font-extrabold text-pulse-navy">
          Oops — something hiccuped
        </h1>
        <p className="mt-2 text-sm font-semibold text-pulse-navy/65 leading-snug">
          This page hit a snag. Nothing was lost — just head back a step or try again.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-full rounded-full bg-pulse-navy px-5 py-2.5 font-display font-extrabold text-pulse-cream hover:bg-pulse-navy/90 transition-colors text-sm"
          >
            ← Go back
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="flex-1 rounded-full bg-pulse-gold/20 border border-pulse-gold/45 px-4 py-2 font-display font-extrabold text-pulse-navy hover:bg-pulse-gold/30 transition-colors text-[13px]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => { window.location.reload(); }}
              className="flex-1 rounded-full bg-white border border-pulse-navy/15 px-4 py-2 font-display font-extrabold text-pulse-navy/70 hover:bg-pulse-navy/5 transition-colors text-[13px]"
            >
              Reload
            </button>
          </div>
        </div>

        {error?.digest && (
          <p className="mt-4 text-[10.5px] font-mono text-pulse-navy/35">ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
