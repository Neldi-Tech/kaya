'use client';

// Settings → Language. Everyone picks their own language (or follows the
// family default); parents also set the family default (what helpers + kids
// see unless they choose otherwise). English is always the fallback.
// Backed by lib/i18n + useLocale.

import { useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { SUPPORTED_LOCALES, localeForCountry, localeLabel, asLocale, type Locale } from '@/lib/i18n';
import { setUserLocale, setFamilyLocale } from '@/lib/useLocale';

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-2 rounded-full text-[13px] font-bold border transition ${
        active ? 'bg-kaya-gold text-kaya-chocolate border-kaya-gold' : 'bg-white text-kaya-chocolate border-kaya-warm-dark/60 hover:border-kaya-gold'
      }`}
    >
      {children}
    </button>
  );
}

export default function LanguageCard() {
  const { profile } = useAuth();
  const { family, refresh } = useFamily();
  const isParent = profile?.role === 'parent';

  const myPref = asLocale(profile?.languagePref);                 // undefined = follow family
  const familySet = asLocale(family?.primaryLanguage);            // undefined = derive from country
  const familyEffective = familySet ?? localeForCountry(family?.location?.country);
  const [busy, setBusy] = useState(false);

  const pickMine = async (loc: Locale | null) => {
    if (!profile?.uid || busy) return;
    setBusy(true);
    try { await setUserLocale(profile.uid, loc); } finally { setBusy(false); }
  };
  const pickFamily = async (loc: Locale) => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    try { await setFamilyLocale(profile.familyId, loc); await refresh?.(); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">🌍</span>
        <h2 className="font-display text-lg font-extrabold">Language</h2>
      </div>
      <p className="text-[12.5px] text-kaya-sand mb-4">
        English is always available; anything not yet translated shows in English. More languages roll out over time.
      </p>

      {/* Your own language */}
      <p className="text-[11px] font-bold uppercase tracking-wide text-kaya-sand mb-2">Your language</p>
      <div className="flex flex-wrap gap-2 mb-1">
        <Choice active={myPref === undefined} onClick={() => pickMine(null)}>
          ✨ Auto · {localeLabel(familyEffective)}
        </Choice>
        {SUPPORTED_LOCALES.map((l) => (
          <Choice key={l.code} active={myPref === l.code} onClick={() => pickMine(l.code)}>
            {l.flag} {l.native}
          </Choice>
        ))}
      </div>
      <p className="text-[11px] text-kaya-sand mb-4">“Auto” follows your family&apos;s language.</p>

      {/* Family default (parents) */}
      {isParent && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-kaya-sand mb-2">Family default language</p>
          <p className="text-[11.5px] text-kaya-sand mb-2">
            What everyone (incl. helpers) sees unless they pick their own.
            {!familySet && <> Currently auto from your country: <b>{localeLabel(familyEffective)}</b>.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_LOCALES.map((l) => (
              <Choice key={l.code} active={familySet === l.code} onClick={() => pickFamily(l.code)}>
                {l.flag} {l.native}
              </Choice>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
