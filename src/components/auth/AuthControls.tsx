'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile } from '@/lib/firestore';
import { getBetaConfig, joinWaitlist } from '@/lib/access';

export default function AuthControls() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, enterGuestMode } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'welcome' | 'email' | 'reset' | 'waitlist'>('welcome');
  const [isSignUp, setIsSignUp] = useState(false);
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

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    const res = await joinWaitlist({ name: wlName, email, country: wlCountry || undefined });
    if (res.ok) setWlDone(true);
    else setError('Could not add you to the waitlist — please try again.');
    setLoading(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') setError('No account with that email. Try signing up instead.');
      else if (e.code === 'auth/invalid-email') setError('That doesn’t look like a valid email.');
      else setError(e.message || 'Could not send reset email');
    }
    setLoading(false);
  };

  const handlePostLogin = async (uid: string) => {
    const profile = await getUserProfile(uid);
    if (profile?.familyId) router.push('/');
    else router.push('/onboarding');
  };

  const handleGoogle = async () => {
    setLoading(true); setError('');
    try {
      const user = await signInWithGoogle();
      await handlePostLogin(user.uid);
    } catch (e: any) {
      // Common case: user closes the popup mid-flow.
      if (e?.code === 'auth/popup-closed-by-user') setError('');
      else setError(e?.message || 'Google sign-in failed');
    }
    setLoading(false);
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
        router.push('/onboarding');
      } else {
        const user = await signInWithEmail(email, password);
        await handlePostLogin(user.uid);
      }
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') setError('No account found. Sign up instead?');
      else if (e.code === 'auth/wrong-password') setError('Incorrect password');
      else if (e.code === 'auth/weak-password') setError('Password must be at least 6 characters');
      else if (e.code === 'auth/email-already-in-use') setError('Email already registered. Try signing in.');
      else setError(e.message || 'Authentication failed');
    }
    setLoading(false);
  };

  if (mode === 'welcome') {
    return (
      <div className="space-y-3">
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 h-[52px] bg-white border border-kaya-warm-dark rounded-kaya font-semibold text-sm hover:bg-kaya-warm transition-colors disabled:opacity-50"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>

        <button
          onClick={() => setMode('email')}
          className="w-full h-[52px] bg-kaya-chocolate text-white rounded-kaya font-semibold text-sm hover:bg-kaya-chocolate-light transition-colors"
        >
          Continue with Email
        </button>

        <p className="text-center text-xs text-kaya-sand pt-2">
          By continuing you agree to our Terms of Service
        </p>

        <div className="text-center pt-3 mt-1 border-t border-kaya-warm-dark">
          <p className="text-xs text-kaya-sand-light">
            📱 Phone & WhatsApp login coming soon
          </p>
        </div>

        {betaOpen && (
          <button
            type="button"
            onClick={() => { enterGuestMode(); router.push('/'); }}
            className="w-full text-center text-sm font-semibold text-kaya-chocolate underline-offset-4 hover:underline pt-2"
          >
            Or try as a guest →
          </button>
        )}

        {betaOpen === false && (
          <div className="bg-white border border-dashed border-kaya-gold rounded-kaya p-3.5 text-center mt-1">
            <p className="text-sm font-bold">Not invited yet? 🌱</p>
            <p className="text-xs text-kaya-sand mt-0.5 mb-2.5">Kaya&apos;s in closed beta. Get a heads-up the moment we open.</p>
            <button
              type="button"
              onClick={() => { setMode('waitlist'); setError(''); }}
              className="w-full h-11 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
            >
              Join the waitlist →
            </button>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'email') return (
    <form onSubmit={handleEmail} className="space-y-3">
      <button
        type="button"
        onClick={() => { setMode('welcome'); setError(''); }}
        className="text-sm text-kaya-sand mb-2 flex items-center gap-1"
      >
        ← Back
      </button>

      <div>
        <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
          placeholder="you@example.com"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
          placeholder="••••••••"
          required
          minLength={6}
        />
      </div>

      {error && (
        <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full h-[52px] bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
      >
        {loading ? 'Please wait…' : isSignUp ? 'Create Account' : 'Sign In'}
      </button>

      {betaOpen && (
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
          className="w-full text-center text-sm text-kaya-gold font-medium"
        >
          {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
        </button>
      )}

      {!isSignUp && (
        <button
          type="button"
          onClick={() => { setMode('reset'); setError(''); setResetSent(false); }}
          className="w-full text-center text-xs text-kaya-sand hover:text-kaya-chocolate"
        >
          Forgot password?
        </button>
      )}
    </form>
  );

  // ── Waitlist mode (closed beta) ────────────────────────────
  if (mode === 'waitlist') return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => { setMode('welcome'); setError(''); }}
        className="text-sm text-kaya-sand mb-2 flex items-center gap-1"
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
        <form onSubmit={handleWaitlist} className="space-y-3">
          <div>
            <h3 className="font-display font-extrabold text-lg tracking-tight mb-1">Get notified at launch</h3>
            <p className="text-xs text-kaya-sand">Kaya opens to more families soon. Leave your details and we&apos;ll email you when it&apos;s your turn. 💛</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">Your name</label>
            <input
              value={wlName}
              onChange={(e) => setWlName(e.target.value)}
              className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
              placeholder="e.g. Amani M."
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">
              Country <span className="normal-case font-normal text-kaya-sand-light">· optional</span>
            </label>
            <input
              value={wlCountry}
              onChange={(e) => setWlCountry(e.target.value)}
              className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
              placeholder="e.g. Tanzania"
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-[52px] bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Joining…' : 'Join the waitlist'}
          </button>
          <p className="text-center text-xs text-kaya-sand-light">We&apos;ll only email you about launching. No spam.</p>
        </form>
      )}
    </div>
  );

  // ── Reset mode ─────────────────────────────────────────────
  return (
    <form onSubmit={handleReset} className="space-y-3">
      <button
        type="button"
        onClick={() => { setMode('email'); setError(''); setResetSent(false); }}
        className="text-sm text-kaya-sand mb-2 flex items-center gap-1"
      >
        ← Back to sign in
      </button>

      {!resetSent ? (
        <>
          <div>
            <h3 className="font-display font-extrabold text-lg tracking-tight mb-1">Reset your password</h3>
            <p className="text-xs text-kaya-sand">Enter the email you signed up with — we'll send a reset link.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-[48px] px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 focus:border-kaya-gold"
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          {error && (
            <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full h-[52px] bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
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
          <button
            type="button"
            onClick={() => { setMode('email'); setError(''); setResetSent(false); }}
            className="mt-3 text-xs text-green-800 font-semibold underline-offset-4 hover:underline"
          >
            Back to sign in
          </button>
        </div>
      )}
    </form>
  );
}
