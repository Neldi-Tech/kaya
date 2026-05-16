'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Timestamp } from 'firebase/firestore';
import {
  createUserProfile, createFamily, addChild, findFamilyByInviteCode,
  findChildByEmail, getFamily, updateUserProfile, Role, Family, Child,
} from '@/lib/firestore';

const HOUSE_PRESETS = [
  { name: 'Golden House', color: '#D4A017', emoji: '🏅' },
  { name: 'White House', color: '#7B9DB7', emoji: '🤍' },
  { name: 'Silver House', color: '#9B8EC4', emoji: '🥈' },
  { name: 'Ruby House', color: '#C0392B', emoji: '❤️' },
  { name: 'Emerald House', color: '#27AE60', emoji: '💚' },
  { name: 'Sapphire House', color: '#2980B9', emoji: '💙' },
];

interface ChildDraft {
  name: string;
  houseName: string;
  houseColor: string;
  avatarEmoji: string;
}

export default function OnboardingPage() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role>('parent');
  const [familyMode, setFamilyMode] = useState<'create' | 'join'>('create');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [children, setChildren] = useState<ChildDraft[]>([
    { name: '', houseName: 'Golden House', houseColor: '#D4A017', avatarEmoji: '🏅' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Email-match link flow: if this user's email is already on a child profile
  // with loginEnabled=true, skip the whole "create family / join family" wizard
  // and offer a one-click link.
  const [matched, setMatched] = useState<{ family: Family; child: Child } | null>(null);
  const [matchChecking, setMatchChecking] = useState(true);

  useEffect(() => {
    if (!user?.email) { setMatchChecking(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const m = await findChildByEmail(user.email!);
        if (!m) { if (!cancelled) setMatchChecking(false); return; }
        const fam = await getFamily(m.familyId);
        if (!cancelled && fam) setMatched({ family: fam, child: m.child });
      } catch {}
      if (!cancelled) setMatchChecking(false);
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const handleLinkAsKid = async () => {
    if (!user || !matched) return;
    setLoading(true); setError('');
    try {
      await createUserProfile({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || matched.child.name,
        photoURL: user.photoURL || undefined,
        role: 'kid',
        familyId: matched.family.id,
        childId: matched.child.id,
        createdAt: Timestamp.now(),
      });
      await refreshProfile();
      router.push('/kid');
    } catch (e: any) {
      setError(e?.message || 'Failed to link your account');
    }
    setLoading(false);
  };

  const addChildRow = () => {
    const next = HOUSE_PRESETS[children.length % HOUSE_PRESETS.length];
    setChildren([...children, { name: '', houseName: next.name, houseColor: next.color, avatarEmoji: next.emoji }]);
  };

  const updateChildRow = (idx: number, field: keyof ChildDraft, value: string) => {
    const updated = [...children];
    updated[idx] = { ...updated[idx], [field]: value };
    setChildren(updated);
  };

  const removeChildRow = (idx: number) => {
    if (children.length <= 1) return;
    setChildren(children.filter((_, i) => i !== idx));
  };

  const selectHouse = (idx: number, preset: typeof HOUSE_PRESETS[0]) => {
    const updated = [...children];
    updated[idx] = { ...updated[idx], houseName: preset.name, houseColor: preset.color, avatarEmoji: preset.emoji };
    setChildren(updated);
  };

  const handleFinish = async () => {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      let familyId: string;

      if (familyMode === 'create') {
        const pendingRef = typeof window !== 'undefined'
          ? window.localStorage.getItem('kaya.ref') || undefined
          : undefined;
        familyId = await createFamily(
          familyName || `${user.displayName}'s Family`,
          user.uid,
          pendingRef,
        );
        if (pendingRef && typeof window !== 'undefined') {
          window.localStorage.removeItem('kaya.ref');
        }

        // Add children
        for (const child of children) {
          if (!child.name.trim()) continue;
          await addChild(familyId, {
            name: child.name.trim(),
            houseName: child.houseName,
            houseColor: child.houseColor,
            avatarEmoji: child.avatarEmoji,
            totalPoints: 0,
            weeklyPoints: 0,
            streak: 0,
            badges: [],
          } as any);
        }
      } else {
        const found = await findFamilyByInviteCode(inviteCode);
        if (!found) {
          setError('Invalid invite code. Please check and try again.');
          setLoading(false);
          return;
        }
        familyId = found.id;
      }

      // Create user profile
      await createUserProfile({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || familyName,
        photoURL: user.photoURL || undefined,
        role,
        familyId,
        createdAt: Timestamp.now(),
      });

      await refreshProfile();
      router.push('/');
    } catch (e: any) {
      setError(e.message || 'Something went wrong');
    }
    setLoading(false);
  };

  const canAdvance = () => {
    if (step === 2 && familyMode === 'create' && !familyName.trim()) return false;
    if (step === 2 && familyMode === 'join' && !inviteCode.trim()) return false;
    if (step === 3 && familyMode === 'create' && !children.some((c) => c.name.trim())) return false;
    return true;
  };

  // ── Email-match short-circuit ──────────────────────────────
  // If the parent has already added this kid (with their email + login enabled),
  // skip the wizard entirely and offer a single-click link.
  if (matchChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kaya-cream">
        <p className="text-kaya-sand text-sm">Checking your invitation…</p>
      </div>
    );
  }
  if (matched) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-kaya-cream px-6">
        <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-7 max-w-md w-full text-center shadow-sm">
          <div className="text-5xl mb-3">👋</div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight mb-1">Welcome back, {matched.child.name}!</h1>
          <p className="text-sm text-kaya-sand mb-6 leading-relaxed">
            <strong className="text-kaya-chocolate">{matched.family.name}</strong> already set up a profile for you. Tap below to link your account and see your points, badges, and rewards.
          </p>
          <div className="flex items-center justify-center gap-3 mb-6 bg-kaya-cream/60 border border-kaya-warm-dark rounded-kaya-sm p-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
              style={{ backgroundColor: matched.child.houseColor + '20' }}
            >
              {matched.child.avatarEmoji}
            </div>
            <div className="text-left">
              <p className="font-bold text-sm">{matched.child.name}</p>
              <p className="text-[11px] text-kaya-sand">{matched.child.houseName} House · {matched.family.name}</p>
            </div>
          </div>
          {error && <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2 mb-4">{error}</p>}
          <button
            onClick={handleLinkAsKid}
            disabled={loading}
            className="w-full h-[52px] bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
          >
            {loading ? 'Linking…' : `Link me to ${matched.family.name}`}
          </button>
          <button
            onClick={() => setMatched(null)}
            className="w-full mt-3 text-xs text-kaya-sand hover:text-kaya-chocolate font-semibold"
          >
            Not me — start a fresh family instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-kaya-cream">
      {/* Progress bar */}
      <div className="px-6 pt-6">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-kaya-sand mt-3 font-medium">Step {step} of 4</p>
      </div>

      <div className="flex-1 px-6 pt-6 pb-8">
        {/* Step 1: Role */}
        {step === 1 && (
          <div>
            <h2 className="font-display text-2xl font-black mb-1">Welcome to Kaya!</h2>
            <p className="text-kaya-sand text-sm mb-8">What's your role in the family?</p>

            <div className="space-y-3">
              {[
                { value: 'parent' as Role, icon: '👨‍👩‍👧‍👦', label: 'Parent', desc: 'Full access: rate, award, manage family' },
                { value: 'helper' as Role, icon: '🤝', label: 'Helper', desc: 'Rate daily routines for the children' },
                { value: 'kid' as Role, icon: '⭐', label: 'Kid', desc: 'View your points, badges & rewards' },
              ].map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className={`w-full flex items-center gap-4 p-4 rounded-kaya border-2 transition-all text-left ${
                    role === r.value
                      ? 'border-kaya-gold bg-kaya-gold/5 shadow-sm'
                      : 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
                  }`}
                >
                  <span className="text-2xl">{r.icon}</span>
                  <div>
                    <p className="font-bold text-sm">{r.label}</p>
                    <p className="text-xs text-kaya-sand">{r.desc}</p>
                  </div>
                  {role === r.value && (
                    <span className="ml-auto text-kaya-gold text-lg">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Family */}
        {step === 2 && (
          <div>
            <h2 className="font-display text-2xl font-black mb-1">
              {role === 'kid' ? 'Join your family' : 'Set up your family'}
            </h2>
            <p className="text-kaya-sand text-sm mb-6">
              {role === 'kid'
                ? 'Ask your parent for the family invite code'
                : 'Create a new family or join an existing one'}
            </p>

            {role !== 'kid' && (
              <div className="flex gap-2 mb-6">
                {(['create', 'join'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setFamilyMode(m)}
                    className={`flex-1 h-10 rounded-kaya-sm text-sm font-semibold transition-colors ${
                      familyMode === m
                        ? 'bg-kaya-chocolate text-white'
                        : 'bg-kaya-warm text-kaya-sand'
                    }`}
                  >
                    {m === 'create' ? 'Create New' : 'Join Existing'}
                  </button>
                ))}
              </div>
            )}

            {familyMode === 'create' && role !== 'kid' ? (
              <div>
                <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">
                  Family Name
                </label>
                <input
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  className="w-full h-12 px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="e.g. The Timotheo Family"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-kaya-sand mb-1.5 uppercase tracking-wider">
                  Invite Code
                </label>
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  className="w-full h-12 px-4 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm tracking-[0.3em] font-mono text-center uppercase focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="ABC123"
                  maxLength={6}
                />
                <p className="text-xs text-kaya-sand mt-2">Ask a parent for this code from their Settings screen</p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Children (only for family creators) */}
        {step === 3 && (
          <div>
            {familyMode === 'create' && role !== 'kid' ? (
              <>
                <h2 className="font-display text-2xl font-black mb-1">Add your children</h2>
                <p className="text-kaya-sand text-sm mb-6">Each child gets their own house</p>

                <div className="space-y-4">
                  {children.map((child, idx) => (
                    <div key={idx} className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                          style={{ backgroundColor: child.houseColor + '20' }}
                        >
                          {child.avatarEmoji}
                        </div>
                        <input
                          value={child.name}
                          onChange={(e) => updateChildRow(idx, 'name', e.target.value)}
                          className="flex-1 h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                          placeholder="Child's name"
                        />
                        {children.length > 1 && (
                          <button
                            onClick={() => removeChildRow(idx)}
                            className="text-kaya-sand hover:text-red-400 text-lg"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-kaya-sand mb-2 font-medium">Choose a house:</p>
                      <div className="flex gap-2 flex-wrap">
                        {HOUSE_PRESETS.map((preset) => (
                          <button
                            key={preset.name}
                            onClick={() => selectHouse(idx, preset)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                              child.houseName === preset.name
                                ? 'border-transparent text-white shadow-sm'
                                : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
                            }`}
                            style={child.houseName === preset.name ? { backgroundColor: preset.color } : {}}
                          >
                            {preset.emoji} {preset.name.replace(' House', '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addChildRow}
                  className="w-full mt-4 h-11 border-2 border-dashed border-kaya-warm-dark rounded-kaya text-sm font-semibold text-kaya-sand hover:border-kaya-gold hover:text-kaya-gold transition-colors"
                >
                  + Add Another Child
                </button>
              </>
            ) : (
              <div className="text-center pt-10">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="font-display text-2xl font-black mb-2">Almost there!</h2>
                <p className="text-kaya-sand text-sm">
                  Review your details and finish setup
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Confirmation */}
        {step === 4 && (
          <div className="text-center pt-6">
            <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-4xl mb-6 shadow-lg">
              🎉
            </div>
            <h2 className="font-display text-2xl font-black mb-2">All set!</h2>
            <p className="text-kaya-sand text-sm mb-8 max-w-[280px] mx-auto">
              {familyMode === 'create'
                ? `${familyName || 'Your family'} is ready. You've added ${children.filter((c) => c.name.trim()).length} children.`
                : "You're about to join the family!"}
            </p>

            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 text-left mb-6">
              <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Summary</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-kaya-sand">Your role</span>
                  <span className="font-semibold capitalize">{role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-kaya-sand">Family</span>
                  <span className="font-semibold">{familyMode === 'create' ? familyName || 'My Family' : `Code: ${inviteCode}`}</span>
                </div>
                {familyMode === 'create' && (
                  <div className="flex justify-between">
                    <span className="text-kaya-sand">Children</span>
                    <span className="font-semibold">
                      {children.filter((c) => c.name.trim()).map((c) => c.name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-xs bg-red-50 rounded-kaya-sm px-3 py-2 mb-4">{error}</p>
            )}
          </div>
        )}
      </div>

      {/* Bottom navigation */}
      <div className="px-6 pb-8 flex gap-3">
        {step > 1 && (
          <button
            onClick={() => setStep(step - 1)}
            className="h-[52px] px-6 bg-kaya-warm rounded-kaya font-semibold text-sm text-kaya-sand"
          >
            Back
          </button>
        )}

        {step < 4 ? (
          <button
            onClick={() => {
              // Skip step 3 for joiners/kids
              if (step === 2 && (familyMode === 'join' || role === 'kid')) {
                setStep(4);
              } else {
                setStep(step + 1);
              }
            }}
            disabled={!canAdvance()}
            className="flex-1 h-[52px] bg-kaya-gold text-white rounded-kaya font-bold text-sm disabled:opacity-40 hover:bg-kaya-gold-dark transition-colors"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleFinish}
            disabled={loading}
            className="flex-1 h-[52px] bg-kaya-chocolate text-white rounded-kaya font-bold text-sm disabled:opacity-50"
          >
            {loading ? 'Setting up...' : "Let's Go! 🚀"}
          </button>
        )}
      </div>
    </div>
  );
}
