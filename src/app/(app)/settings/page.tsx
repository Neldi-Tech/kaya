'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  updateFamily, updateUserProfile, addChild, ensureReferralCode,
  getReferredFamilies, Family, PointsMode,
} from '@/lib/firestore';
import {
  TIERS, FOUNDING_FAMILY_LIMIT, tierFor, nextTier, progressToNext,
  effectiveCount, referralLink,
} from '@/lib/referral';
import BackButton from '@/components/ui/BackButton';

export default function SettingsPage() {
  const router = useRouter();
  const { user, profile, signOut, refreshProfile, isGuest } = useAuth();
  const { family, children, refresh } = useFamily();

  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const [pointsMode, setPointsMode] = useState<PointsMode>(family?.pointsMode || 'full');

  // Display name editor
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  // Referral panel
  const [referralCode, setReferralCode] = useState<string>('');
  const [referredFamilies, setReferredFamilies] = useState<Family[]>([]);
  const [refLinkCopied, setRefLinkCopied] = useState(false);

  useEffect(() => {
    if (family?.pointsMode) setPointsMode(family.pointsMode);
  }, [family?.pointsMode]);

  // Load (or backfill) referral code + list of referred families.
  useEffect(() => {
    if (!family) return;
    (async () => {
      const code = await ensureReferralCode(family);
      setReferralCode(code);
      const list = await getReferredFamilies(family.id);
      setReferredFamilies(list);
    })();
  }, [family]);

  const directCount = family?.referralCount ?? referredFamilies.length;
  const compoundCount = family?.compoundCredit ?? 0;
  const currentTier = tierFor(directCount, compoundCount);
  const next = nextTier(directCount, compoundCount);
  const progressPct = Math.round(progressToNext(directCount, compoundCount) * 100);
  const totalCredit = effectiveCount(directCount, compoundCount);
  const fullRefLink = referralCode ? referralLink(referralCode) : '';

  const copyRefLink = () => {
    if (!fullRefLink) return;
    navigator.clipboard.writeText(fullRefLink);
    setRefLinkCopied(true);
    setTimeout(() => setRefLinkCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    if (!fullRefLink) return;
    const text = encodeURIComponent(
      `I'm using Kaya to make our family routines feel less like nagging — give it a try, both our families get a bonus: ${fullRefLink}`,
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareEmail = () => {
    if (!fullRefLink) return;
    const subject = encodeURIComponent('Try Kaya — both our families get a bonus');
    const body = encodeURIComponent(
      `I'm using Kaya to track our family routines, points and weekly meetings. If you sign up with my link, both our families unlock a bonus house color:\n\n${fullRefLink}`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const startEditingName = () => {
    setNameInput(profile?.displayName || '');
    setNameError('');
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError('');
  };

  const saveName = async () => {
    if (!user || isGuest) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty');
      return;
    }
    if (trimmed === profile?.displayName) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError('');
    try {
      await updateUserProfile(user.uid, { displayName: trimmed });
      await refreshProfile();
      setEditingName(false);
    } catch (e: any) {
      setNameError(e.message || 'Failed to save');
    }
    setSavingName(false);
  };

  const copyInviteCode = () => {
    if (!family?.inviteCode) return;
    navigator.clipboard.writeText(family.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddChild = async () => {
    if (!profile?.familyId || !newChildName.trim()) return;
    setAddingChild(true);
    const colors = ['#D4A017', '#7B9DB7', '#9B8EC4', '#C0392B', '#27AE60', '#2980B9'];
    const emojis = ['🏅', '🤍', '🥈', '❤️', '💚', '💙'];
    const idx = children.length % colors.length;

    await addChild(profile.familyId, {
      name: newChildName.trim(),
      houseName: `House ${children.length + 1}`,
      houseColor: colors[idx],
      avatarEmoji: emojis[idx],
      totalPoints: 0,
      weeklyPoints: 0,
      streak: 0,
      badges: [],
    } as any);
    setNewChildName('');
    setAddingChild(false);
    await refresh();
  };

  const handlePointsMode = async (mode: PointsMode) => {
    if (!profile?.familyId) return;
    setPointsMode(mode);
    await updateFamily(profile.familyId, { pointsMode: mode } as any);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const isParent = profile?.role === 'parent';

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Settings</h1>
      </div>

      {/* Profile card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-lg text-white font-black shrink-0">
            {profile?.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="space-y-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full h-9 px-3 bg-kaya-cream rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="Your display name"
                  autoFocus
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') cancelEditingName();
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveName}
                    disabled={savingName}
                    className="h-8 px-3 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
                  >
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditingName}
                    disabled={savingName}
                    className="h-8 px-3 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                  >
                    Cancel
                  </button>
                </div>
                {nameError && <p className="text-red-500 text-xs">{nameError}</p>}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm truncate">{profile?.displayName || 'You'}</p>
                  {!isGuest && (
                    <button
                      onClick={startEditingName}
                      className="text-[11px] text-kaya-gold font-semibold hover:underline shrink-0"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-kaya-sand truncate">{profile?.email}</p>
                <p className="text-xs font-semibold capitalize" style={{ color: '#D4A017' }}>{profile?.role}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Family name */}
      {family && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-1">Family</p>
          <p className="font-bold">{family.name}</p>
          {family.isFoundingFamily && (
            <p className="text-[11px] font-bold text-kaya-gold mt-1.5">👑 Founding Family · lifetime badge</p>
          )}
        </div>
      )}

      {/* ── Invite friends (referral campaign) ───────────────── */}
      {isParent && family && (
        <div className="mb-4">
          <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-5 mb-2 relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-display font-black text-4xl">{totalCredit}</span>
                <span className="text-xs text-kaya-sand-light">
                  {totalCredit === 1 ? 'family referred' : 'families referred'}
                </span>
              </div>
              <p className="text-[12px] text-kaya-sand-light leading-relaxed mb-3">
                {next
                  ? <>You&apos;re a <span className="text-kaya-gold font-bold">{TIERS.find(t => t.tier === currentTier)?.name}</span> · {next.remaining} more to unlock <span className="font-bold text-white">{TIERS.find(t => t.tier === next.tier)?.name}</span>.</>
                  : <>You&apos;re a <span className="text-kaya-gold font-bold">Champion</span> — top tier reached.</>
                }
              </p>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mb-1.5">
                <div className="h-full bg-kaya-gold rounded-full transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-white/60">
                <span>1 · Friend</span><span>3 · Tribe</span><span>10 · Champion</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-2">
            <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-2">Your referral link</p>
            <div className="flex items-center gap-2 bg-kaya-warm/40 rounded-kaya-sm p-2 border border-kaya-warm-dark mb-3">
              <code className="flex-1 px-1 text-[11px] font-mono text-kaya-chocolate truncate">{fullRefLink || 'Generating…'}</code>
              <button
                onClick={copyRefLink}
                disabled={!fullRefLink}
                className="h-8 px-3 bg-kaya-chocolate text-white rounded-kaya-sm text-xs font-bold whitespace-nowrap disabled:opacity-40"
              >
                {refLinkCopied ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={shareWhatsApp}
                disabled={!fullRefLink}
                className="h-9 px-3 bg-[#25D366]/10 text-[#128C7E] rounded-kaya-sm text-xs font-bold flex items-center gap-1.5 hover:bg-[#25D366]/20 disabled:opacity-40"
              >
                💬 WhatsApp
              </button>
              <button
                onClick={shareEmail}
                disabled={!fullRefLink}
                className="h-9 px-3 bg-kaya-warm/60 rounded-kaya-sm text-xs font-bold text-kaya-chocolate flex items-center gap-1.5 hover:bg-kaya-warm disabled:opacity-40"
              >
                ✉️ Email
              </button>
            </div>
          </div>

          <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden mb-2">
            {TIERS.filter(t => t.tier !== 'none').map((tier) => {
              const unlocked = totalCredit >= tier.threshold;
              const isCurrent = tier.tier === currentTier;
              return (
                <div
                  key={tier.tier}
                  className={`px-4 py-3 flex items-center gap-3 border-b last:border-b-0 border-kaya-warm-dark ${
                    isCurrent ? 'bg-kaya-gold/5' : ''
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                      unlocked
                        ? 'bg-kaya-gold text-white'
                        : 'bg-kaya-warm/60 border-2 border-dashed border-kaya-sand text-kaya-sand'
                    }`}
                  >
                    {unlocked ? '✓' : tier.threshold}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <p className="font-bold text-[13px]">{tier.name}</p>
                      <span className={`text-[10px] font-bold uppercase ${unlocked ? 'text-kaya-gold' : 'text-kaya-sand'}`}>
                        {unlocked ? 'Unlocked' : `${tier.threshold - totalCredit} to go`}
                      </span>
                    </div>
                    <p className="text-[11px] text-kaya-sand leading-snug">{tier.perk}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-kaya-warm/40 border border-kaya-warm-dark rounded-kaya p-3 flex items-start gap-3 mb-2">
            <div className="w-8 h-8 rounded-[10px] bg-kaya-gold-light flex items-center justify-center text-sm shrink-0">🌱</div>
            <div className="text-[11px] leading-relaxed text-kaya-chocolate">
              <p className="font-bold">Compounding credit</p>
              <p className="text-kaya-sand">When a family <em>you</em> referred goes on to refer another, you earn an extra credit.{compoundCount > 0 && ` You have ${compoundCount} so far.`}</p>
            </div>
          </div>

          {referredFamilies.length > 0 && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
              <div className="px-4 py-3 border-b border-kaya-warm-dark">
                <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Families you&apos;ve referred</p>
              </div>
              {referredFamilies.map((f) => (
                <div key={f.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-kaya-gold-light flex items-center justify-center text-sm shrink-0">🏡</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{f.name}</p>
                  </div>
                  <span className="text-[10px] font-bold text-kaya-gold uppercase">+1 credit</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite code */}
      {isParent && family && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Invite Code</p>
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="text-xs text-kaya-gold font-semibold"
            >
              {showInvite ? 'Hide' : 'Show'}
            </button>
          </div>
          {showInvite && (
            <div className="flex items-center gap-3">
              <p className="text-2xl font-mono font-bold tracking-[0.3em] flex-1">{family.inviteCode}</p>
              <button
                onClick={copyInviteCode}
                className="px-4 py-2 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
              >
                {copied ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>
          )}
          <p className="text-xs text-kaya-sand mt-2">Share this code with helpers or family members to join</p>
        </div>
      )}

      {/* Points Mode */}
      {isParent && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Points Mode</p>
          <div className="space-y-2">
            {[
              { value: 'full' as PointsMode, label: 'Full Points', desc: 'Show all points and rankings' },
              { value: 'badges-only' as PointsMode, label: 'Badges Only', desc: 'Focus on badges, hide point numbers' },
              { value: 'encouragement' as PointsMode, label: 'Encouragement', desc: 'No competition, positive reinforcement only' },
            ].map((mode) => (
              <button
                key={mode.value}
                onClick={() => handlePointsMode(mode.value)}
                className={`w-full text-left p-3 rounded-kaya-sm border-2 transition-all ${
                  pointsMode === mode.value
                    ? 'border-kaya-gold bg-kaya-gold/5'
                    : 'border-kaya-warm-dark'
                }`}
              >
                <p className="text-sm font-semibold">{mode.label}</p>
                <p className="text-xs text-kaya-sand">{mode.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add child */}
      {isParent && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Children</p>
          <div className="space-y-2 mb-3">
            {children.map((child) => (
              <div key={child.id} className="flex items-center gap-2 text-sm">
                <span>{child.avatarEmoji}</span>
                <span className="font-medium">{child.name}</span>
                <span className="text-xs text-kaya-sand">— {child.houseName}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newChildName}
              onChange={(e) => setNewChildName(e.target.value)}
              className="flex-1 h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              placeholder="Add a child..."
            />
            <button
              onClick={handleAddChild}
              disabled={!newChildName.trim() || addingChild}
              className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-sm font-bold disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Navigation links */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden mb-4">
        {[
          { label: 'Kid Profiles', path: '/profiles', icon: '👧' },
          { label: 'Reports', path: '/reports', icon: '📊' },
          { label: 'Badges', path: '/badges', icon: '🏆' },
        ].map((item, i) => (
          <button
            key={item.path}
            onClick={() => router.push(item.path)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-kaya-cream transition-colors ${
              i > 0 ? 'border-t border-kaya-warm-dark' : ''
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm font-medium flex-1">{item.label}</span>
            <span className="text-kaya-sand text-sm">→</span>
          </button>
        ))}
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full h-11 bg-red-50 text-red-500 rounded-kaya text-sm font-semibold hover:bg-red-100 transition-colors mb-8"
      >
        Sign Out
      </button>
    </div>
  );
}
