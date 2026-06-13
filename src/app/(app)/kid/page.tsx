'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  BADGES, getWishlist, WishlistItem,
  readPointSystemConfig, sendKidKudos, Child,
} from '@/lib/firestore';
import { daysToNextBirthday, ageAtNextBirthday } from '@/lib/dates';
import KidAvatar from '@/components/ui/KidAvatar';
import MeetingPrepCard from '@/components/meetings/MeetingPrepCard';

// Quick-pick reason chips for the appreciation form. Plain English so a
// 6-year-old can tap without typing — they can still type a custom note.
const APPRECIATION_PRESETS = [
  'for sharing',
  'for helping me',
  'for being kind',
  'for making me laugh',
  'for cheering me up',
];

const fmt = (n: number) => n.toLocaleString('en-US');

// Compact card that lets a kid send a 0-point "Kudos" to a sibling.
// Renders only when the family has opted in (`kudos.kidToKidEnabled`)
// AND the kid has at least one sibling. Mirrors the daily-cap behaviour
// in `sendKidKudos`: counter resets per calendar day.
function AppreciationCard({
  familyId,
  me,
  siblings,
  senderUid,
  senderName,
  dailyCap,
}: {
  familyId: string;
  me: Child;
  siblings: Child[];
  senderUid: string;
  senderName: string;
  dailyCap: number;
}) {
  const [selectedSibling, setSelectedSibling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSentTo, setJustSentTo] = useState<string | null>(null);

  // Mirror the sender's own counter so the "X / cap sent today" indicator
  // updates immediately on send. Initialised from the live Child doc.
  const today = new Date().toISOString().slice(0, 10);
  const initialCount = me.dailyKudosSentDate === today ? (me.dailyKudosSentCount ?? 0) : 0;
  const [sentToday, setSentToday] = useState(initialCount);
  const atCap = sentToday >= dailyCap;

  const handleSend = async () => {
    if (!selectedSibling || !reason.trim() || sending || atCap) return;
    setSending(true);
    setError(null);
    try {
      await sendKidKudos(
        familyId,
        me.id,
        senderUid,
        senderName,
        selectedSibling,
        reason.trim(),
        'kindness',
      );
      const recipient = siblings.find((s) => s.id === selectedSibling);
      setJustSentTo(recipient?.name ?? 'them');
      setSentToday((n) => n + 1);
      setSelectedSibling(null);
      setReason('');
      // Auto-clear the success banner after a few seconds so the form
      // is ready for the next send (assuming the kid is under the cap).
      setTimeout(() => setJustSentTo(null), 3500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
    setSending(false);
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand">💛 Send appreciation</p>
        <span className="text-[10px] text-kaya-sand-light">{sentToday} / {dailyCap} today</span>
      </div>
      {justSentTo && (
        <div className="mt-2 mb-2 bg-kaya-gold/10 border border-kaya-gold/40 rounded-kaya-sm p-2 text-[12px] text-kaya-chocolate">
          💛 Sent to <span className="font-bold">{justSentTo}</span>!
        </div>
      )}
      {atCap ? (
        <p className="text-[11px] text-kaya-sand leading-snug mt-1">
          You&apos;ve sent {dailyCap} appreciations today. Come back tomorrow!
        </p>
      ) : (
        <>
          <p className="text-[11px] text-kaya-sand leading-snug mb-2">Tell a sibling something nice.</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {siblings.map((s) => {
              const sel = selectedSibling === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSibling(sel ? null : s.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-bold transition-all ${
                    sel
                      ? 'border-kaya-gold bg-kaya-gold/10 text-kaya-chocolate'
                      : 'border-kaya-warm-dark bg-white text-kaya-sand'
                  }`}
                >
                  <KidAvatar child={s} size="xs" />
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
          {selectedSibling && (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {APPRECIATION_PRESETS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setReason(p)}
                    className="px-2 py-0.5 rounded-full border border-kaya-warm-dark bg-kaya-warm/40 text-[10px] text-kaya-chocolate hover:bg-kaya-warm"
                  >
                    {p}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="…or write your own"
                maxLength={140}
                className="w-full px-3 py-2 rounded-kaya-sm border border-kaya-warm-dark text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/50 focus:border-kaya-gold"
              />
              {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
              <button
                onClick={handleSend}
                disabled={!reason.trim() || sending}
                className="w-full mt-2 py-2 rounded-kaya-sm bg-kaya-gold text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : 'Send 💛'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function KidPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children, family } = useFamily();

  const myChild = children.find((c) => c.id === profile?.childId) || children[0];
  const pointSystem = readPointSystemConfig(family);
  const siblings = myChild ? children.filter((c) => c.id !== myChild.id) : [];
  const canSendAppreciation = !!(
    profile?.role === 'kid'
    && profile.uid
    && profile.familyId
    && myChild
    && siblings.length > 0
    && pointSystem.kudos.kidToKidEnabled
  );

  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  useEffect(() => {
    if (!profile?.familyId || !myChild) return;
    getWishlist(profile.familyId, myChild.id).then(setWishlist).catch(() => setWishlist([]));
  }, [profile?.familyId, myChild?.id]);
  const activeWishes = wishlist.filter((w) => !w.achieved);

  if (!myChild) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 pt-12 lg:pt-20 text-center">
        <p className="text-5xl mb-3">👋</p>
        <p className="text-kaya-sand text-sm">Ask your parent to link your account to your profile.</p>
      </div>
    );
  }

  const earnedBadges = BADGES.filter((b) => (myChild.badges || []).includes(b.id));
  const nextBadge = BADGES.find((b) => !(myChild.badges || []).includes(b.id));

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      {/* Sunday-Meeting v2 (b2) prep card — kids' "Home" page, the surface
          they land on after sign-in. Same component renders on /workplan
          and /my-day; whichever surface a family enables, the card finds
          them. */}
      {profile?.uid && profile.role === 'kid' && (
        <MeetingPrepCard
          meId={profile.uid}
          role="kid"
          name={(myChild.name || '').split(' ')[0]}
          childId={myChild.id}
          avatarEmoji={myChild.avatarEmoji}
        />
      )}

      {/* Hero card */}
      <div
        className="rounded-kaya-lg p-6 lg:p-10 mb-5 lg:mb-6 text-center text-white shadow-lg lg:shadow-xl relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${myChild.houseColor}, ${myChild.houseColor}CC)` }}
      >
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/15 blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="mx-auto mb-3 lg:mb-5 inline-block">
            <KidAvatar child={myChild} size="xl" bgOpacity="40" />
          </div>
          <h1 className="font-display text-2xl lg:text-[40px] font-black lg:font-extrabold tracking-tight mb-0.5">{myChild.name}</h1>
          <p className="text-white/80 text-sm lg:text-base font-medium mb-5 lg:mb-7">{myChild.houseName} House</p>

          <div className="flex justify-around lg:justify-center lg:gap-16">
            <div>
              <p className="text-3xl lg:text-5xl font-display font-black">{fmt(myChild.totalPoints || 0)}</p>
              <p className="text-white/70 text-xs lg:text-sm font-medium mt-1">Total points</p>
            </div>
            <div className="w-px bg-white/20" />
            <div>
              <p className="text-3xl lg:text-5xl font-display font-black">{myChild.streak || 0} 🔥</p>
              <p className="text-white/70 text-xs lg:text-sm font-medium mt-1">Day streak</p>
            </div>
            <div className="hidden lg:block w-px bg-white/20" />
            <div className="hidden lg:block">
              <p className="text-3xl lg:text-5xl font-display font-black">{earnedBadges.length}</p>
              <p className="text-white/70 text-sm font-medium mt-1">Badges</p>
            </div>
          </div>
        </div>
      </div>

      {/* Birthday countdown — only visible if birthday is set and within range */}
      {(() => {
        if (!myChild.birthday) return null;
        const d = daysToNextBirthday(myChild.birthday);
        if (d === null || d > 90) return null;
        const nextAge = ageAtNextBirthday(myChild.birthday);
        return (
          <div className="bg-gradient-to-r from-kaya-gold-light to-kaya-warm border border-kaya-gold/40 rounded-kaya p-4 lg:p-5 mb-5 lg:mb-6 flex items-center gap-3 lg:gap-4">
            <div className="text-3xl lg:text-4xl shrink-0">🎂</div>
            <div className="flex-1 min-w-0">
              {d === 0 ? (
                <>
                  <p className="font-display font-extrabold text-base lg:text-xl text-kaya-chocolate">Happy birthday, {myChild.name}!</p>
                  <p className="text-[12px] lg:text-sm text-kaya-chocolate/70">It&apos;s your big day. 🎉</p>
                </>
              ) : (
                <>
                  <p className="font-display font-extrabold text-base lg:text-xl text-kaya-chocolate">
                    {d} day{d === 1 ? '' : 's'} to your {nextAge && `${nextAge}th`} birthday
                  </p>
                  <p className="text-[12px] lg:text-sm text-kaya-chocolate/70">Counting down…</p>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div className="lg:grid lg:grid-cols-12 lg:gap-6">
        {/* Left: next badge + quick links */}
        <div className="lg:col-span-4 space-y-3 lg:space-y-4 mb-5 lg:mb-0">
          {nextBadge && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5 flex items-center gap-3">
              <div className="text-3xl lg:text-4xl opacity-50 shrink-0">{nextBadge.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-kaya-sand font-bold uppercase tracking-wider">Next badge</p>
                <p className="text-sm lg:text-base font-bold">{nextBadge.name}</p>
                <p className="text-[11px] lg:text-xs text-kaya-sand leading-snug">{nextBadge.description}</p>
              </div>
              <span className="text-xs text-kaya-gold font-bold">Go!</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:gap-4">
            <button
              onClick={() => router.push('/badges')}
              className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-6 bg-white border border-kaya-warm-dark rounded-kaya hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <span className="text-2xl lg:text-3xl">🏆</span>
              <span className="text-xs lg:text-sm font-bold">All badges</span>
            </button>
            <button
              onClick={() => router.push('/rewards')}
              className="flex flex-col items-center gap-2 lg:gap-3 p-5 lg:p-6 bg-white border border-kaya-warm-dark rounded-kaya hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <span className="text-2xl lg:text-3xl">🎁</span>
              <span className="text-xs lg:text-sm font-bold">Rewards store</span>
            </button>
          </div>

          {/* Kid → kid appreciation note. Opt-in by parents via Settings,
              hidden for only-children. */}
          {canSendAppreciation && profile && myChild && (
            <AppreciationCard
              familyId={profile.familyId!}
              me={myChild}
              siblings={siblings}
              senderUid={profile.uid}
              senderName={profile.displayName || myChild.name}
              dailyCap={pointSystem.kudos.kidDailyCap ?? 3}
            />
          )}

          {/* My wishlist (read-only for kids — parents add items in Profiles) */}
          {activeWishes.length > 0 && (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand">My wishlist</p>
                <span className="text-[11px] text-kaya-sand">{activeWishes.length}</span>
              </div>
              <div className="space-y-1.5">
                {activeWishes.slice(0, 5).map((w) => (
                  <div key={w.id} className="flex items-center gap-2 text-[12px]">
                    <span className="text-kaya-gold">✨</span>
                    <span className="font-semibold truncate flex-1">{w.title}</span>
                  </div>
                ))}
                {activeWishes.length > 5 && (
                  <p className="text-[10px] text-kaya-sand-light pt-1">+ {activeWishes.length - 5} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: badges earned */}
        <div className="lg:col-span-8">
          <h2 className="font-display text-base lg:text-lg font-bold mb-3">
            My badges{earnedBadges.length > 0 && <span className="text-kaya-sand text-sm font-medium ml-2">{earnedBadges.length} earned</span>}
          </h2>
          {earnedBadges.length > 0 ? (
            <div className="grid grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
              {earnedBadges.map((b) => (
                <div key={b.id} className="bg-white border border-kaya-gold/40 rounded-kaya lg:rounded-kaya-lg p-3 lg:p-4 text-center shadow-sm">
                  <div className="text-2xl lg:text-3xl mb-1.5">{b.icon}</div>
                  <p className="text-[11px] lg:text-xs font-bold leading-tight">{b.name}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-8 lg:p-12 text-center">
              <p className="text-4xl lg:text-5xl mb-3">⭐</p>
              <p className="text-sm font-bold mb-1">No badges yet</p>
              <p className="text-xs text-kaya-sand">Earn your first points and your First Star badge unlocks automatically!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
