'use client';

// Kaya · COPPA + Login — the combined auth form (clickwrap acceptance).
//
// One screen, real controls: Continue with Google → or → email/password →
// the primary CTA. The CTA tap IS the clickwrap acceptance (no checkbox) and
// is logged to the immutable audit trail via recordAcceptance(). `mode` swaps
// the copy + CTA between sign-up and login; the brand panel lives in
// <AuthShell>. Beta gating, the waitlist, and password reset are preserved as
// sub-views. The kid path ("I have a Kaya Code") is visible-but-subordinate
// on login so families on a shared device don't get lost.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { updateProfile } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile } from '@/lib/firestore';
import { getBetaConfig, joinWaitlist } from '@/lib/access';
import { recordAcceptance } from '@/lib/coppa/client';

const inputClass =
  'w-full h-12 px-3.5 bg-white border border-kaya-warm-dark rounded-kaya-sm text-[13px] text-kaya-chocolate focus:outline-none focus:border-kaya-gold focus:ring-[3px] focus:ring-kaya-gold/20 transition-shadow';
const labelClass = 'block text-[11px] font-bold uppercase tracking-[0.06em] text-kaya-sand mb-1.5';

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// Terms / Privacy links — visually distinct (gold-dark underline) so the
// clickwrap binds. Open in a new tab to preserve the half-filled form.
function Legal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="text-kaya-gold-dark font-bold underline underline-offset-2 hover:text-kaya-chocolate"
    >
      {children}
    </a>
  );
}

export default function AuthControls({ mode }: { mode: 'login' | 'signup' }) {
  const isSignUp = mode === 'signup';
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, enterGuestMode } = useAuth();
  const router = useRouter();

  const [view, setView] = useState<'form' | 'reset' | 'waitlist'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Closed beta: null while loading, then whether public sign-up is open.
  const [betaOpen, setBetaOpen] = useState<boolean | null>(null);
  const [wlName, setWlName] = useState('');
  const [wlCountry, setWlCountry] = useState('');
  const [wlDone, setWlDone] = useState(false);

  useEffect(() => {
    getBetaConfig().then((c) => setBetaOpen(c.publicSignupOpen)).catch(() => setBetaOpen(false));
  }, []);

  const handlePostLogin = async (uid: string) => {
    const profile = await getUserProfile(uid);
    if (profile?.familyId) router.push('/discover');
    else router.push('/onboarding');
  };

  const handleGoogle = async () => {
    setLoading(true);
    setError('');
    try {
      const user = await signInWithGoogle();
      // The deliberate tap IS the acceptance — log it (best-effort, never blocks).
      recordAcceptance(user, isSignUp ? 'signup' : 'login_clickwrap', isSignUp ? '/signup' : '/login');
      await handlePostLogin(user.uid);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') setError('');
      else setError((e as { message?: string })?.message || 'Google sign-in failed');
      setLoading(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isSignUp) {
        const user = await signUpWithEmail(email, password);
        if (name.trim()) {
          try {
            await updateProfile(user, { displayName: name.trim() });
          } catch {
            /* display-name is a nicety — never block sign-up on it */
          }
        }
        recordAcceptance(user, 'signup', '/signup');
        router.push('/onboarding');
      } else {
        const user = await signInWithEmail(email, password);
        recordAcceptance(user, 'login_clickwrap', '/login');
        await handlePostLogin(user.uid);
      }
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'auth/user-not-found') setError('No account found. Create one instead?');
      else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setError('Incorrect email or password.');
      else if (code === 'auth/weak-password') setError('Password must be at least 6 characters.');
      else if (code === 'auth/email-already-in-use') setError('Email already registered. Try logging in.');
      else if (code === 'auth/invalid-email') setError('That doesn’t look like a valid email.');
      else setError((e as { message?: string })?.message || 'Authentication failed.');
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'auth/user-not-found') setError('No account with that email. Create one instead.');
      else if (code === 'auth/invalid-email') setError('That doesn’t look like a valid email.');
      else setError((e as { message?: string })?.message || 'Could not send reset email.');
    }
    setLoading(false);
  };

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await joinWaitlist({ name: wlName, email, country: wlCountry || undefined });
    if (res.ok) setWlDone(true);
    else setError('Could not add you to the waitlist — please try again.');
    setLoading(false);
  };

  // ── Reset sub-view (login only) ──────────────────────────────
  if (view === 'reset') {
    return (
      <form onSubmit={handleReset} className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setView('form');
            setError('');
            setResetSent(false);
          }}
          className="text-[13px] font-semibold text-kaya-sand hover:text-kaya-chocolate flex items-center gap-1"
        >
          ← Back to log in
        </button>

        {!resetSent ? (
          <>
            <div>
              <h2 className="font-display font-extrabold text-xl text-kaya-chocolate mb-1">Reset your password</h2>
              <p className="text-[13px] text-kaya-sand">Enter the email you signed up with — we&apos;ll send a reset link.</p>
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                className={inputClass}
                placeholder="you@home.com"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full h-12 rounded-kaya bg-kaya-gold text-white font-display font-bold text-sm transition enabled:hover:bg-kaya-gold-dark disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-kaya p-4 text-center">
            <p className="text-2xl mb-1">📬</p>
            <p className="text-sm font-semibold text-green-800">Check your email</p>
            <p className="text-xs text-green-700 mt-1 leading-relaxed">
              We sent a reset link to <strong>{email}</strong>. Open it on this device to choose a new password.
            </p>
            <p className="text-[11px] text-green-700/80 mt-2 leading-relaxed">
              Don&apos;t see it? Check <strong>Spam</strong> or <strong>Promotions</strong> — the first one from Kaya often lands there.
            </p>
          </div>
        )}
      </form>
    );
  }

  // ── Waitlist sub-view (closed beta) ──────────────────────────
  if (view === 'waitlist') {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setView('form');
            setError('');
          }}
          className="text-[13px] font-semibold text-kaya-sand hover:text-kaya-chocolate flex items-center gap-1"
        >
          ← Back
        </button>

        {wlDone ? (
          <div className="bg-green-50 border border-green-200 rounded-kaya p-4 text-center">
            <p className="text-2xl mb-1">🎉</p>
            <p className="text-sm font-semibold text-green-800">You&apos;re on the list!</p>
            <p className="text-xs text-green-700 mt-1 leading-relaxed">
              We&apos;ll email <strong>{email}</strong> the moment Kaya opens up. Talk soon!
            </p>
          </div>
        ) : (
          <form onSubmit={handleWaitlist} className="space-y-4">
            <div>
              <h2 className="font-display font-extrabold text-xl text-kaya-chocolate mb-1">Get notified at launch</h2>
              <p className="text-[13px] text-kaya-sand">
                Kaya opens to more families soon. Leave your details and we&apos;ll email you when it&apos;s your turn. 💛
              </p>
            </div>
            <div>
              <label className={labelClass}>Your name</label>
              <input value={wlName} onChange={(ev) => setWlName(ev.target.value)} className={inputClass} placeholder="e.g. Amani M." required />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} className={inputClass} placeholder="you@home.com" required />
            </div>
            <div>
              <label className={labelClass}>
                Country <span className="normal-case font-normal text-kaya-sand-light">· optional</span>
              </label>
              <input value={wlCountry} onChange={(ev) => setWlCountry(ev.target.value)} className={inputClass} placeholder="e.g. Tanzania" />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-kaya bg-kaya-gold text-white font-display font-bold text-sm transition enabled:hover:bg-kaya-gold-dark disabled:opacity-50"
            >
              {loading ? 'Joining…' : 'Join the waitlist'}
            </button>
            <p className="text-center text-xs text-kaya-sand-light">We&apos;ll only email you about launching. No spam.</p>
          </form>
        )}
      </div>
    );
  }

  // ── Main combined form ───────────────────────────────────────
  return (
    <div>
      <h2 className="font-display font-extrabold text-[22px] text-kaya-chocolate mb-1">
        {isSignUp ? 'Create your account' : 'Welcome to Kaya'}
      </h2>
      <p className="text-[13px] text-kaya-sand mb-[18px]">
        {isSignUp ? (
          <>
            Already with us?{' '}
            <Link href="/login" className="text-kaya-gold-dark font-bold underline underline-offset-2 hover:text-kaya-chocolate">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{' '}
            <Link href="/signup" className="text-kaya-gold-dark font-bold underline underline-offset-2 hover:text-kaya-chocolate">
              Create an account
            </Link>
          </>
        )}
      </p>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2.5 h-12 bg-white border border-kaya-warm-dark rounded-kaya font-display font-bold text-[13px] text-kaya-chocolate hover:bg-kaya-warm transition-colors disabled:opacity-50"
      >
        <GoogleG />
        Continue with Google
      </button>

      <div className="flex items-center gap-2.5 my-3.5 text-[11px] font-semibold text-kaya-sand">
        <span className="flex-1 h-px bg-kaya-warm-dark" />
        or
        <span className="flex-1 h-px bg-kaya-warm-dark" />
      </div>

      <form onSubmit={handleEmail} className="space-y-3">
        {isSignUp && (
          <div>
            <label className={labelClass}>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Elia" autoComplete="name" />
          </div>
        )}
        <div>
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@home.com"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className={labelClass}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            minLength={6}
          />
        </div>

        {error && <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-kaya bg-kaya-gold text-white font-display font-bold text-sm transition enabled:hover:bg-kaya-gold-dark disabled:opacity-50"
        >
          {loading ? (isSignUp ? 'Creating…' : 'Signing in…') : isSignUp ? 'Create account' : 'Log in'}
        </button>
      </form>

      {/* Clickwrap — the CTA tap above is the acceptance. */}
      <p className="text-xs text-kaya-chocolate/70 leading-relaxed mt-3">
        {isSignUp ? (
          <>
            By tapping <strong>Create account</strong>, you confirm you&apos;re <strong>18+</strong> and agree to Kaya&apos;s{' '}
            <Legal href="/legal/terms">Terms</Legal> and <Legal href="/legal/privacy">Privacy Policy</Legal>. If you add a child later, you&apos;ll give
            verifiable parental consent at that moment.
          </>
        ) : (
          <>
            By tapping <strong>Log in</strong>, you agree to Kaya&apos;s <Legal href="/legal/terms">Terms</Legal> and{' '}
            <Legal href="/legal/privacy">Privacy Policy</Legal>, including your responsibility, as parent or guardian, for any child using a Kaya Code you
            create.
          </>
        )}
      </p>

      {/* Forgot password (login only). */}
      {!isSignUp && (
        <button
          type="button"
          onClick={() => {
            setView('reset');
            setError('');
            setResetSent(false);
          }}
          className="mt-3 text-xs font-semibold text-kaya-sand hover:text-kaya-chocolate"
        >
          Forgot password?
        </button>
      )}

      {/* Kid path — visible but subordinate (login only). */}
      {!isSignUp && (
        <div className="mt-4 pt-3.5 border-t border-dashed border-kaya-warm-dark flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold text-kaya-sand">Kid?</span>
          <Link
            href="/code"
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-kaya-sm bg-transparent border border-kaya-warm-dark text-kaya-chocolate font-display font-bold text-[13px] hover:bg-kaya-warm transition-colors"
          >
            I have a Kaya Code
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </Link>
        </div>
      )}

      {/* Guest try-out — only when public sign-up is open (parity with prior flow). */}
      {betaOpen && (
        <button
          type="button"
          onClick={() => {
            enterGuestMode();
            router.push('/discover');
          }}
          className="w-full text-center text-sm font-semibold text-kaya-gold-dark underline-offset-4 hover:underline mt-4"
        >
          Or try as a guest →
        </button>
      )}

      {/* Closed beta: not-invited path → waitlist. */}
      {betaOpen === false && (
        <button
          type="button"
          onClick={() => {
            setView('waitlist');
            setError('');
          }}
          className="w-full text-center text-[13px] font-semibold text-kaya-sand hover:text-kaya-chocolate mt-4"
        >
          Not invited yet? <span className="text-kaya-gold-dark">Join the waitlist →</span>
        </button>
      )}
    </div>
  );
}
