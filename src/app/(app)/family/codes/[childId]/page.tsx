'use client';

// Kaya · COPPA + Login — code issued + management (/family/codes/[childId]).
//
// Two states on one screen:
//   • Just issued — the plaintext (held in component state only, NEVER
//     persisted server-side) with Copy / Email / Print. Reload and it's gone;
//     the parent must Regenerate to see a new one.
//   • Returning — status (active / paused) with Pause · Resume · Revoke ·
//     Regenerate. Parents stay in full control of a child's access.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getCodeStatus, codeAction } from '@/lib/coppa/client';
import { takeFreshCode } from '@/lib/coppa/freshCode';

type Status = 'active' | 'paused' | 'revoked' | 'none' | 'loading';

export default function CodeManagePage() {
  const params = useParams<{ childId: string }>();
  const childId = params?.childId as string;
  const { user, profile } = useAuth();
  const { children } = useFamily();

  const [code, setCode] = useState<string | null>(null); // plaintext, one-time
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const child = children.find((c) => c.id === childId);
  const name = child?.name?.split(' ')[0] || 'your child';

  // On mount: pick up a one-time freshly-issued code, then load status.
  useEffect(() => {
    if (!childId) return;
    const fresh = takeFreshCode(childId);
    if (fresh?.code) setCode(fresh.code);
    if (!user) return;
    getCodeStatus(user, childId).then((r) => setStatus(r.ok ? (r.status as Status) || 'none' : 'none'));
  }, [childId, user]);

  const run = async (action: 'pause' | 'resume' | 'revoke' | 'regenerate') => {
    if (!user || busy) return;
    setBusy(true);
    const res = await codeAction(user, childId, action);
    if (res.ok) {
      if (action === 'regenerate' && res.code) { setCode(res.code); setStatus('active'); }
      else if (res.status) { setStatus(res.status as Status); if (action === 'revoke') setCode(null); }
    }
    setBusy(false);
  };

  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };
  const emailHref = code
    ? `mailto:?subject=${encodeURIComponent(`${name}'s Kaya Code`)}&body=${encodeURIComponent(`Hi! Here's ${name}'s Kaya Code to sign in at ourkaya.com/code:\n\n${code}\n\nPlease share it only with ${name} — never post it publicly.`)}`
    : undefined;

  // Parents only.
  if (profile && profile.role !== 'parent') {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <p className="text-kaya-chocolate/70 text-sm">Only a parent can manage a Kaya Code.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-5 sm:px-8 py-10 font-body text-center">
      {/* ── Just issued ─────────────────────────────────────────── */}
      {code ? (
        <>
          <div className="w-16 h-16 rounded-[18px] bg-kaya-gold flex items-center justify-center mx-auto mb-4 text-white">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1 className="font-display font-extrabold text-kaya-chocolate text-2xl mb-1.5">Done. {name}&apos;s code is ready.</h1>
          <p className="text-sm text-kaya-chocolate/60 mb-6">Share it directly with {name} — never post it publicly.</p>

          <div className="rounded-kaya border-2 border-dashed border-kaya-gold bg-kaya-gold-light/25 py-7 px-4 mb-6">
            <div className="font-display font-extrabold text-kaya-chocolate text-3xl sm:text-4xl tracking-[0.12em] print-code">{code}</div>
          </div>

          <div className="flex gap-2.5 justify-center flex-wrap mb-6">
            <button onClick={copy} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-kaya-sm bg-kaya-chocolate text-white font-semibold text-sm transition-transform active:scale-95">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <a href={emailHref} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-kaya-sm bg-white border border-kaya-gold/40 text-kaya-chocolate font-semibold text-sm hover:bg-kaya-gold-light/30">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
              Email
            </a>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-kaya-sm bg-white border border-kaya-gold/40 text-kaya-chocolate font-semibold text-sm hover:bg-kaya-gold-light/30">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
              Print
            </button>
          </div>

          <p className="text-xs text-kaya-chocolate/55">
            You can pause or revoke this code any time below.
          </p>
          <div className="flex gap-3 justify-center mt-3 no-print">
            <button onClick={() => run('pause')} disabled={busy} className="text-sm font-semibold text-kaya-chocolate/70 hover:text-kaya-chocolate disabled:opacity-50">Pause</button>
            <span className="text-kaya-chocolate/20">·</span>
            <button onClick={() => run('revoke')} disabled={busy} className="text-sm font-semibold text-red-500 hover:text-red-600 disabled:opacity-50">Revoke</button>
          </div>
        </>
      ) : (
        /* ── Returning / management ──────────────────────────────── */
        <div className="no-print">
          <h1 className="font-display font-extrabold text-kaya-chocolate text-2xl mb-1.5">{name}&apos;s Kaya Code</h1>

          {status === 'loading' && <p className="text-sm text-kaya-chocolate/50 mt-6">Loading…</p>}

          {status === 'active' && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700 bg-green-50 rounded-full px-3 py-1 mt-2 mb-4">● Active</span>
              <p className="text-sm text-kaya-chocolate/60 mb-6 max-w-sm mx-auto">For {name}&apos;s security, a code is shown only once. Regenerate to get a fresh one to share.</p>
              <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
                <button onClick={() => run('regenerate')} disabled={busy} className="h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm enabled:hover:bg-kaya-gold-dark enabled:hover:text-white disabled:opacity-50">{busy ? 'Working…' : 'Regenerate code'}</button>
                <button onClick={() => run('pause')} disabled={busy} className="h-11 rounded-kaya bg-white border border-kaya-gold/40 text-kaya-chocolate font-semibold text-sm hover:bg-kaya-gold-light/30 disabled:opacity-50">Pause</button>
                <button onClick={() => run('revoke')} disabled={busy} className="h-11 rounded-kaya bg-white border border-red-200 text-red-500 font-semibold text-sm hover:bg-red-50 disabled:opacity-50">Revoke</button>
              </div>
            </>
          )}

          {status === 'paused' && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 rounded-full px-3 py-1 mt-2 mb-4">❚❚ Paused</span>
              <p className="text-sm text-kaya-chocolate/60 mb-6 max-w-sm mx-auto">{name} can&apos;t sign in while the code is paused. Resume to let them back in.</p>
              <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
                <button onClick={() => run('resume')} disabled={busy} className="h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm enabled:hover:bg-kaya-gold-dark enabled:hover:text-white disabled:opacity-50">{busy ? 'Working…' : 'Resume code'}</button>
                <button onClick={() => run('revoke')} disabled={busy} className="h-11 rounded-kaya bg-white border border-red-200 text-red-500 font-semibold text-sm hover:bg-red-50 disabled:opacity-50">Revoke</button>
              </div>
            </>
          )}

          {(status === 'none' || status === 'revoked') && (
            <>
              <p className="text-sm text-kaya-chocolate/60 mt-3 mb-6 max-w-sm mx-auto">{name} doesn&apos;t have an active Kaya Code. Create one to let them sign in.</p>
              <div className="flex flex-col gap-2.5 max-w-xs mx-auto">
                <button onClick={() => run('regenerate')} disabled={busy} className="h-12 rounded-kaya bg-kaya-gold text-kaya-chocolate font-display font-extrabold text-sm enabled:hover:bg-kaya-gold-dark enabled:hover:text-white disabled:opacity-50">{busy ? 'Working…' : 'Generate a code'}</button>
                <Link href="/family/add-child" className="text-sm font-semibold text-kaya-chocolate/60 hover:text-kaya-chocolate">Add a different child →</Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
