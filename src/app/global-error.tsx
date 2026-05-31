'use client';

// Root error boundary — the last line of defence.
//
// Renders ONLY when the root layout itself throws (a catastrophic error that
// the per-route (app)/error.tsx can't catch). It replaces the whole document,
// so it must render its own <html>/<body> and can't rely on the app's CSS or
// components — everything here is inline-styled and self-contained.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Kaya] global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#FFFBF5', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
          <div
            style={{
              width: '100%', maxWidth: '420px', background: '#fff', borderRadius: '20px',
              border: '1px solid rgba(15,31,68,0.10)', padding: '32px 24px', textAlign: 'center',
              boxShadow: '0 1px 3px rgba(15,31,68,0.06)',
            }}
          >
            <div style={{ fontSize: '44px' }} aria-hidden>🙈</div>
            <h1 style={{ margin: '12px 0 0', fontSize: '20px', fontWeight: 800, color: '#0F1F44' }}>
              Oops — something hiccuped
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: '14px', fontWeight: 600, color: 'rgba(15,31,68,0.65)', lineHeight: 1.4 }}>
              The app hit a snag. Head back a step or reload — nothing was lost.
            </p>
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                onClick={() => window.history.back()}
                style={{
                  width: '100%', borderRadius: '999px', border: 'none', cursor: 'pointer',
                  background: '#0F1F44', color: '#FFF7E8', padding: '11px 20px', fontSize: '14px', fontWeight: 800,
                }}
              >
                ← Go back
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => reset()}
                  style={{
                    flex: 1, borderRadius: '999px', cursor: 'pointer',
                    background: 'rgba(245,183,49,0.2)', border: '1px solid rgba(245,183,49,0.45)',
                    color: '#0F1F44', padding: '9px 16px', fontSize: '13px', fontWeight: 800,
                  }}
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => { window.location.assign('/'); }}
                  style={{
                    flex: 1, borderRadius: '999px', cursor: 'pointer',
                    background: '#fff', border: '1px solid rgba(15,31,68,0.15)',
                    color: 'rgba(15,31,68,0.7)', padding: '9px 16px', fontSize: '13px', fontWeight: 800,
                  }}
                >
                  Home
                </button>
              </div>
            </div>
            {error?.digest && (
              <p style={{ marginTop: '16px', fontSize: '10.5px', fontFamily: 'monospace', color: 'rgba(15,31,68,0.35)' }}>
                ref: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
