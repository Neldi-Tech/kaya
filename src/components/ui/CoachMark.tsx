'use client';

// CoachMark — single-use first-visit popover for Kaya Core pages.
// Shows once per (uid, pageId), persisted in localStorage so the next
// load skips it forever. Floating bottom-center; click "Got it" or
// anywhere on the popover to dismiss.

import { useEffect, useState } from 'react';

type Props = {
  /** Stable id per page — used for the localStorage key. */
  pageId: 'rate' | 'award' | 'rewards' | 'meetings' | 'hive' | 'moments';
  /** The signed-in user's uid — scopes the storage key per user. */
  uid: string;
  /** Heading caption (one short line). */
  title: string;
  /** Body caption (one or two short sentences). */
  body: string;
};

const storageKey = (pageId: string, uid: string) =>
  `kaya.coachMark.${pageId}.${uid}`;

export default function CoachMark({ pageId, uid, title, body }: Props) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!uid) return;
    try {
      const seen = window.localStorage.getItem(storageKey(pageId, uid));
      if (seen !== '1') setShow(true);
    } catch {
      /* private mode — silently skip */
    }
  }, [pageId, uid]);

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey(pageId, uid), '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(440px,calc(100vw-32px))] safe-bottom"
      role="dialog"
      aria-live="polite"
      aria-label={title}
    >
      <div className="bg-brand-navy text-white rounded-2xl px-4 py-3.5 shadow-[0_20px_50px_rgba(15,24,34,0.30)] flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0">💡</span>
        <div className="flex-1 min-w-0">
          <div className="font-display font-extrabold text-[14px] text-brand-honey-soft mb-0.5 leading-tight">
            {title}
          </div>
          <p className="text-[13px] text-white/90 leading-relaxed">{body}</p>
          <button
            type="button"
            onClick={dismiss}
            className="bg-brand-honey hover:bg-brand-honey-dk text-brand-navy text-[11.5px] font-extrabold px-3 py-1.5 rounded-full mt-2.5 transition-colors"
          >
            Got it ✓
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-white/60 hover:text-white text-base px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
