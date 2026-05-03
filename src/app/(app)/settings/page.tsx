'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  updateFamily, updateUserProfile, addChild, ensureReferralCode,
  getReferredFamilies, isHandleAvailable, Family, PointsMode,
} from '@/lib/firestore';
import {
  normalizeHandle, handleErrorMessage, suggestFamilyHandles,
  formatFamilyHandle, handleToSlug,
} from '@/lib/handles';
import { fileToAvatarDataUrl } from '@/lib/imageUpload';
import { useRef } from 'react';
import {
  TIERS, tierFor, nextTier, progressToNext,
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

  // Personal handle editor
  const [editingMyHandle, setEditingMyHandle] = useState(false);
  const [myHandleInput, setMyHandleInput] = useState('');
  const [myHandleError, setMyHandleError] = useState('');
  const [savingMyHandle, setSavingMyHandle] = useState(false);

  const startEditingMyHandle = () => {
    setMyHandleInput(profile?.handle || '');
    setMyHandleError('');
    setEditingMyHandle(true);
  };

  const saveMyHandle = async () => {
    if (!user || isGuest) return;
    const canonical = normalizeHandle(myHandleInput);
    if (!canonical) {
      setMyHandleError(handleErrorMessage(myHandleInput) || 'Invalid handle.');
      return;
    }
    if (canonical.toLowerCase() === (profile?.handle || '').toLowerCase()) {
      setEditingMyHandle(false);
      return;
    }
    setSavingMyHandle(true);
    setMyHandleError('');
    try {
      const ok = await isHandleAvailable(canonical, { userUid: user.uid });
      if (!ok) {
        setMyHandleError(`@${canonical} is already taken — try another.`);
        setSavingMyHandle(false);
        return;
      }
      await updateUserProfile(user.uid, {
        handle: canonical,
        handleLower: canonical.toLowerCase(),
      } as any);
      await refreshProfile();
      setEditingMyHandle(false);
    } catch (e: any) {
      setMyHandleError(e?.message || 'Failed to save handle');
    }
    setSavingMyHandle(false);
  };

  // Referral panel
  const [referralCode, setReferralCode] = useState<string>('');
  const [referredFamilies, setReferredFamilies] = useState<Family[]>([]);
  const [refLinkCopied, setRefLinkCopied] = useState(false);

  // Notification prefs (default: opt-in)
  const notifyOnRating = profile?.notifyOnRating !== false;
  const notifyOnAward = profile?.notifyOnAward !== false;
  const [savingPref, setSavingPref] = useState<'rating' | 'award' | null>(null);

  // Champion landing spotlight (only meaningful at Champion tier)
  const spotlightOptIn = !!family?.spotlightOptIn;
  const [savingSpotlight, setSavingSpotlight] = useState(false);

  // Family handle + photo
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [handleError, setHandleError] = useState('');
  const [savingHandle, setSavingHandle] = useState(false);
  const [savingFamilyPhoto, setSavingFamilyPhoto] = useState(false);
  const [familyPhotoError, setFamilyPhotoError] = useState('');
  const familyPhotoRef = useRef<HTMLInputElement | null>(null);

  const startEditingHandle = () => {
    setHandleInput(family?.handle || (family?.name ? suggestFamilyHandles(family.name)[0] || '' : ''));
    setHandleError('');
    setEditingHandle(true);
  };

  const saveHandle = async () => {
    if (!profile?.familyId || !family || isGuest) return;
    const canonical = normalizeHandle(handleInput);
    if (!canonical) {
      setHandleError(handleErrorMessage(handleInput) || 'Invalid handle.');
      return;
    }
    if (canonical.toLowerCase() === (family.handle || '').toLowerCase()) {
      setEditingHandle(false);
      return;
    }
    setSavingHandle(true);
    setHandleError('');
    try {
      const ok = await isHandleAvailable(canonical, family.id);
      if (!ok) {
        setHandleError('That handle is taken — try another.');
        setSavingHandle(false);
        return;
      }
      await updateFamily(profile.familyId, {
        handle: canonical,
        handleLower: canonical.toLowerCase(),
      } as any);
      setEditingHandle(false);
    } catch (e: any) {
      setHandleError(e?.message || 'Failed to save handle.');
    }
    setSavingHandle(false);
  };

  const handleFamilyPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile?.familyId) return;
    setFamilyPhotoError('');
    setSavingFamilyPhoto(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await updateFamily(profile.familyId, { photoUrl: dataUrl } as any);
    } catch (err: any) {
      setFamilyPhotoError(err?.message || 'Could not process that image.');
    }
    setSavingFamilyPhoto(false);
  };

  const removeFamilyPhoto = async () => {
    if (!profile?.familyId) return;
    setSavingFamilyPhoto(true);
    try {
      await updateFamily(profile.familyId, { photoUrl: '' } as any);
    } catch {}
    setSavingFamilyPhoto(false);
  };

  const togglePref = async (which: 'rating' | 'award') => {
    if (!user || isGuest) return;
    const field = which === 'rating' ? 'notifyOnRating' : 'notifyOnAward';
    const current = which === 'rating' ? notifyOnRating : notifyOnAward;
    setSavingPref(which);
    try {
      await updateUserProfile(user.uid, { [field]: !current } as any);
      await refreshProfile();
    } catch {
      // ignore — UI will resync from profile on next refresh
    }
    setSavingPref(null);
  };

  const toggleSpotlight = async () => {
    if (!profile?.familyId || isGuest) return;
    setSavingSpotlight(true);
    try {
      await updateFamily(profile.familyId, { spotlightOptIn: !spotlightOptIn } as any);
      // FamilyContext re-reads on next page mount; for instant feedback we'd need
      // to refresh, but the toggle's local state mirrors the source so it's fine.
    } catch {}
    setSavingSpotlight(false);
  };

  useEffect(() => {
    if (family?.pointsMode) setPointsMode(family.pointsMode);
  }, [family?.pointsMode]);

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
    if (!trimmed) { setNameError('Name cannot be empty'); return; }
    if (trimmed === profile?.displayName) { setEditingName(false); return; }
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

  // ── Referral panel (rendered inline on mobile, in right column on desktop) ─
  const ReferralPanel = (
    <>
      <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-5 relative overflow-hidden">
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

      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
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
          >💬 WhatsApp</button>
          <button
            onClick={shareEmail}
            disabled={!fullRefLink}
            className="h-9 px-3 bg-kaya-warm/60 rounded-kaya-sm text-xs font-bold text-kaya-chocolate flex items-center gap-1.5 hover:bg-kaya-warm disabled:opacity-40"
          >✉️ Email</button>
        </div>
      </div>

      <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
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
              >{unlocked ? '✓' : tier.threshold}</div>
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

      <div className="bg-kaya-warm/40 border border-kaya-warm-dark rounded-kaya p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-[10px] bg-kaya-gold-light flex items-center justify-center text-sm shrink-0">🌱</div>
        <div className="text-[11px] leading-relaxed text-kaya-chocolate">
          <p className="font-bold">Compounding credit</p>
          <p className="text-kaya-sand">When a family <em>you</em> referred goes on to refer another, you earn an extra credit.{compoundCount > 0 && ` You have ${compoundCount} so far.`}</p>
        </div>
      </div>

      {/* Champion landing spotlight — only meaningful once you reach Champion tier */}
      {currentTier === 'champion' && (
        <button
          onClick={toggleSpotlight}
          disabled={savingSpotlight}
          className="w-full bg-white border border-kaya-warm-dark rounded-kaya p-3 flex items-start gap-3 text-left hover:border-kaya-chocolate transition-colors disabled:opacity-60"
        >
          <div className={`w-10 h-6 rounded-full shrink-0 mt-0.5 relative transition-colors ${spotlightOptIn ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
            <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: spotlightOptIn ? '18px' : '2px' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold">👑 Featured on the landing page</p>
            <p className="text-[11px] text-kaya-sand leading-snug">
              Show your family name on ourkaya.com as a Champion family. Off by default. You can toggle this any time.
            </p>
          </div>
        </button>
      )}

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
    </>
  );

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Settings</h1>
        <p className="hidden lg:block text-sm text-kaya-sand mt-1">Manage your family, profile and preferences.</p>
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
        {/* ── Left column: account + family + preferences ──────── */}
        <div className="lg:col-span-7 space-y-4">

          {/* Profile card */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
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
                      <button onClick={saveName} disabled={savingName} className="h-8 px-3 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40">
                        {savingName ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={cancelEditingName} disabled={savingName} className="h-8 px-3 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand">
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
                        <button onClick={startEditingName} className="text-[11px] text-kaya-gold font-semibold hover:underline shrink-0">
                          Edit
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-kaya-sand truncate">{profile?.email}</p>
                    <p className="text-xs font-semibold capitalize" style={{ color: '#D4A017' }}>{profile?.role}</p>
                    {profile?.handle && (
                      <p className="text-[11px] font-semibold text-kaya-gold mt-0.5">{formatPersonHandle(profile.handle)}</p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Personal handle editor */}
            {!isGuest && (
              <div className="border-t border-kaya-warm-dark pt-3 mt-3">
                {!editingMyHandle ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Your handle</p>
                      {profile?.handle ? (
                        <p className="text-[12px] truncate font-semibold text-kaya-gold">{formatPersonHandle(profile.handle)}</p>
                      ) : (
                        <p className="text-[12px] text-kaya-sand">Pick a personal handle (no &quot;&apos;s Family&quot; suffix).</p>
                      )}
                    </div>
                    <button
                      onClick={startEditingMyHandle}
                      className="text-[11px] text-kaya-gold font-semibold hover:underline shrink-0"
                    >
                      {profile?.handle ? 'Change' : 'Pick handle'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Your handle</p>
                    <div className="flex items-center gap-1 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm pl-3">
                      <span className="text-kaya-sand font-bold">@</span>
                      <input
                        value={myHandleInput}
                        onChange={(e) => setMyHandleInput(e.target.value)}
                        autoFocus
                        maxLength={24}
                        placeholder="Eli"
                        className="flex-1 h-9 bg-transparent text-sm font-semibold focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-kaya-sand-light leading-snug">
                      Will display as <strong>{myHandleInput.trim() ? formatPersonHandle(normalizeHandle(myHandleInput) || myHandleInput) : '@…'}</strong>.
                      Letters and numbers, starts with a capital. Globally unique.
                    </p>
                    {myHandleError && (
                      <p className="text-red-500 text-[11px]">{myHandleError}</p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={saveMyHandle}
                        disabled={savingMyHandle}
                        className="h-9 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
                      >
                        {savingMyHandle ? 'Checking…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingMyHandle(false); setMyHandleError(''); }}
                        disabled={savingMyHandle}
                        className="h-9 px-4 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Family identity — name, handle, photo */}
          {family && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 space-y-4">
              <div className="flex items-start gap-4">
                {/* Family photo */}
                <div className="shrink-0">
                  {family.photoUrl ? (
                    <img
                      src={family.photoUrl}
                      alt={family.name}
                      className="w-16 h-16 rounded-[18px] object-cover border border-kaya-warm-dark"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-[18px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light flex items-center justify-center font-display font-black text-2xl">
                      {(family.name || 'K').replace(/^the\s+/i, '').charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Family</p>
                  <p className="font-bold text-base truncate">{family.name}</p>
                  {family.handle ? (
                    <p className="text-[12px] font-semibold text-kaya-gold truncate">{formatFamilyHandle(family.handle)}</p>
                  ) : (
                    <p className="text-[12px] text-kaya-sand">No handle yet</p>
                  )}
                  {family.isFoundingFamily && (
                    <p className="text-[11px] font-bold text-kaya-gold mt-1">👑 Founding Family · lifetime badge</p>
                  )}
                </div>
              </div>

              {/* Photo controls (parent-only, not guest) */}
              {isParent && !isGuest && (
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => familyPhotoRef.current?.click()}
                    disabled={savingFamilyPhoto}
                    className="h-8 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-[11px] font-bold hover:border-kaya-chocolate transition-colors disabled:opacity-60"
                  >
                    {savingFamilyPhoto ? 'Saving…' : family.photoUrl ? '📷 Change photo' : '📷 Add photo'}
                  </button>
                  {family.photoUrl && (
                    <button
                      onClick={removeFamilyPhoto}
                      disabled={savingFamilyPhoto}
                      className="text-[11px] text-kaya-sand hover:text-red-500 font-semibold"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    ref={familyPhotoRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFamilyPhoto}
                  />
                  {familyPhotoError && (
                    <p className="text-red-500 text-[11px] basis-full">{familyPhotoError}</p>
                  )}
                </div>
              )}

              {/* Handle editor (parent-only, not guest) */}
              {isParent && !isGuest && (
                <div className="border-t border-kaya-warm-dark pt-3">
                  {!editingHandle ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Public handle</p>
                        {family.handle ? (
                          <p className="text-[12px] truncate">
                            {formatFamilyHandle(family.handle)} ·{' '}
                            <a
                              href={`/u/${handleToSlug(family.handle)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-kaya-gold hover:underline"
                            >
                              ourkaya.com/u/{handleToSlug(family.handle)} ↗
                            </a>
                          </p>
                        ) : (
                          <p className="text-[12px] text-kaya-sand">Pick a public handle for your family.</p>
                        )}
                      </div>
                      <button
                        onClick={startEditingHandle}
                        className="text-[11px] text-kaya-gold font-semibold hover:underline shrink-0"
                      >
                        {family.handle ? 'Change' : 'Pick handle'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider">Public handle</p>
                      <div className="flex items-center gap-1 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm pl-3">
                        <span className="text-kaya-sand font-bold">@</span>
                        <input
                          value={handleInput}
                          onChange={(e) => setHandleInput(e.target.value)}
                          autoFocus
                          maxLength={24}
                          placeholder="Timotheo"
                          className="flex-1 h-9 bg-transparent text-sm font-semibold focus:outline-none"
                        />
                      </div>
                      <p className="text-[10px] text-kaya-sand-light leading-relaxed">
                        Will display as <strong>{handleInput.trim() ? `@${normalizeHandle(handleInput) || handleInput}'s Family` : "@…'s Family"}</strong>.
                        Uses 3–24 letters/numbers, starts with a capital. Lowercased in the URL.
                      </p>
                      {family.name && suggestFamilyHandles(family.name).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <span className="text-[10px] text-kaya-sand font-bold uppercase tracking-wider mr-1 self-center">Try</span>
                          {suggestFamilyHandles(family.name).map((s) => (
                            <button
                              key={s}
                              onClick={() => setHandleInput(s)}
                              className="px-2 py-1 rounded-full text-[11px] font-semibold border border-kaya-warm-dark bg-white text-kaya-chocolate hover:border-kaya-chocolate"
                            >
                              @{s}
                            </button>
                          ))}
                        </div>
                      )}
                      {handleError && (
                        <p className="text-red-500 text-[11px]">{handleError}</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={saveHandle}
                          disabled={savingHandle}
                          className="h-9 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
                        >
                          {savingHandle ? 'Checking…' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setEditingHandle(false); setHandleError(''); }}
                          disabled={savingHandle}
                          className="h-9 px-4 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inline referral panel — mobile only (desktop renders it in the right column) */}
          {isParent && family && (
            <div className="lg:hidden space-y-2">
              {ReferralPanel}
            </div>
          )}

          {/* Invite code */}
          {isParent && family && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">Helper invite code</p>
                <button onClick={() => setShowInvite(!showInvite)} className="text-xs text-kaya-gold font-semibold">
                  {showInvite ? 'Hide' : 'Show'}
                </button>
              </div>
              {showInvite && (
                <div className="flex items-center gap-3">
                  <p className="text-2xl font-mono font-bold tracking-[0.3em] flex-1">{family.inviteCode}</p>
                  <button onClick={copyInviteCode} className="px-4 py-2 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand">
                    {copied ? '✅ Copied' : '📋 Copy'}
                  </button>
                </div>
              )}
              <p className="text-xs text-kaya-sand mt-2">Share with helpers or family members so they can join your family. (For inviting <em>other</em> families to start their own, use the referral link →)</p>
            </div>
          )}

          {/* Points Mode */}
          {isParent && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
              <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Points mode</p>
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
                      pointsMode === mode.value ? 'border-kaya-gold bg-kaya-gold/5' : 'border-kaya-warm-dark'
                    }`}
                  >
                    <p className="text-sm font-semibold">{mode.label}</p>
                    <p className="text-xs text-kaya-sand">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notifications */}
          {!isGuest && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
              <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Email notifications</p>
              <div className="space-y-2">
                {[
                  { key: 'rating' as const, on: notifyOnRating, label: 'When a routine is rated', desc: 'Email me when someone in the family rates a kid’s morning or evening routine.' },
                  { key: 'award' as const,  on: notifyOnAward,  label: 'When bonus points are awarded', desc: 'Email me when someone awards a kid bonus points (kindness, helping, diamond points).' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => togglePref(p.key)}
                    disabled={savingPref === p.key}
                    className="w-full flex items-start gap-3 p-3 rounded-kaya-sm border border-kaya-warm-dark hover:border-kaya-sand-light text-left transition-colors disabled:opacity-60"
                  >
                    <div className={`w-10 h-6 rounded-full shrink-0 mt-0.5 relative transition-colors ${p.on ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
                      <div
                        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all"
                        style={{ left: p.on ? '18px' : '2px' }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{p.label}</p>
                      <p className="text-[11px] text-kaya-sand leading-relaxed">{p.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-kaya-sand-light mt-3 leading-relaxed">
                Emails are sent from <strong>noreply@ourkaya.com</strong>. Toggle these any time.
              </p>
            </div>
          )}

          {/* Add child */}
          {isParent && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
              <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider mb-3">Children</p>
              <div className="space-y-2 mb-3">
                {children.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    <span>{c.avatarEmoji}</span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-kaya-sand">— {c.houseName}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newChildName}
                  onChange={(e) => setNewChildName(e.target.value)}
                  className="flex-1 h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="Add a child…"
                />
                <button
                  onClick={handleAddChild}
                  disabled={!newChildName.trim() || addingChild}
                  className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm text-sm font-bold disabled:opacity-40"
                >Add</button>
              </div>
            </div>
          )}

          {/* Navigation links */}
          <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
            {[
              { label: 'Kid Profiles', path: '/profiles', icon: '👧' },
              { label: 'Reports',      path: '/reports',  icon: '📊' },
              { label: 'Badges',       path: '/badges',   icon: '🏆' },
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
            className="w-full h-11 bg-red-50 text-red-500 rounded-kaya text-sm font-semibold hover:bg-red-100 transition-colors mb-8 lg:mb-0"
          >Sign Out</button>
        </div>

        {/* ── Right column: invite friends — desktop only ─────── */}
        {isParent && family && (
          <aside className="hidden lg:block lg:col-span-5 space-y-2 sticky top-20">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand mb-2 px-1">Invite friends · earn rewards</p>
            {ReferralPanel}
          </aside>
        )}
      </div>
    </div>
  );
}
