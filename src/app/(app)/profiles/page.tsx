'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  getRecentRatings, getRecentAwards, updateChild, BADGES,
  getWishlist, addWishlistItem, updateWishlistItem, deleteWishlistItem,
  isHandleAvailable, readPointSystemConfig,
  DailyRating, Award, WishlistItem,
} from '@/lib/firestore';
import { AVATAR_PRESETS, AVATAR_GROUPS, generateAvatarFromName } from '@/lib/avatarPresets';
import { HOUSE_LIBRARY, isHouseUnlocked, houseUnlockHint } from '@/lib/referral';
import {
  toDisplayDate, fromDisplayDate, dayOfWeek, ageNow,
  daysToNextBirthday, ageAtNextBirthday, monthDayOf,
} from '@/lib/dates';
import { INTERESTS, ASPIRATIONS, ASPIRATION_LIMIT } from '@/lib/kidPresets';
import { bornOnThisDay, eventsOnThisDay, BornOnThisDayPerson, OnThisDayEvent } from '@/lib/onThisDay';
import type { Gender } from '@/lib/firestore';
import { fileToAvatarDataUrl, MAX_UPLOAD_BYTES } from '@/lib/imageUpload';
import {
  normalizeHandle, handleErrorMessage, suggestPersonHandle, formatPersonHandle,
} from '@/lib/handles';
import { notifyInvite } from '@/lib/notify';
import { useRef } from 'react';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

export default function ProfilesPage() {
  const { profile, isGuest } = useAuth();
  const { family, children } = useFamily();
  const refDirect = family?.referralCount ?? 0;
  const refCompound = family?.compoundCredit ?? 0;
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState(0);
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [managingBadges, setManagingBadges] = useState(false);
  const [savingBadge, setSavingBadge] = useState<string | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickingHouse, setPickingHouse] = useState(false);
  const [savingHouse, setSavingHouse] = useState<string | null>(null);

  // Identity editor (birthday, email, handle, interests, aspirations)
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [bdayInput, setBdayInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [bdayError, setBdayError] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);

  // Kid login toggle + invitation
  const [savingLoginToggle, setSavingLoginToggle] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // Born on this day + Major events
  const [bornToday, setBornToday] = useState<BornOnThisDayPerson[]>([]);
  const [eventsToday, setEventsToday] = useState<OnThisDayEvent[]>([]);

  // Wishlist
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [addingWish, setAddingWish] = useState(false);
  const [wishTitle, setWishTitle] = useState('');
  const [wishCost, setWishCost] = useState('');
  const [wishUrl, setWishUrl] = useState('');
  const [savingWish, setSavingWish] = useState(false);

  // Honor ?child=<id> for deep links from the dashboard / Family Tree.
  useEffect(() => {
    const childId = searchParams.get('child');
    if (!childId || children.length === 0) return;
    const idx = children.findIndex((c) => c.id === childId);
    if (idx >= 0) setSelected(idx);
  }, [searchParams, children]);

  // Honor ?edit=<section> deep link so a tap from the Family Tree lands
  // straight in the editor for that kid without an extra "Edit" tap.
  // Supported values today: 'identity' (the About editor — birthday, email,
  // handle), 'photo' (avatar picker).
  const child = children[selected];
  useEffect(() => {
    if (!child || isGuest || profile?.role !== 'parent') return;
    const editMode = searchParams.get('edit');
    if (editMode === 'identity') startEditingIdentity();
    if (editMode === 'photo') setPickingPhoto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, child?.id]);

  useEffect(() => {
    if (!profile?.familyId) return;
    (async () => {
      const [r, a] = await Promise.all([
        getRecentRatings(profile.familyId, 14),
        getRecentAwards(profile.familyId, 14),
      ]);
      setRatings(r.filter((x) => x.childId === child?.id));
      setAwards(a.filter((x) => x.childId === child?.id));
    })();
  }, [profile?.familyId, child?.id]);

  // Wishlist load
  useEffect(() => {
    if (!profile?.familyId || !child) return;
    getWishlist(profile.familyId, child.id).then(setWishlist).catch(() => setWishlist([]));
  }, [profile?.familyId, child?.id, savingWish]);

  // Born on this day + Major events — fetched when birthday is set.
  // Gender steers the "born today" suggestion list so a girl sees more
  // women, a boy more men. 'unspecified'/'other' falls back to mixed.
  useEffect(() => {
    setBornToday([]);
    setEventsToday([]);
    if (!child?.birthday) return;
    const md = monthDayOf(child.birthday);
    if (!md) return;
    const gender = (child.gender || 'unspecified') as Gender;
    bornOnThisDay(md.month, md.day, 5, gender).then(setBornToday).catch(() => setBornToday([]));
    eventsOnThisDay(md.month, md.day, 5).then(setEventsToday).catch(() => setEventsToday([]));
  }, [child?.birthday, child?.gender]);

  if (!child) return null;

  const earnedBadges = BADGES.filter((b) => (child.badges || []).includes(b.id));
  const isParent = profile?.role === 'parent';
  // Family-level policy — when off, the 🌈 Other chip is hidden in the
  // kid gender selector. Existing kids whose gender was already 'other'
  // keep that value visible so we never silently rewrite their data.
  const allowGenderOther = !!family?.allowGenderOther;

  const choosePhoto = async (url: string) => {
    if (!profile?.familyId || !child || isGuest) return;
    setSavingPhoto(url || 'remove');
    setUploadError('');
    try {
      await updateChild(profile.familyId, child.id, { avatarPhoto: url });
      // Real-time subscription updates the avatar everywhere; close the picker.
      setPickingPhoto(false);
    } catch {
      // Real-time subscription will keep things in sync.
    }
    setSavingPhoto(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setUploadError('');
    setSavingPhoto('upload');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await choosePhoto(dataUrl);
    } catch (err: any) {
      setUploadError(err?.message || 'Could not process that image.');
      setSavingPhoto(null);
    }
  };

  const toggleBadge = async (badgeId: string) => {
    if (!profile?.familyId || !child || isGuest || savingBadge) return;
    const has = (child.badges || []).includes(badgeId);
    const next = has
      ? (child.badges || []).filter((b) => b !== badgeId)
      : [...(child.badges || []), badgeId];
    setSavingBadge(badgeId);
    try {
      await updateChild(profile.familyId, child.id, { badges: next });
      // Real-time subscription in FamilyContext will reflect the change.
    } catch (e) {
      // Ignore — UI will stay in sync via the subscription.
    }
    setSavingBadge(null);
  };

  const startEditingIdentity = () => {
    // Native <input type="date"> uses YYYY-MM-DD natively — same as our
    // canonical Firestore format — so no display ↔ canonical conversion needed.
    setBdayInput(child?.birthday || '');
    setEmailInput(child?.email || '');
    setHandleInput(child?.handle || (child ? suggestPersonHandle(child.name) || '' : ''));
    setBdayError('');
    setEditingIdentity(true);
  };

  const saveIdentity = async () => {
    if (!profile?.familyId || !child || isGuest) return;

    const trimmedDate = bdayInput.trim();
    if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      setBdayError('Pick a valid date.');
      return;
    }

    const trimmedEmail = emailInput.trim().toLowerCase();
    if (trimmedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)) {
      setBdayError('Email looks invalid.');
      return;
    }

    // Handle is optional. Validate format if present, then check uniqueness.
    const trimmedHandle = handleInput.trim();
    let canonicalHandle: string | null = null;
    if (trimmedHandle) {
      canonicalHandle = normalizeHandle(trimmedHandle);
      if (!canonicalHandle) {
        setBdayError(handleErrorMessage(trimmedHandle) || 'Invalid handle.');
        return;
      }
    }

    // Build a partial update — Firestore rejects `undefined`, so only include
    // fields the user actually filled in. Clearing a value is intentionally a
    // no-op for v1 (avoids accidental data loss); a "Remove" affordance can
    // come later if needed.
    const updates: Record<string, unknown> = {};
    if (trimmedDate) updates.birthday = trimmedDate;
    if (trimmedEmail) {
      updates.email = trimmedEmail;
      updates.emailLower = trimmedEmail; // mirror used by findChildByEmail
    }
    if (canonicalHandle && canonicalHandle.toLowerCase() !== (child.handle || '').toLowerCase()) {
      // Handle changed — check uniqueness before saving.
      const ok = await isHandleAvailable(canonicalHandle, { childId: child.id });
      if (!ok) {
        setBdayError(`@${canonicalHandle} is already taken — try another.`);
        return;
      }
      updates.handle = canonicalHandle;
      updates.handleLower = canonicalHandle.toLowerCase();
    }
    if (Object.keys(updates).length === 0) {
      setEditingIdentity(false);
      return;
    }

    setSavingIdentity(true);
    setBdayError('');
    try {
      await updateChild(profile.familyId, child.id, updates as any);
      setEditingIdentity(false);
    } catch (e: any) {
      setBdayError(e?.message || 'Failed to save');
    }
    setSavingIdentity(false);
  };

  const toggleKidLogin = async () => {
    if (!profile?.familyId || !child || isGuest || savingLoginToggle) return;
    setSavingLoginToggle(true);
    try {
      await updateChild(profile.familyId, child.id, {
        loginEnabled: !child.loginEnabled,
      } as any);
    } catch {}
    setSavingLoginToggle(false);
  };

  const sendKidInvite = async () => {
    if (!profile || !child || isGuest || !child.email) return;
    setSendingInvite(true);
    setInviteError('');
    setInviteSent(false);
    try {
      await notifyInvite({
        to: [child.email],
        kidName: child.name,
        familyName: family?.name || 'Your family',
        inviterName: profile.displayName,
      });
      setInviteSent(true);
      setTimeout(() => setInviteSent(false), 4000);
    } catch (e: any) {
      setInviteError(e?.message || 'Could not send invitation.');
    }
    setSendingInvite(false);
  };

  const setGender = async (gender: Gender) => {
    if (!profile?.familyId || !child || isGuest) return;
    if ((child.gender || 'unspecified') === gender) return;
    await updateChild(profile.familyId, child.id, { gender });
  };

  const toggleInterest = async (label: string) => {
    if (!profile?.familyId || !child || isGuest) return;
    const current = child.interests || [];
    const has = current.includes(label);
    const next = has ? current.filter((i) => i !== label) : [...current, label];
    await updateChild(profile.familyId, child.id, { interests: next });
  };

  const toggleAspiration = async (label: string) => {
    if (!profile?.familyId || !child || isGuest) return;
    const current = child.aspirations || [];
    const has = current.includes(label);
    if (!has && current.length >= ASPIRATION_LIMIT) return; // hit cap
    const next = has ? current.filter((a) => a !== label) : [...current, label];
    await updateChild(profile.familyId, child.id, { aspirations: next });
  };

  const submitWish = async () => {
    if (!profile?.familyId || !child || !wishTitle.trim() || isGuest) return;
    setSavingWish(true);
    try {
      await addWishlistItem(profile.familyId, child.id, {
        title: wishTitle.trim(),
        url: wishUrl.trim() || undefined,
        estimatedCost: wishCost ? Number(wishCost) || undefined : undefined,
      });
      setWishTitle(''); setWishCost(''); setWishUrl('');
      setAddingWish(false);
    } catch {}
    setSavingWish(false);
  };

  const markWishAchieved = async (item: WishlistItem) => {
    if (!profile?.familyId || !child || isGuest) return;
    setSavingWish(true);
    await updateWishlistItem(profile.familyId, child.id, item.id, {
      achieved: !item.achieved,
    });
    setSavingWish(false);
  };

  const removeWish = async (item: WishlistItem) => {
    if (!profile?.familyId || !child || isGuest) return;
    setSavingWish(true);
    await deleteWishlistItem(profile.familyId, child.id, item.id);
    setSavingWish(false);
  };

  const chooseHouse = async (presetId: string) => {
    if (!profile?.familyId || !child || isGuest || savingHouse) return;
    const preset = HOUSE_LIBRARY.find((h) => h.id === presetId);
    if (!preset) return;
    if (!isHouseUnlocked(preset.tier, refDirect, refCompound)) return;
    setSavingHouse(presetId);
    try {
      await updateChild(profile.familyId, child.id, {
        houseColor: preset.color,
        houseName: preset.name,
        avatarEmoji: child.avatarPhoto ? child.avatarEmoji : preset.emoji,
      });
      setPickingHouse(false);
    } catch {
      // Real-time subscription keeps things in sync.
    }
    setSavingHouse(null);
  };
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build a simple 7-day activity heatmap
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    const dayRatings = ratings.filter((r) => r.date === dateStr);
    const pts = dayRatings.reduce((s, r) => s + r.totalPoints, 0);
    return { day: weekDays[d.getDay() === 0 ? 6 : d.getDay() - 1], date: dateStr, points: pts };
  });

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Kid profiles</h1>
        <p className="hidden lg:block text-sm text-kaya-sand mt-1">Per-child progress, badges, and recent awards.</p>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 lg:mb-6 overflow-x-auto pb-1">
        {children.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setSelected(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
              selected === i ? 'text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand'
            }`}
            style={selected === i ? { backgroundColor: c.houseColor } : {}}
          >
            {c.avatarEmoji} {c.name}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-12 lg:gap-6 lg:items-start">
        <div className="lg:col-span-5 mb-5 lg:mb-0 lg:sticky lg:top-20">

      {/* Profile card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 text-center">
        <div className="mx-auto mb-3 inline-block">
          <KidAvatar child={child} size="xl" />
        </div>
        {isParent && !isGuest && (
          <div className="mb-3">
            {!pickingPhoto ? (
              <button
                onClick={() => setPickingPhoto(true)}
                className="text-[11px] text-kaya-gold font-semibold hover:underline"
              >
                {child.avatarPhoto ? 'Change photo' : '+ Add photo'}
              </button>
            ) : (
              <div className="space-y-3 text-left">
                {/* Two sources: curated library + upload from device.
                    (Search dropped — the "Pick for {name}" suggestion below
                    covers the same need without needing an image-API key.) */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="h-10 px-2 rounded-kaya-sm bg-kaya-chocolate text-white text-[12px] font-bold"
                    aria-pressed="true"
                  >
                    🎨 From library
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!!savingPhoto}
                    className="h-10 px-2 rounded-kaya-sm bg-white border border-kaya-warm-dark text-kaya-chocolate text-[12px] font-bold hover:border-kaya-chocolate transition-colors disabled:opacity-60"
                  >
                    {savingPhoto === 'upload' ? 'Uploading…' : '📷 From your device'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
                {uploadError && (
                  <p className="text-red-500 text-[11px] bg-red-50 border border-red-200 rounded-kaya-sm px-2 py-1.5">{uploadError}</p>
                )}
                <p className="text-[10px] text-kaya-sand-light leading-snug">
                  Upload images up to 5 MB — they&apos;re auto-cropped to a square and resized to 256px so the dashboard stays snappy.
                </p>

                {/* Suggestion based on the kid's name */}
                <div className="flex items-center gap-3 bg-kaya-cream/60 border border-kaya-warm-dark rounded-kaya-sm p-2.5">
                  <img
                    src={generateAvatarFromName(child.name)}
                    alt=""
                    className="w-10 h-10 rounded-full bg-white shrink-0"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold">Pick for {child.name}</p>
                    <p className="text-[10px] text-kaya-sand">Generated from their name</p>
                  </div>
                  <button
                    onClick={() => choosePhoto(generateAvatarFromName(child.name))}
                    disabled={!!savingPhoto}
                    className="h-7 px-2.5 bg-kaya-gold text-white rounded-kaya-sm text-[11px] font-bold disabled:opacity-40"
                  >
                    Use
                  </button>
                </div>

                {/* Curated grid grouped by theme */}
                {AVATAR_GROUPS.map((group) => (
                  <div key={group.key}>
                    <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1.5">{group.label}</p>
                    <div className="grid grid-cols-4 gap-2">
                      {AVATAR_PRESETS.filter((a) => a.group === group.key).map((preset) => {
                        const selected = child.avatarPhoto === preset.url;
                        const saving = savingPhoto === preset.url;
                        return (
                          <button
                            key={preset.url}
                            onClick={() => choosePhoto(preset.url)}
                            disabled={!!savingPhoto}
                            title={preset.label}
                            aria-label={preset.label}
                            className={`relative aspect-square rounded-kaya-sm overflow-hidden border-2 transition-all ${
                              selected ? 'border-kaya-gold' : 'border-transparent hover:border-kaya-warm-dark'
                            } ${saving ? 'opacity-60' : ''}`}
                          >
                            <img
                              src={preset.url}
                              alt=""
                              className="w-full h-full object-cover bg-white"
                              referrerPolicy="no-referrer"
                            />
                            {selected && (
                              <span className="absolute bottom-0.5 right-0.5 bg-kaya-gold text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => setPickingPhoto(false)}
                    className="h-8 px-3 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                  >
                    Done
                  </button>
                  {child.avatarPhoto && (
                    <button
                      onClick={() => choosePhoto('')}
                      disabled={!!savingPhoto}
                      className="h-8 px-3 text-xs font-semibold text-kaya-sand hover:text-red-500"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <h2 className="font-display text-xl font-black">{child.name}</h2>
        <p className="text-sm font-semibold" style={{ color: child.houseColor }}>{child.houseName}</p>

        {isParent && !isGuest && (
          <div className="mt-3 text-left">
            {!pickingHouse ? (
              <button
                onClick={() => setPickingHouse(true)}
                className="text-[11px] text-kaya-gold font-semibold hover:underline w-full text-center"
              >
                Change house
              </button>
            ) : (
              <div className="space-y-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-[11px] font-bold text-kaya-sand uppercase tracking-wider">Pick a house</p>
                  <button
                    onClick={() => setPickingHouse(false)}
                    className="text-[10px] text-kaya-sand hover:text-kaya-chocolate font-semibold"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {HOUSE_LIBRARY.map((h) => {
                    const unlocked = isHouseUnlocked(h.tier, refDirect, refCompound);
                    const sel = child.houseName === h.name;
                    const saving = savingHouse === h.id;
                    return (
                      <button
                        key={h.id}
                        onClick={() => unlocked && chooseHouse(h.id)}
                        disabled={!unlocked || !!savingHouse}
                        title={unlocked ? h.name : `${h.name} — ${houseUnlockHint(h.tier)}`}
                        className={`relative p-2 rounded-kaya-sm border-2 transition-all text-center ${
                          sel
                            ? 'border-kaya-chocolate bg-white'
                            : unlocked
                              ? 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
                              : 'border-kaya-warm-dark/60 bg-kaya-warm/30 opacity-60 cursor-not-allowed'
                        } ${saving ? 'opacity-60' : ''}`}
                      >
                        <div
                          className={`w-8 h-8 mx-auto mb-1 rounded-full ${unlocked ? '' : 'grayscale'}`}
                          style={{ background: h.color }}
                        />
                        <p className="text-[10px] font-bold leading-tight truncate">{h.name.replace(' House', '')}</p>
                        {!unlocked && (
                          <span className="absolute top-1 right-1 text-[10px]" aria-label="locked">🔒</span>
                        )}
                        {sel && unlocked && (
                          <span className="absolute top-1 right-1 text-kaya-gold text-[11px] font-bold">✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-kaya-sand-light leading-relaxed">
                  Locked colors unlock as you refer other families. Settings → Invite friends.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-around mt-4 pt-4 border-t border-kaya-warm-dark">
          <div>
            <p className="text-xl font-black" style={{ color: child.houseColor }}>{child.totalPoints || 0}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Total</p>
          </div>
          <div>
            <p className="text-xl font-black">{child.weeklyPoints || 0}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">This Week</p>
          </div>
          {(() => {
            // Show the routine-points accumulator beside the headline
            // totals so kids see how much of the next house point they've
            // earned today. Quiet when the kid has zero accumulated to
            // avoid noise on fresh profiles.
            const ppHP = readPointSystemConfig(family).routines.pointsPerHousePoint;
            const rp = child.routinePoints || 0;
            return (
              <div>
                <p className="text-xl font-black">{rp}<span className="text-[10px] text-kaya-sand">/{ppHP}</span></p>
                <p className="text-[10px] text-kaya-sand font-semibold uppercase">Routine pts</p>
              </div>
            );
          })()}
          <div>
            <p className="text-xl font-black">{child.streak || 0} 🔥</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Streak</p>
          </div>
        </div>
      </div>

        </div>

        <div className="lg:col-span-7 space-y-5">

      {/* About — identity, interests, aspirations */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">About {child.name}</h3>
          {isParent && !isGuest && (
            <button
              onClick={editingIdentity ? () => setEditingIdentity(false) : startEditingIdentity}
              className="text-[11px] text-kaya-gold font-semibold hover:underline"
            >
              {editingIdentity ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {editingIdentity ? (
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Birthday</label>
              <input
                type="date"
                value={bdayInput}
                onChange={(e) => setBdayInput(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                autoFocus
              />
              <p className="text-[10px] text-kaya-sand mt-1">Pick from the calendar — we&apos;ll display it as DD-MMM-YYYY everywhere else.</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Email (optional — for future kid login)</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="kid@example.com"
                className="w-full h-10 px-3 bg-kaya-cream rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Public handle (optional)</label>
              <div className="flex items-center gap-1 bg-kaya-cream rounded-kaya-sm pl-3">
                <span className="text-kaya-sand font-bold">@</span>
                <input
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  placeholder={child ? suggestPersonHandle(child.name) || 'Daniella' : 'Daniella'}
                  maxLength={24}
                  className="flex-1 h-10 bg-transparent text-sm focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-kaya-sand mt-1">
                {handleInput.trim()
                  ? <>Will display as <strong>{normalizeHandle(handleInput) ? formatPersonHandle(normalizeHandle(handleInput)!) : `@${handleInput}`}</strong>.</>
                  : 'Letters and numbers, starts with a capital. Globally unique across Kaya.'}
              </p>
            </div>
            {bdayError && <p className="text-red-500 text-[11px]">{bdayError}</p>}
            <div className="flex gap-2">
              <button onClick={saveIdentity} disabled={savingIdentity} className="h-9 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40">
                {savingIdentity ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditingIdentity(false)} className="h-9 px-4 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Birthday + email read-only */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm p-3">
                <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Birthday</p>
                {child.birthday ? (
                  <>
                    <p className="text-sm font-bold">🎂 {toDisplayDate(child.birthday)}</p>
                    <p className="text-[11px] text-kaya-sand mt-0.5">
                      Born on a {dayOfWeek(child.birthday)} · age {ageNow(child.birthday)}
                    </p>
                    {(() => {
                      const d = daysToNextBirthday(child.birthday);
                      if (d === null) return null;
                      const nextAge = ageAtNextBirthday(child.birthday);
                      if (d === 0) return <p className="text-[11px] font-bold text-kaya-gold mt-0.5">🎉 It&apos;s today!</p>;
                      return (
                        <p className="text-[11px] text-kaya-gold font-semibold mt-0.5">
                          {d} day{d === 1 ? '' : 's'} to {nextAge && `${nextAge}th`} birthday
                        </p>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-xs text-kaya-sand">Not set{isParent && !isGuest && ' — tap Edit'}</p>
                )}
              </div>
              <div className="bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm p-3">
                <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Email</p>
                {child.email ? (
                  <>
                    <p className="text-sm font-bold truncate">{child.email}</p>
                    <p className="text-[11px] text-kaya-sand mt-0.5">{child.loginEnabled ? '✓ Login enabled' : 'Login disabled'}</p>
                  </>
                ) : (
                  <p className="text-xs text-kaya-sand">No email yet</p>
                )}
              </div>
            </div>

            {child.handle && (
              <div className="bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm p-3">
                <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-1">Public handle</p>
                <p className="text-sm font-bold text-kaya-gold">{formatPersonHandle(child.handle)}</p>
                <p className="text-[11px] text-kaya-sand mt-0.5">{child.name}&apos;s public identity on Kaya.</p>
              </div>
            )}

            {/* Gender — used to personalise avatar suggestions and the
                "Born on this day" panel below. */}
            <div>
              <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-2">Gender</p>
              {isParent && !isGuest ? (
                <div className="flex flex-wrap gap-1.5">
                  {(([
                    { value: 'female', label: 'Girl', emoji: '👧' },
                    { value: 'male', label: 'Boy', emoji: '👦' },
                    { value: 'other', label: 'Other', emoji: '🌈' },
                    { value: 'unspecified', label: 'Prefer not to say', emoji: '—' },
                  ] as { value: Gender; label: string; emoji: string }[]).filter((g) => {
                    // Hide "Other" unless the family has opted in. Keep it
                    // visible if this kid is currently set to 'other' so the
                    // parent doesn't lose the existing choice.
                    if (g.value === 'other' && !allowGenderOther && child.gender !== 'other') return false;
                    return true;
                  })).map((g) => {
                    const sel = (child.gender || 'unspecified') === g.value;
                    return (
                      <button
                        key={g.value}
                        onClick={() => setGender(g.value)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                          sel ? 'bg-kaya-chocolate text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
                        }`}
                      >
                        {g.emoji} {g.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-kaya-sand">
                  {child.gender === 'female' ? '👧 Girl'
                    : child.gender === 'male' ? '👦 Boy'
                    : child.gender === 'other' ? '🌈 Other'
                    : 'Not set'}
                </p>
              )}
            </div>

            {/* Interests */}
            <div>
              <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-2">Things {child.name} likes</p>
              {(child.interests?.length || 0) > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {child.interests!.map((i) => {
                    const preset = INTERESTS.find((p) => p.label === i);
                    return (
                      <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-kaya-gold/10 text-kaya-chocolate rounded-full text-[11px] font-semibold">
                        {preset?.emoji || '⭐'} {i}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-kaya-sand mb-2">{isParent && !isGuest ? 'Tap to add interests below.' : 'No interests added yet.'}</p>
              )}
              {isParent && !isGuest && (
                <details className="text-[11px] text-kaya-sand">
                  <summary className="cursor-pointer text-kaya-gold font-semibold">+ Add or remove</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {INTERESTS.map((p) => {
                      const sel = (child.interests || []).includes(p.label);
                      return (
                        <button
                          key={p.label}
                          onClick={() => toggleInterest(p.label)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                            sel ? 'bg-kaya-gold text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
                          }`}
                        >
                          {p.emoji} {p.label}
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>

            {/* Aspirations */}
            <div>
              <p className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider mb-2">When {child.name} grows up</p>
              {(child.aspirations?.length || 0) > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {child.aspirations!.map((a) => {
                    const preset = ASPIRATIONS.find((p) => p.label === a);
                    return (
                      <span key={a} className="inline-flex items-center gap-1 px-2.5 py-1 bg-kaya-chocolate text-white rounded-full text-[11px] font-semibold">
                        {preset?.emoji || '⭐'} {a}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-kaya-sand mb-2">{isParent && !isGuest ? `Pick up to ${ASPIRATION_LIMIT} below.` : 'Not picked yet.'}</p>
              )}
              {isParent && !isGuest && (
                <details className="text-[11px] text-kaya-sand">
                  <summary className="cursor-pointer text-kaya-gold font-semibold">+ Pick up to {ASPIRATION_LIMIT}</summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ASPIRATIONS.map((p) => {
                      const sel = (child.aspirations || []).includes(p.label);
                      const atCap = (child.aspirations?.length || 0) >= ASPIRATION_LIMIT && !sel;
                      return (
                        <button
                          key={p.label}
                          onClick={() => toggleAspiration(p.label)}
                          disabled={atCap}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                            sel
                              ? 'bg-kaya-chocolate text-white border-transparent'
                              : atCap
                                ? 'border-kaya-warm-dark bg-kaya-warm/40 text-kaya-sand-light cursor-not-allowed'
                                : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
                          }`}
                        >
                          {p.emoji} {p.label}
                        </button>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Kid login (parent-only, not guest) */}
      {isParent && !isGuest && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">{child.name}&apos;s login</h3>
            <button
              onClick={toggleKidLogin}
              disabled={savingLoginToggle}
              className="flex items-center gap-2 disabled:opacity-60"
              aria-label={child.loginEnabled ? 'Disable kid login' : 'Enable kid login'}
            >
              <div className={`w-10 h-6 rounded-full relative transition-colors ${child.loginEnabled ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'}`}>
                <div
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all"
                  style={{ left: child.loginEnabled ? '18px' : '2px' }}
                />
              </div>
            </button>
          </div>

          {child.loginEnabled ? (
            child.email ? (
              <div className="space-y-2.5">
                <p className="text-[12px] text-kaya-chocolate leading-relaxed">
                  ✓ Login enabled. When <strong>{child.email}</strong> signs up at ourkaya.com/login, they&apos;ll be linked to {child.name}&apos;s profile automatically.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={sendKidInvite}
                    disabled={sendingInvite || inviteSent}
                    className="h-9 px-3 bg-kaya-chocolate text-white rounded-kaya-sm text-[12px] font-bold disabled:opacity-60 hover:bg-kaya-chocolate-light transition-colors"
                  >
                    {inviteSent ? '✅ Invite sent' : sendingInvite ? 'Sending…' : '✉️ Send invitation'}
                  </button>
                  <span className="text-[10px] text-kaya-sand">Sends them a Kaya-branded email with the sign-up link.</span>
                </div>
                {inviteError && <p className="text-red-500 text-[11px]">{inviteError}</p>}
              </div>
            ) : (
              <p className="text-[12px] text-kaya-sand">
                ⚠️ Login is on, but no email is set. Add {child.name}&apos;s email above (in the About editor) so we know who to link on signup.
              </p>
            )
          ) : (
            <p className="text-[12px] text-kaya-sand leading-relaxed">
              Login is off. {child.name} can&apos;t sign in even if you&apos;ve set their email. Toggle on when you&apos;re ready for them to have their own account.
            </p>
          )}
        </div>
      )}

      {/* Born on this day */}
      {child.birthday && bornToday.length > 0 && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">
              Born on the same day
              {child.gender === 'female' && <span className="ml-1 text-kaya-sand-light normal-case">· women</span>}
              {child.gender === 'male' && <span className="ml-1 text-kaya-sand-light normal-case">· men</span>}
            </h3>
            <span className="text-[10px] text-kaya-sand-light">via Wikipedia</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {bornToday.map((p) => (
              <a
                key={p.pageUrl}
                href={p.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-2 rounded-kaya-sm border border-kaya-warm-dark bg-kaya-cream/40 hover:border-kaya-chocolate transition-colors no-underline text-inherit"
              >
                {p.thumbnailUrl ? (
                  <img src={p.thumbnailUrl} alt="" className="w-10 h-10 rounded-full object-cover bg-white shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-kaya-gold-light flex items-center justify-center shrink-0">⭐</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold leading-tight truncate">{p.name}</p>
                  <p className="text-[10px] text-kaya-sand">b. {p.year}</p>
                  {p.description && <p className="text-[10px] text-kaya-sand line-clamp-2 leading-snug mt-0.5">{p.description}</p>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Innovations & inspiring moments on this day */}
      {child.birthday && eventsToday.length > 0 && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">Inspiring on this day</h3>
            <span className="text-[10px] text-kaya-sand-light">curated · Wikipedia</span>
          </div>
          <ul className="space-y-2">
            {eventsToday.map((e, idx) => {
              const inner = (
                <>
                  {e.thumbnailUrl ? (
                    <img src={e.thumbnailUrl} alt="" className="w-10 h-10 rounded-kaya-sm object-cover bg-white shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-10 h-10 rounded-kaya-sm bg-kaya-gold-light flex items-center justify-center shrink-0">📜</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-kaya-gold">{e.year}</p>
                    <p className="text-[12px] leading-snug">{e.text}</p>
                  </div>
                </>
              );
              const cls = 'flex items-start gap-2.5 p-2.5 rounded-kaya-sm border border-kaya-warm-dark bg-kaya-cream/40 hover:border-kaya-chocolate transition-colors no-underline text-inherit';
              return (
                <li key={`${e.year}-${idx}`}>
                  {e.pageUrl ? (
                    <a href={e.pageUrl} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
                  ) : (
                    <div className={cls}>{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Wishlist */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">
            Wishlist {wishlist.length > 0 && <span className="text-kaya-sand-light">· {wishlist.length}</span>}
          </h3>
          {isParent && !isGuest && (
            <button
              onClick={() => setAddingWish((v) => !v)}
              className="text-[11px] text-kaya-gold font-semibold hover:underline"
            >
              {addingWish ? 'Close' : '+ Add wish'}
            </button>
          )}
        </div>

        {addingWish && isParent && !isGuest && (
          <div className="bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm p-3 mb-3 space-y-2">
            <input
              value={wishTitle}
              onChange={(e) => setWishTitle(e.target.value)}
              placeholder="What do they want?"
              className="w-full h-9 px-3 bg-white rounded-kaya-sm text-xs border border-kaya-warm-dark focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={wishCost}
                onChange={(e) => setWishCost(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Estimated cost (optional)"
                className="h-9 px-3 bg-white rounded-kaya-sm text-xs border border-kaya-warm-dark focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
              <input
                value={wishUrl}
                onChange={(e) => setWishUrl(e.target.value)}
                placeholder="Link (optional)"
                className="h-9 px-3 bg-white rounded-kaya-sm text-xs border border-kaya-warm-dark focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
              />
            </div>
            <button
              onClick={submitWish}
              disabled={!wishTitle.trim() || savingWish}
              className="h-9 px-4 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
            >
              {savingWish ? 'Saving…' : 'Add to wishlist'}
            </button>
          </div>
        )}

        {wishlist.length === 0 && !addingWish ? (
          <p className="text-xs text-kaya-sand">{isParent && !isGuest ? 'No wishes yet — tap "+ Add wish" to record what they’re hoping for.' : 'No wishes yet.'}</p>
        ) : (
          <div className="space-y-2">
            {wishlist.map((w) => (
              <div
                key={w.id}
                className={`flex items-center gap-3 p-2.5 rounded-kaya-sm border ${
                  w.achieved ? 'bg-green-50 border-green-200 opacity-80' : 'bg-white border-kaya-warm-dark'
                }`}
              >
                <button
                  onClick={() => isParent && !isGuest && markWishAchieved(w)}
                  disabled={!isParent || isGuest}
                  title={w.achieved ? 'Mark as not achieved' : 'Mark as achieved'}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[11px] shrink-0 ${
                    w.achieved
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'border-kaya-warm-dark bg-white hover:border-kaya-chocolate'
                  } ${!isParent || isGuest ? 'cursor-default' : ''}`}
                >
                  {w.achieved ? '✓' : ''}
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold ${w.achieved ? 'line-through text-kaya-sand' : ''}`}>
                    {w.title}
                  </p>
                  <p className="text-[11px] text-kaya-sand">
                    {w.estimatedCost !== undefined && w.estimatedCost !== null && `~ ${w.estimatedCost.toLocaleString()} `}
                    {w.url && (
                      <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-kaya-gold hover:underline">link ↗</a>
                    )}
                  </p>
                </div>
                {isParent && !isGuest && (
                  <button
                    onClick={() => removeWish(w)}
                    className="text-[10px] text-kaya-sand hover:text-red-500 font-semibold shrink-0"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7-day activity */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
        <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-3">Last 7 Days</h3>
        <div className="flex justify-between">
          {last7.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: d.points > 10 ? child.houseColor : d.points > 0 ? child.houseColor + '30' : '#F0EBE3',
                  color: d.points > 10 ? '#fff' : d.points > 0 ? child.houseColor : '#C4B89A',
                }}
              >
                {d.points || '—'}
              </div>
              <span className="text-[10px] text-kaya-sand font-medium">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">
            {earnedBadges.length > 0 ? 'Badges earned' : 'Badges'}
          </h3>
          {isParent && !isGuest && (
            <button
              onClick={() => setManagingBadges((m) => !m)}
              className="text-[11px] text-kaya-gold font-semibold hover:underline"
            >
              {managingBadges ? 'Done' : earnedBadges.length > 0 ? 'Manage' : '+ Award badge'}
            </button>
          )}
        </div>

        {!managingBadges && earnedBadges.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {earnedBadges.map((b) => (
              <div key={b.id} className="flex-shrink-0 bg-white border border-kaya-warm-dark rounded-kaya p-3 text-center w-20">
                <div className="text-2xl mb-1">{b.icon}</div>
                <p className="text-[10px] font-bold leading-tight">{b.name}</p>
              </div>
            ))}
          </div>
        )}

        {!managingBadges && earnedBadges.length === 0 && (
          <p className="text-xs text-kaya-sand">No badges yet. {isParent && !isGuest && 'Tap "+ Award badge" to recognize a milestone.'}</p>
        )}

        {managingBadges && (
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-3">
            <p className="text-[11px] text-kaya-sand mb-3">Tap a badge to award or remove it.</p>
            <div className="grid grid-cols-2 gap-2">
              {BADGES.map((b) => {
                const has = (child.badges || []).includes(b.id);
                const saving = savingBadge === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => toggleBadge(b.id)}
                    disabled={!!savingBadge}
                    className={`flex items-center gap-2 p-2.5 rounded-kaya-sm border transition-all text-left ${
                      has
                        ? 'border-kaya-gold bg-kaya-gold/5'
                        : 'border-kaya-warm-dark bg-white hover:border-kaya-sand-light'
                    } ${saving ? 'opacity-60' : ''}`}
                  >
                    <div className="text-xl shrink-0">{b.icon}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold leading-tight truncate">{b.name}</p>
                      <p className="text-[10px] text-kaya-sand truncate">{b.description}</p>
                    </div>
                    {has && <span className="text-kaya-gold text-xs font-bold shrink-0">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Recent awards */}
      {awards.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-3">Recent Awards</h3>
          <div className="space-y-2">
            {awards.slice(0, 5).map((a) => (
              <div key={a.id} className="bg-white border border-kaya-warm-dark rounded-kaya-sm p-3 flex items-center gap-3">
                <span className="text-lg">🎖️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{a.reason}</p>
                  <p className="text-xs text-kaya-sand">by {a.awardedByName}</p>
                </div>
                <span className="text-xs font-bold text-kaya-gold">+{a.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}

        </div>
      </div>
    </div>
  );
}
