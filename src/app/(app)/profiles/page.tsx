'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, updateChild, BADGES, DailyRating, Award } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

export default function ProfilesPage() {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState(0);
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [managingBadges, setManagingBadges] = useState(false);
  const [savingBadge, setSavingBadge] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState(false);
  const [photoInput, setPhotoInput] = useState('');
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');

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

  const startEditingPhoto = () => {
    setPhotoInput(child?.avatarPhoto || '');
    setPhotoError('');
    setEditingPhoto(true);
  };

  const cancelEditingPhoto = () => {
    setEditingPhoto(false);
    setPhotoError('');
  };

  const savePhoto = async (urlOverride?: string) => {
    if (!profile?.familyId || !child || isGuest) return;
    const url = (urlOverride !== undefined ? urlOverride : photoInput).trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setPhotoError('Use a full URL starting with https://');
      return;
    }
    setSavingPhoto(true);
    setPhotoError('');
    try {
      await updateChild(profile.familyId, child.id, { avatarPhoto: url });
      setEditingPhoto(false);
    } catch (e: any) {
      setPhotoError(e.message || 'Failed to save');
    }
    setSavingPhoto(false);
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
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Kid Profiles</h1>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
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

      {/* Profile card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 mb-5 text-center">
        <div className="mx-auto mb-3 inline-block">
          <KidAvatar child={child} size="xl" />
        </div>
        {isParent && !isGuest && (
          <div className="mb-3">
            {!editingPhoto ? (
              <button
                onClick={startEditingPhoto}
                className="text-[11px] text-kaya-gold font-semibold hover:underline"
              >
                {child.avatarPhoto ? 'Change photo' : '+ Add photo'}
              </button>
            ) : (
              <div className="space-y-2 text-left">
                <label className="block text-[10px] font-semibold text-kaya-sand uppercase tracking-wider">
                  Photo URL
                </label>
                <input
                  value={photoInput}
                  onChange={(e) => setPhotoInput(e.target.value)}
                  className="w-full h-9 px-3 bg-kaya-cream rounded-kaya-sm text-xs focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
                  placeholder="https://example.com/avatar.jpg"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePhoto();
                    if (e.key === 'Escape') cancelEditingPhoto();
                  }}
                />
                <p className="text-[10px] text-kaya-sand">
                  Paste any image URL (Google Drive “view” links won&apos;t embed — use a direct image link).
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => savePhoto()}
                    disabled={savingPhoto}
                    className="h-8 px-3 bg-kaya-gold text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
                  >
                    {savingPhoto ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditingPhoto}
                    disabled={savingPhoto}
                    className="h-8 px-3 bg-kaya-warm rounded-kaya-sm text-xs font-semibold text-kaya-sand"
                  >
                    Cancel
                  </button>
                  {child.avatarPhoto && (
                    <button
                      onClick={() => savePhoto('')}
                      disabled={savingPhoto}
                      className="h-8 px-3 text-xs font-semibold text-kaya-sand hover:text-red-500 ml-auto"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {photoError && <p className="text-red-500 text-[11px]">{photoError}</p>}
              </div>
            )}
          </div>
        )}
        <h2 className="font-display text-xl font-black">{child.name}</h2>
        <p className="text-sm font-semibold" style={{ color: child.houseColor }}>{child.houseName}</p>

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

      {/* 7-day activity */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-5">
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
      <div className="mb-5">
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
  );
}
