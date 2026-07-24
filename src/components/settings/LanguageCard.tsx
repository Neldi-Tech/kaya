'use client';

// Settings → Language. Everyone picks their own language (or follows the
// family default); parents also set the family default (what helpers + kids
// see unless they choose otherwise). English is always the fallback.
// Backed by lib/i18n + useLocale.

import { useEffect, useState, type ReactNode } from 'react';
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

  // SET PR1 (M2) — optimistic highlight: the tapped tile lights up
  // immediately; the live profile subscription then confirms it. `undefined`
  // = no pending pick, `null` = Auto pending.
  const [pendingMine, setPendingMine] = useState<Locale | null | undefined>(undefined);
  const [pendingFamily, setPendingFamily] = useState<Locale | undefined>(undefined);
  useEffect(() => { setPendingMine(undefined); }, [profile?.languagePref]);
  useEffect(() => { setPendingFamily(undefined); }, [family?.primaryLanguage]);

  const myPref = pendingMine !== undefined
    ? (pendingMine ?? undefined)                                  // undefined = follow family
    : asLocale(profile?.languagePref);
  const familySet = pendingFamily ?? asLocale(family?.primaryLanguage); // undefined = derive from country
  const familyEffective = familySet ?? localeForCountry(family?.location?.country);
  const [busy, setBusy] = useState(false);

  const pickMine = async (loc: Locale | null) => {
    if (!profile?.uid || busy) return;
    setBusy(true);
    setPendingMine(loc);
    try {
      await setUserLocale(profile.uid, loc);
      // A parent's concrete pick is the family's language too — kids follow
      // it (the family-default control below stays for explicit overrides).
      if (isParent && loc && profile.familyId) {
        setPendingFamily(loc);
        await setFamilyLocale(profile.familyId, loc);
        await refresh?.();
      }
    } catch { setPendingMine(undefined); } finally { setBusy(false); }
  };
  const pickFamily = async (loc: Locale) => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    setPendingFamily(loc);
    try { await setFamilyLocale(profile.familyId, loc); await refresh?.(); }
    catch { setPendingFamily(undefined); } finally { setBusy(false); }
  };

  // Kid-friendly version: two big flag tiles, one tap to switch, and an
  // "Auto — follow my family" line. Same data (their own languagePref).
  if (profile?.role === 'kid') {
    const effective = myPref ?? familyEffective;
    return (
      <div id="language" className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🌍</span>
          <h2 className="font-display text-lg font-extrabold">My language</h2>
        </div>
        <p className="text-[12.5px] text-kaya-sand mb-3">
          Kaya speaks your family&apos;s language. Want your own? Tap it!
        </p>
        <div className="flex gap-2.5 mb-2">
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              disabled={busy}
              onClick={() => pickMine(l.code)}
              className={`flex-1 rounded-2xl border-2 py-3 px-2 text-center transition ${
                effective === l.code
                  ? 'border-kaya-gold bg-kaya-gold-light'
                  : 'border-kaya-warm-dark/50 bg-white hover:border-kaya-gold'
              }`}
            >
              <div className="text-2xl">{l.flag}</div>
              <div className="font-bold text-[13px] mt-0.5">{l.native}</div>
              <div className="text-[10px] text-kaya-sand font-bold">
                {effective === l.code
                  ? (myPref === l.code ? 'my choice ✓' : 'family’s choice ✓')
                  : 'tap to switch'}
              </div>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || myPref === undefined}
          onClick={() => pickMine(null)}
          className={`text-[11.5px] font-bold ${myPref === undefined ? 'text-kaya-sand' : 'text-kaya-gold-dark hover:underline'}`}
        >
          {myPref === undefined
            ? `✨ Following your family’s language (${localeLabel(familyEffective)})`
            : '✨ Back to Auto — follow my family'}
        </button>
      </div>
    );
  }

  return (
    <div id="language" className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 mb-4">
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
            👶 Kids follow this unless they pick their own. 🧹 Helpers get the local
            language (<b>{localeLabel(localeForCountry(family?.location?.country))}</b>) by
            default — they can change it on their phone.
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
