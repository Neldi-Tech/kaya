'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/contexts/AuthContext';
import { getUserProfile } from '@/lib/firestore';

export default function AuthControls() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, enterGuestMode } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'welcome' | 'email' | 'reset'>('welcome');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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
    if (profile?.familyId) router.push('/dashboard');
    else router.push('/onboarding');
  };

  const handleGoogleCredential = async (idToken: string) => {
    setLoading(true); setError('');
    try {
      const user = await signInWithGoogle(idToken);
      await handlePostLogin(user.uid);
    } catch (e: any) {
      setError(e.message || 'Google sign-in failed');
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
        <div className="flex justify-center [&>div]:!w-full [&_iframe]:!w-full">
          <GoogleLogin
            onSuccess={(credentialResponse) => {
              if (!credentialResponse.credential) {
                setError('Google sign-in failed: no credential returned');
                return;
              }
              handleGoogleCredential(credentialResponse.credential);
            }}
            onError={() => setError('Google sign-in failed')}
            theme="outline"
            size="large"
            text="continue_with"
            shape="rectangular"
            width="320"
          />
        </div>

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

        <button
          type="button"
          onClick={() => { enterGuestMode(); router.push('/dashboard'); }}
          className="w-full text-center text-sm font-semibold text-kaya-chocolate underline-offset-4 hover:underline pt-2"
        >
          Or try as a guest →
        </button>
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

      <button
        type="button"
        onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
        className="w-full text-center text-sm text-kaya-gold font-medium"
      >
        {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
      </button>

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
