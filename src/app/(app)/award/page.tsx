'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { giveAward, getFamilyMembers } from '@/lib/firestore';
import { DEFAULT_EARNING_METHODS } from '@/lib/earningMethods';
import { notifyAward } from '@/lib/notify';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const CATEGORIES = [
  { id: 'kindness',       icon: '💖', label: 'Kindness' },
  { id: 'helping',        icon: '🤝', label: 'Helping Others' },
  { id: 'bravery',        icon: '🦁', label: 'Bravery' },
  { id: 'learning',       icon: '📚', label: 'Learning' },
  { id: 'creativity',     icon: '🎨', label: 'Creativity' },
  { id: 'teamwork',       icon: '⭐', label: 'Teamwork' },
  { id: 'responsibility', icon: '🎯', label: 'Responsibility' },
  { id: 'other',          icon: '✨', label: 'Other' },
];

const REGULAR_POINTS = [1, 2, 3, 5, 5];
const DIAMOND_POINTS = [3, 4, 5, 6, 7, 8, 9, 10];

export default function AwardPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();

  // Families can disable Diamond points from Settings → "How kids earn points".
  // Honour that preference here; otherwise fall back to the Phase-1 default.
  const earningMethods = family?.earningMethods ?? DEFAULT_EARNING_METHODS;
  const diamondEnabled = earningMethods.includes('diamond');

  // Multi-select: parents often want to award a shared moment ("you all
  // helped grandma carry the groceries") to several kids in one go.
  const [selectedChildren, setSelectedChildren] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [isDiamond, setIsDiamond] = useState(false);
  const [regularPts, setRegularPts] = useState(3);
  const [diamondPts, setDiamondPts] = useState(5);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  // Snapshot of who received the award — used by the success screen so it
  // stays accurate even after the form resets.
  const [awardedNames, setAwardedNames] = useState<string[]>([]);

  // If a family disables Diamond mid-flow, fall back to regular points so we
  // never submit a diamond award the family said they don't use.
  const diamondActive = isDiamond && diamondEnabled;
  const finalPoints = diamondActive ? diamondPts : regularPts;
  const selectedKidObjs = children.filter((c) => selectedChildren.includes(c.id));
  // Preview shows the first selected kid's avatar; if multiple, the title
  // line says "EarlnathanIrisha + 2 others".
  const child = selectedKidObjs[0] || null;
  const cat = CATEGORIES.find((c) => c.id === category) || null;
  const canSubmit = !!(selectedChildren.length > 0 && category && reason.trim() && !saving);

  const toggleChild = (id: string) => {
    setSelectedChildren((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleAward = async () => {
    if (!profile?.familyId || selectedChildren.length === 0 || !category || !reason.trim()) return;
    setSaving(true);
    // Submit one award per selected kid in parallel — each kid's points,
    // activity feed and badge thresholds are independent so we can't batch
    // a single write.
    await Promise.all(
      selectedChildren.map((childId) =>
        giveAward(profile.familyId, {
          childId,
          points: finalPoints,
          reason: reason.trim(),
          category: diamondActive ? `diamond-${category}` : category,
          awardedBy: profile.uid,
          awardedByName: profile.displayName,
        } as any),
      ),
    );
    setAwardedNames(selectedKidObjs.map((c) => c.name));
    setSuccess(true);
    setSaving(false);

    // Fire-and-forget email notification per kid (so each kid's parents/helpers
    // see the awardee name in the email subject).
    (async () => {
      if (selectedKidObjs.length === 0) return;
      const members = await getFamilyMembers(profile.familyId);
      const recipients = members
        .filter((m) => m.uid !== profile.uid && m.email && m.role !== 'kid')
        .filter((m) => m.notifyOnAward !== false) // default true
        .map((m) => m.email);
      for (const c of selectedKidObjs) {
        notifyAward({
          to: recipients,
          childName: c.name,
          actorName: profile.displayName,
          points: finalPoints,
          reason: reason.trim(),
          isDiamond: diamondActive,
        });
      }
    })();

    setTimeout(() => {
      setSuccess(false);
      setAwardedNames([]);
      setSelectedChildren([]); setCategory(''); setIsDiamond(false);
      setRegularPts(3); setDiamondPts(5); setReason('');
    }, 2500);
  };

  // "Daniella, Diella & Earlnathan" / "Daniella & Diella" / "Daniella"
  const formatNames = (names: string[]): string => {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  };

  if (success) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 pt-16 lg:pt-24 text-center animate-slide-up">
        <div className="text-6xl lg:text-7xl mb-4">{isDiamond ? '💎' : '🎉'}</div>
        <h2 className="font-display text-2xl lg:text-3xl font-black mb-2">
          {awardedNames.length > 1 ? 'Points Awarded to All!' : 'Points Awarded!'}
        </h2>
        <p className="text-kaya-sand text-sm lg:text-base">
          {formatNames(awardedNames)} received{' '}
          <span className="text-kaya-gold font-bold">
            +{finalPoints} {isDiamond ? 'diamond ' : ''}points{awardedNames.length > 1 ? ' each' : ''}
          </span>{' '}
          for {reason}
        </p>
      </div>
    );
  }

  // ── Field components used by both layouts ─────────────────
  // Multi-select chips: tap to add/remove. A small ✓ overlay confirms
  // selection state on already-selected kids.
  const KidPicker = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
    <>
      <div className={size === 'lg' ? 'grid grid-cols-2 gap-2' : 'flex gap-2 flex-wrap'}>
        {children.map((c) => {
          const sel = selectedChildren.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggleChild(c.id)}
              aria-pressed={sel}
              className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-kaya-sm border-2 transition-all ${
                sel ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
              }`}
              style={sel ? { backgroundColor: c.houseColor } : {}}
            >
              <span className="text-base">{c.avatarEmoji}</span>
              <span className="text-sm font-bold">{c.name}</span>
              {sel && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-[10px] font-black">✓</span>
              )}
            </button>
          );
        })}
      </div>
      {children.length > 1 && (
        <p className="text-[10px] text-kaya-sand-light mt-2">
          Tap each kid you want to award. They&apos;ll all get the same points and message.
          {selectedChildren.length > 0 && children.length > selectedChildren.length && (
            <button
              onClick={() => setSelectedChildren(children.map((c) => c.id))}
              className="ml-2 text-kaya-gold font-semibold hover:underline"
            >
              Select all
            </button>
          )}
          {selectedChildren.length > 0 && (
            <button
              onClick={() => setSelectedChildren([])}
              className="ml-2 text-kaya-sand font-semibold hover:underline"
            >
              Clear
            </button>
          )}
        </p>
      )}
    </>
  );

  const CategoryGrid = ({ cols = 4 }: { cols?: 4 | 8 }) => (
    <div className={cols === 8 ? 'grid grid-cols-4 lg:grid-cols-8 gap-2' : 'grid grid-cols-4 gap-2'}>
      {CATEGORIES.map((c) => {
        const sel = category === c.id;
        return (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`flex flex-col items-center gap-1 p-3 rounded-kaya-sm border transition-all ${
              sel ? 'border-kaya-gold bg-kaya-gold/5 shadow-sm' : 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
            }`}
          >
            <span className="text-xl">{c.icon}</span>
            <span className="text-[10px] font-semibold text-kaya-sand leading-tight text-center">{c.label}</span>
          </button>
        );
      })}
    </div>
  );

  const TypeToggle = () => (
    <div className="flex gap-2">
      <button
        onClick={() => setIsDiamond(false)}
        className={`flex-1 h-10 rounded-kaya-sm font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${
          !isDiamond ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
        }`}
      >⭐ Regular</button>
      <button
        onClick={() => setIsDiamond(true)}
        className={`flex-1 h-10 rounded-kaya-sm font-bold text-sm flex items-center justify-center gap-1.5 transition-all ${
          isDiamond ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'bg-kaya-warm text-kaya-sand'
        }`}
      >💎 Diamond</button>
    </div>
  );

  const PointsPicker = () => (
    !isDiamond ? (
      <div className="flex gap-2">
        {REGULAR_POINTS.map((p, i) => (
          <button
            key={`${p}-${i}`}
            onClick={() => setRegularPts(p)}
            className={`flex-1 h-12 rounded-kaya-sm font-bold transition-all ${
              regularPts === p ? 'bg-kaya-gold text-white shadow-md shadow-kaya-gold/30' : 'bg-white border border-kaya-warm-dark text-kaya-sand'
            }`}
          >+{p}</button>
        ))}
      </div>
    ) : (
      <>
        <div className="grid grid-cols-4 gap-2">
          {DIAMOND_POINTS.map((p) => (
            <button
              key={p}
              onClick={() => setDiamondPts(p)}
              className={`h-11 rounded-kaya-sm font-bold transition-all ${
                diamondPts === p ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30' : 'bg-white border border-kaya-warm-dark text-kaya-sand'
              }`}
            >+{p}</button>
          ))}
        </div>
        <p className="text-xs text-purple-600 font-semibold mt-2">💎 Diamond points — parents decide the bonus for exceptional behavior.</p>
      </>
    )
  );

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-5">
          <h1 className="font-display text-2xl font-black">Award Points</h1>
          <p className="text-kaya-sand text-sm">Recognize great behavior with bonus points</p>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Who deserves points?</label>
          <KidPicker />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">What for?</label>
          <CategoryGrid />
        </div>

        {diamondEnabled && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Points type</label>
            <TypeToggle />
          </div>
        )}

        <div className="mb-5">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">{isDiamond ? 'Diamond points (3–10)' : 'How many points?'}</label>
          <PointsPicker />
        </div>

        <div className="mb-6">
          <label className="block text-xs font-semibold text-kaya-sand mb-2 uppercase tracking-wider">Tell them why (they&apos;ll see this!)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-24 px-4 py-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            placeholder="e.g. You helped your sister with homework without being asked!"
          />
        </div>

        <button
          onClick={handleAward}
          disabled={!canSubmit}
          className={`w-full h-[52px] rounded-kaya font-bold text-sm disabled:opacity-40 transition-colors ${
            isDiamond ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-kaya-gold hover:bg-kaya-gold-dark text-white'
          }`}
        >
          {saving
            ? 'Awarding…'
            : `Award +${finalPoints} Points ${selectedChildren.length > 1 ? `to ${selectedChildren.length} kids ` : ''}${isDiamond ? '💎' : '🎖️'}`}
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — form left, live preview right                */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Award points</h1>
            <p className="text-sm text-kaya-sand mt-1">Catch a kindness. Recognise the wins, big and small.</p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* Form column */}
          <section className="col-span-8 space-y-6">
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">Who deserves points?</p>
              <KidPicker size="lg" />
            </div>

            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">What for?</p>
              <CategoryGrid cols={8} />
            </div>

            <div className={diamondEnabled ? 'grid grid-cols-2 gap-6' : ''}>
              {diamondEnabled && (
                <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-6">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">Points type</p>
                  <TypeToggle />
                </div>
              )}
              <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">
                  {isDiamond ? 'Diamond points (3–10)' : 'How many points?'}
                </p>
                <PointsPicker />
              </div>
            </div>

            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-3">Tell them why (they&apos;ll see this)</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 bg-kaya-cream/60 border border-kaya-warm-dark rounded-kaya-sm text-sm resize-none focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                placeholder="e.g. You helped your sister with homework without being asked!"
              />
            </div>
          </section>

          {/* Preview column */}
          <aside className="col-span-4">
            <div className="sticky top-20 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand px-1">Preview</p>

              <div
                className={`rounded-kaya-lg p-6 text-white shadow-xl ${
                  isDiamond
                    ? 'bg-gradient-to-br from-purple-600 to-purple-800 shadow-purple-600/20'
                    : 'bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light shadow-kaya-chocolate/20'
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  {child ? (
                    <KidAvatar child={child} size="lg" shape="square" bgOpacity="40" />
                  ) : (
                    <div className="w-12 h-12 rounded-[14px] bg-white/10 flex items-center justify-center text-xl">👤</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">For</p>
                    <p className="font-display font-bold text-lg truncate">
                      {selectedKidObjs.length === 0
                        ? 'Pick a child'
                        : selectedKidObjs.length === 1
                          ? selectedKidObjs[0].name
                          : `${selectedKidObjs[0].name} + ${selectedKidObjs.length - 1} other${selectedKidObjs.length > 2 ? 's' : ''}`}
                    </p>
                  </div>
                  {isDiamond && <span className="text-2xl">💎</span>}
                </div>

                <div className="flex items-baseline gap-2 mb-4">
                  <span className="font-display font-black text-6xl">+{finalPoints}</span>
                  <span className="text-sm opacity-70">
                    {isDiamond ? 'diamond pts' : 'points'}{selectedKidObjs.length > 1 ? ' each' : ''}
                  </span>
                </div>

                <div className="border-t border-white/15 pt-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="text-base">{cat?.icon || '✨'}</span>
                    <span className="opacity-80">{cat?.label || 'Pick a category'}</span>
                  </div>
                  <p className="text-[13px] leading-relaxed opacity-90 italic">
                    {reason ? `"${reason}"` : <span className="opacity-60 not-italic">Your message will appear here…</span>}
                  </p>
                  <p className="text-[10px] opacity-50 pt-1">From {profile?.displayName || 'You'}</p>
                </div>
              </div>

              <button
                onClick={handleAward}
                disabled={!canSubmit}
                className={`w-full h-[52px] rounded-kaya font-bold text-sm disabled:opacity-40 transition-colors ${
                  isDiamond ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-kaya-gold hover:bg-kaya-gold-dark text-white'
                }`}
              >
                {saving
                  ? 'Awarding…'
                  : `Award +${finalPoints} ${isDiamond ? 'diamond ' : ''}points${selectedChildren.length > 1 ? ` to ${selectedChildren.length} kids` : ''}`}
              </button>

              <p className="text-[11px] text-kaya-sand-light px-1 leading-relaxed">
                Awards land in {selectedKidObjs.length > 1 ? 'each kid’s' : (child?.name ? `${child.name}’s` : 'their')} activity feed and family score immediately.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
