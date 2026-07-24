'use client';

// Settings → Language. Everyone picks their own language (or follows the
// family default); parents also set the family default (what helpers + kids
// see unless they choose otherwise). English is always the fallback.
// Backed by lib/i18n + useLocale.

import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { SUPPORTED_LOCALES, localeForCountry, localeLabel, asLocale, type Locale } from '@/lib/i18n';
import { setUserLocale, setFamilyLocale, setMemberLanguageDefault } from '@/lib/useLocale';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';

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

export default function LanguageCard({ bare = false }: { bare?: boolean } = {}) {
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

  // SET PR2 (M6) — board data: kids from the live family context; helpers +
  // family members fetched once (users docs are family-readable, so we can
  // honestly show "own choice ✓" for kids and helpers).
  const kids = useFamily().children;
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  const [memberPrefs, setMemberPrefs] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    listHelpers(profile.familyId).then(setHelpers).catch(() => setHelpers([]));
    getFamilyMembers(profile.familyId).then((members: UserProfile[]) => {
      const map: Record<string, string | undefined> = {};
      for (const m of members) {
        map[`uid:${m.uid}`] = m.languagePref;
        if (m.role === 'kid' && m.childId) map[`kid:${m.childId}`] = m.languagePref;
      }
      setMemberPrefs(map);
    }).catch(() => {});
  }, [profile?.familyId, profile?.role]);

  const pickMember = async (memberKey: string, current: Locale | undefined, loc: Locale) => {
    if (!profile?.familyId || busy) return;
    setBusy(true);
    // Tapping the active chip clears the default (back to family/local).
    try { await setMemberLanguageDefault(profile.familyId, memberKey, current === loc ? null : loc); await refresh?.(); }
    finally { setBusy(false); }
  };

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

          {/* SET PR2 (M6) — the family language board: one row per kid +
              helper, showing their EFFECTIVE language + where it comes from,
              with per-person default chips. A person's own choice always
              wins; the row says so. */}
          <p className="text-[11px] font-bold uppercase tracking-wide text-kaya-sand mt-5 mb-1">
            Each person · default + who changed their own
          </p>
          <div className="divide-y divide-kaya-warm-dark/30">
            {kids.map((k) => {
              const own = asLocale(memberPrefs[`kid:${k.id}`]);
              const def = asLocale(family?.memberLanguageDefaults?.[k.id]);
              const effective = own ?? def ?? familyEffective;
              const source = own ? 'own choice ✓' : def ? 'set by you' : 'family default';
              return (
                <MemberRow
                  key={k.id}
                  emoji={k.avatarEmoji || '🧒'}
                  name={k.name}
                  effective={effective}
                  source={source}
                  current={def}
                  busy={busy}
                  onPick={(loc) => pickMember(k.id, def, loc)}
                />
              );
            })}
            {helpers.map((h) => {
              const own = asLocale(memberPrefs[`uid:${h.uid}`]);
              const def = asLocale(family?.memberLanguageDefaults?.[h.uid]);
              const localLang = localeForCountry(family?.location?.country);
              const effective = own ?? def ?? localLang;
              const source = own ? 'own choice ✓' : def ? 'set by you' : 'local default';
              return (
                <MemberRow
                  key={h.uid}
                  emoji="🧹"
                  name={`${h.displayName} (helper)`}
                  effective={effective}
                  source={source}
                  current={def}
                  busy={busy}
                  onPick={(loc) => pickMember(h.uid, def, loc)}
                />
              );
            })}
          </div>
          <p className="text-[11px] text-kaya-sand mt-2">
            A person&apos;s own pick always wins over the default — the row tells you when they&apos;ve made one.
          </p>
        </>
      )}
    </div>
  );
}

function MemberRow({ emoji, name, effective, source, current, busy, onPick }: {
  emoji: string;
  name: string;
  effective: Locale;
  source: string;
  current: Locale | undefined;
  busy: boolean;
  onPick: (loc: Locale) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <span className="w-8 h-8 rounded-full bg-kaya-warm flex items-center justify-center text-[15px] shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate">{name}</p>
        <p className="text-[11px] text-kaya-sand">{localeLabel(effective)} · {source}</p>
      </div>
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          disabled={busy}
          onClick={() => onPick(l.code)}
          title={current === l.code ? 'Tap again to clear the default' : `Default to ${l.native}`}
          className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold border transition ${
            current === l.code
              ? 'bg-kaya-gold text-white border-kaya-gold-dark'
              : 'bg-white text-kaya-chocolate border-kaya-warm-dark/60 hover:border-kaya-gold'
          }`}
        >
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
