'use client';

// 🔐 My privacy (SET PR4 · M14) — the KID's self-view. Shows ONLY their own
// world: their active login channels, a change-my-password that works through
// their own email, their language choice, and which emails they receive.
// Never renders anything about siblings, helpers, or parents (approved v2).

import { useState } from 'react';
import Link from 'next/link';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { localeLabel, localeForCountry, asLocale } from '@/lib/i18n';

export default function KidPrivacyCard() {
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();
  const me = kids.find((k) => k.id === profile?.childId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile || profile.role !== 'kid' || !me) return null;

  const emailActive = !!me.email && !!me.loginEnabled;
  const myLocale = asLocale(profile.languagePref)
    ?? asLocale(family?.memberLanguageDefaults?.[me.id])
    ?? asLocale(family?.primaryLanguage)
    ?? localeForCountry(family?.location?.country);
  const langSource = profile.languagePref ? 'my choice ✓' : 'family’s choice';
  const prefs = family?.kidEmailUpdates?.[me.id];
  const emailsIGet = [prefs?.rewards && '🏅 rewards', prefs?.digest && '🌞 morning digest', prefs?.statement && '📜 statements']
    .filter(Boolean).join(' · ') || 'none right now';
  const mustChange = (profile as { mustChangePassword?: boolean }).mustChangePassword === true;

  const changeMyPassword = async () => {
    if (!me.email || busy) return;
    setBusy(true);
    try { await sendPasswordResetEmail(auth, me.email); setMsg(`✓ A change-password link is on its way to ${me.email}.`); }
    catch { setMsg('Could not send the link — ask a parent for help.'); }
    finally { setBusy(false); }
  };

  const label = 'text-[11px] font-bold uppercase tracking-wide text-kaya-sand';

  return (
    <div id="privacy" className="scroll-mt-24 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">🔐</span>
        <h2 className="font-display text-lg font-extrabold">My privacy</h2>
      </div>
      <p className="text-[12.5px] text-kaya-sand mb-3">Your logins and your choices — just yours.</p>

      {mustChange && (
        <p className="text-[12px] font-bold rounded-kaya-sm px-3 py-2 mb-3 bg-kaya-gold-light text-kaya-chocolate">
          🔑 A parent gave you a temporary password — please set your own now.
        </p>
      )}
      {msg && <p className="text-[12px] font-bold rounded-kaya-sm px-3 py-2 mb-3 bg-[#E7F5EC] text-pantry-leaf-dk">{msg}</p>}

      <p className={label}>My logins</p>
      <div className="flex items-center gap-2.5 py-2 border-b border-dashed border-kaya-warm-dark/60">
        <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">✉️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold">Email</p>
          <p className="text-[11px] text-kaya-sand truncate">{emailActive ? `${me.email} · active` : 'not set up — a parent can add it'}</p>
        </div>
        {emailActive && (
          <button type="button" disabled={busy} onClick={changeMyPassword}
            className="px-2.5 py-1.5 rounded-kaya-sm border border-kaya-warm-dark text-[11.5px] font-extrabold hover:border-kaya-gold transition disabled:opacity-50">
            Change my password
          </button>
        )}
      </div>
      <div className="flex items-center gap-2.5 py-2">
        <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">🔑</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold">Kaya Code</p>
          <p className="text-[11px] text-kaya-sand">active · ask a parent for a new one</p>
        </div>
      </div>

      <p className={`${label} mt-3`}>My choices</p>
      <div className="flex items-center gap-2.5 py-2 border-b border-dashed border-kaya-warm-dark/60">
        <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">🌍</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold">My language</p>
          <p className="text-[11px] text-kaya-sand">{localeLabel(myLocale)} · {langSource}</p>
        </div>
        <Link href="/settings#language" className="px-2.5 py-1.5 rounded-kaya-sm border border-kaya-warm-dark text-[11.5px] font-extrabold hover:border-kaya-gold transition no-underline text-kaya-chocolate">Change</Link>
      </div>
      <div className="flex items-center gap-2.5 py-2">
        <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">📬</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold">Emails I get</p>
          <p className="text-[11px] text-kaya-sand">{emailsIGet}</p>
        </div>
      </div>

      <p className="text-[11px] text-kaya-sand mt-2">🛡 Your parents manage the rest — nothing about anyone else shows here.</p>
    </div>
  );
}
