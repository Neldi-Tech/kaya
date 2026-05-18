'use client';

// In-app confirm dialog (2026-05-18) — replaces the browser-native
// `confirm()` everywhere. Native confirm jumps out of our visual
// system, looks like a security warning (especially in Chrome with
// "www.ourkaya.com says"), and on iOS Safari it's modal at the system
// level which feels off-brand. This provider mounts one dialog at the
// (app) layout level and exposes an imperative async API:
//
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: 'Delete this draft?',
//     message: "This can't be undone.",
//     confirmLabel: 'Delete',
//     tone: 'danger',
//   });
//   if (!ok) return;
//
// Designed to read as a drop-in for `if (!window.confirm(...)) return;`
// so the sweep across the codebase is mechanical.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ConfirmOptions {
  /** Big bold question at the top of the dialog. Required. */
  title: string;
  /** Body copy under the title. Optional but recommended for context
   *  ("This can't be undone." / "Past entries are kept." / etc.) */
  message?: string;
  /** Primary button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone for the primary button. 'danger' = rose (destructive
   *  actions like delete / remove / regenerate). 'default' = leaf
   *  (constructive). */
  tone?: 'default' | 'danger';
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Imperative confirm. Returns a Promise<boolean>. The provider mounts
 *  the actual dialog UI; this hook just exposes the trigger. */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    // Fail soft — if used outside the provider, fall back to native
    // confirm so the call site still functions. Should never happen
    // in practice (provider is mounted at the (app) layout).
    return async (opts) =>
      typeof window !== 'undefined'
        ? window.confirm(`${opts.title}${opts.message ? `\n\n${opts.message}` : ''}`)
        : false;
  }
  return fn;
}

/** Provider — mount once at the app shell. Tracks the currently-open
 *  confirm (if any) and the resolver waiting on it. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<{
    opts: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setPending({ opts, resolve })),
    []
  );

  const close = useCallback((ok: boolean) => {
    setPending((cur) => {
      if (cur) cur.resolve(ok);
      return null;
    });
  }, []);

  // Escape closes (= cancel); Enter confirms.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          opts={pending.opts}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

// ── Dialog component ────────────────────────────────────────────
// Visual style mirrors the existing AccessPickerSheet/PhotoLightbox
// modal pattern (fixed inset-0 + backdrop). Centered card on desktop,
// bottom-sheet-ish on mobile. Backdrop click cancels.
function ConfirmDialog({
  opts, onCancel, onConfirm,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tone = opts.tone ?? 'default';
  const primaryCls = tone === 'danger'
    ? 'bg-hive-rose hover:bg-hive-rose/90 text-white'
    : 'bg-pantry-leaf hover:bg-pantry-leaf-dk text-white';
  return (
    <div className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center p-3 lg:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-hive-ink/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />
      {/* Card */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative bg-hive-paper rounded-hive-lg border border-hive-line shadow-xl w-full max-w-md p-5 lg:p-6"
      >
        <h2 id="confirm-title" className="font-nunito font-black text-lg lg:text-xl text-hive-ink leading-snug">
          {opts.title}
        </h2>
        {opts.message && (
          <p className="text-sm text-hive-muted mt-2 leading-relaxed">
            {opts.message}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-hive border border-hive-line bg-hive-paper text-hive-ink font-nunito font-bold text-sm hover:bg-hive-cream"
          >
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2.5 rounded-hive font-nunito font-black text-sm ${primaryCls}`}
          >
            {opts.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
