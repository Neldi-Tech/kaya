'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, updateChild, BADGES, DailyRating, Award } from '@/lib/firestore';
import { AVATAR_PRESETS, AVATAR_GROUPS, generateAvatarFromName } from '@/lib/avatarPresets';
import { HOUSE_LIBRARY, isHouseUnlocked, houseUnlockHint } from '@/lib/referral';
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
  const [pickingHouse, setPickingHouse] = useState(false);
  const [savingHouse, setSavingHouse] = useState<string | null>(null);

  // Honor ?child=<id> for deep links from the dashboard kid cards.
  useEffect(() => {
    const childId = searchParams.get('child');
    if (!childId || children.length === 0) return;
    const idx = children.findIndex((c) => c.id === childId);
    if (idx >= 0) setSelected(idx);
  }, [searchParams, children]);

  const child = children[selected];

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

  if (!child) return null;

  const earnedBadges = BADGES.filter((b) => (child.badges || []).includes(b.id));
  const isParent = profile?.role === 'parent';

  const choosePhoto = async (url: string) => {
    if (!profile?.familyId || !child || isGuest) return;
    setSavingPhoto(url || 'remove');
    try {
      await updateChild(profile.familyId, child.id, { avatarPhoto: url });
      // Real-time subscription updates the avatar everywhere; close the picker.
      setPickingPhoto(false);
    } catch {
      // Real-time subscription will keep things in sync.
    }
    setSavingPhoto(null);
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
                {/* Three sources: library (live), gallery + search (Phase 2/3) */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    className="h-9 px-2 rounded-kaya-sm bg-kaya-chocolate text-white text-[11px] font-bold"
                    aria-pressed="true"
                  >
                    🎨 Library
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Coming soon — needs Firebase Storage enabled"
                    className="h-9 px-2 rounded-kaya-sm bg-kaya-warm/60 text-kaya-sand text-[11px] font-semibold cursor-not-allowed"
                  >
                    📷 Upload
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Coming soon — image search integration"
                    className="h-9 px-2 rounded-kaya-sm bg-kaya-warm/60 text-kaya-sand text-[11px] font-semibold cursor-not-allowed"
                  >
                    🔍 Search
                  </button>
                </div>

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
          <div>
            <p className="text-xl font-black">{child.streak || 0} 🔥</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Streak</p>
          </div>
        </div>
      </div>

        </div>

        <div className="lg:col-span-7 space-y-5">

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
