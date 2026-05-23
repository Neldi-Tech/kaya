'use client';

// Discover · the family's daily welcome page.
//
// Lives at `/`. Renders three tier-aware variants from the same shell:
//   • Parent  — full visibility, money pulse, all kids
//   • Kid     — personal slice + family-shared blocks
//   • Helper  — work-only view (chores + group photos + payday)
//
// See Kaya-Discover_Design-Proposal-v2_2026-05-16.html for the spec.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { fmt } from '@/lib/format';
import {
  getRecentRatings, getRecentAwards, getMeetings,
  Child, Meeting, Role,
} from '@/lib/firestore';
import { subscribeToFeed, Post, PhotoRef } from '@/lib/moments';
import { subscribeToPendingApprovals } from '@/lib/hive';
import {
  type PurchaseRequest,
  subscribeToOpenRequestsByModule,
} from '@/lib/purchase';
import {
  listWorkplanItems, itemsScheduledOn,
} from '@/lib/workplan';
import { type WorkplanItem } from '@/lib/firestore';
import { useHelperGrants, helperGrantsAllow, type HelperGrants } from '@/lib/useHelperGrants';

type ActivityItem = {
  type: 'rating' | 'award';
  childId: string;
  points: number;
  desc: string;
  date: string;
  by: string;
};

export default function DiscoverPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();

  const role: Role = profile?.role || 'parent';
  const isParent = role === 'parent';
  const isKid = role === 'kid';
  const isHelper = role === 'helper';
  // Helper module grants — drives HelperPriorities subscription set
  // so a helper without Drivers access doesn't see Drivers shop runs
  // (and doesn't open a listen Firestore would reject anyway).
  const grants = useHelperGrants();

  // ─── Data ──────────────────────────────────────────────────────────
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  // null = still loading the feed; [] = loaded, no moments yet. The
  // distinction lets MomentsHero show a skeleton vs the empty invite.
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [nextMeeting, setNextMeeting] = useState<Meeting | null>(null);

  // Activity feed — ratings + awards merged, newest first. Helpers
  // don't see this surface at all (per the access-tier spec).
  useEffect(() => {
    if (!profile?.familyId || isHelper) return;
    let cancelled = false;
    (async () => {
      const [ratings, awards] = await Promise.all([
        getRecentRatings(profile.familyId, 3),
        getRecentAwards(profile.familyId, 3),
      ]);
      if (cancelled) return;
      const items: ActivityItem[] = [
        ...ratings.map((r) => ({
          type: 'rating' as const,
          childId: r.childId,
          points: r.totalPoints,
          desc: `${r.period} routine rated`,
          date: r.date,
          by: r.ratedByName,
        })),
        ...awards.map((a) => ({
          type: 'award' as const,
          childId: a.childId,
          points: a.points,
          desc: a.reason,
          date: a.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '',
          by: a.awardedByName,
        })),
      ]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 6);
      setActivity(items);
    })();
    return () => { cancelled = true; };
  }, [profile?.familyId, isHelper]);

  // Photo mosaic — live feed, first 6. Kids and helpers see the same
  // feed shape today; visibility filtering will land with the
  // public-feed redesign.
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToFeed(profile.familyId, 6, setPosts);
  }, [profile?.familyId]);

  // Money pulse — parent only.
  useEffect(() => {
    if (!profile?.familyId || !isParent) return;
    return subscribeToPendingApprovals(profile.familyId, (reqs) =>
      setPendingApprovals(reqs.length)
    );
  }, [profile?.familyId, isParent]);

  // Next upcoming meeting (today or later). Parents + kids see it.
  useEffect(() => {
    if (!profile?.familyId || isHelper) return;
    let cancelled = false;
    (async () => {
      const meetings = await getMeetings(profile.familyId);
      if (cancelled) return;
      const today = new Date().toISOString().split('T')[0];
      const upcoming = meetings
        .filter((m) => m.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      setNextMeeting(upcoming || null);
    })();
    return () => { cancelled = true; };
  }, [profile?.familyId, isHelper]);

  // ─── Derived ───────────────────────────────────────────────────────
  const firstName = profile?.displayName?.split(' ')[0] || 'there';
  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const sortedKids = useMemo(
    () => [...children].sort((a, b) => (b.weeklyPoints || 0) - (a.weeklyPoints || 0)),
    [children]
  );
  const totalWeekly = children.reduce((s, c) => s + (c.weeklyPoints || 0), 0);
  const topKid = sortedKids[0];

  // The kid who owns this profile (when role === 'kid').
  const ownKid = isKid && profile?.childId
    ? children.find((c) => c.id === profile.childId)
    : undefined;

  return (
    <div className="px-4 lg:px-8 pt-4 lg:pt-6 pb-8">
      <div className="mx-auto max-w-md lg:max-w-6xl">

        {/* ── Greeting ──────────────────────────────────────── */}
        <Greeting
          today={todayStr}
          name={isKid ? (ownKid?.name || firstName) : firstName}
          ownKid={ownKid}
          family={family?.name}
          role={role}
        />

        {/* ── Body grid · 1 col on mobile, main + side rail on lg+ ── */}
        <div className="mt-4 lg:mt-5 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 lg:gap-4">

          {/* Main column */}
          <div className="flex flex-col gap-3 lg:gap-4 min-w-0">
            <RemindersStrip
              role={role}
              pendingApprovals={pendingApprovals}
              nextMeeting={nextMeeting}
              helperName={isHelper ? firstName : undefined}
            />

            {/* Moments hero — top of Discover for kids + parents
                (2026-05-21). Reliable-by-design: skeleton while the
                feed loads, a warm invite when empty, the real hero once
                moments exist — never the old broken empty grid. */}
            {!isHelper && <MomentsHero posts={posts} />}

            {!isHelper && (
              <ActivityFeed
                items={activity}
                kids={children}
                ownChildId={profile?.childId}
                role={role}
              />
            )}

            {isHelper && profile?.familyId && profile?.uid && (
              <HelperPriorities familyId={profile.familyId} uid={profile.uid} grants={grants} />
            )}

            <QuickActions role={role} />
          </div>

          {/* Side rail */}
          <div className="flex flex-col gap-3 lg:gap-4">
            {!isHelper && (
              <FamilyScore
                kids={sortedKids}
                total={totalWeekly}
                topKid={topKid}
                role={role}
                ownChildId={profile?.childId}
              />
            )}

            {isParent && <MoneyPulse pending={pendingApprovals} />}

            {isHelper && <HelperWorkCard name={firstName} />}

            {!isHelper && nextMeeting && (
              <MeetingCard meeting={nextMeeting} role={role} />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sub-components — kept inline so the whole Discover page reads as
// one cohesive surface. Hoist later if any of these get reused.
// ════════════════════════════════════════════════════════════════════

function Greeting({
  today, name, ownKid, family, role,
}: {
  today: string;
  name: string;
  ownKid?: Child;
  family?: string;
  role: Role;
}) {
  const hour = new Date().getHours();
  const period = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] lg:text-[11px] font-bold uppercase tracking-[0.18em] text-kaya-gold-dark">
          {today}
        </div>
        <h1 className="font-display font-black text-[22px] lg:text-3xl leading-tight mt-0.5 truncate">
          {period}, {name}{ownKid?.avatarEmoji ? ` ${ownKid.avatarEmoji}` : ''}
        </h1>
      </div>
      {role === 'kid' && ownKid?.houseName ? (
        <div
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-kaya-warm-dark font-display font-extrabold text-[11px] shrink-0"
          style={{ color: ownKid.houseColor }}
        >
          <span className="text-sm leading-none">{ownKid.avatarEmoji || '🏆'}</span>
          {ownKid.houseName}
        </div>
      ) : family ? (
        <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-kaya-warm-dark font-display font-extrabold text-[11px] text-kaya-chocolate shrink-0">
          🏡 {family}
        </div>
      ) : null}
    </div>
  );
}

function RemindersStrip({
  role, pendingApprovals, nextMeeting, helperName,
}: {
  role: Role;
  pendingApprovals: number;
  nextMeeting: Meeting | null;
  helperName?: string;
}) {
  type Reminder = {
    tone: 'warn' | 'gold' | 'ok';
    label: string;
    title: string;
    sub: string;
    href: string;
  };
  const reminders: Reminder[] = [];

  if (nextMeeting) {
    const meetDate = new Date(nextMeeting.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = meetDate.toDateString() === today.toDateString();
    reminders.push({
      tone: isToday ? 'warn' : 'gold',
      label: isToday ? '⚠ Today' : `★ ${meetDate.toLocaleDateString('en-US', { weekday: 'short' })}`,
      title: 'Family meeting',
      sub: nextMeeting.type === 'weekly' ? 'Gratitude · Awards · Rewards' : nextMeeting.type,
      href: '/meetings',
    });
  }

  if (role === 'parent' && pendingApprovals > 0) {
    reminders.push({
      tone: 'warn',
      label: `$ ${pendingApprovals} pending`,
      title: 'Approvals waiting',
      sub: 'Kids need a yes / no on Hive requests',
      href: '/parent/approvals',
    });
  }

  if (role === 'kid') {
    reminders.push({
      tone: 'gold',
      label: '☀️ Today',
      title: 'Morning routine',
      sub: 'Bed · brush · breakfast',
      href: '/rate?period=morning',
    });
  }

  if (role === 'helper') {
    reminders.push({
      tone: 'gold',
      label: '📋 Today',
      title: 'Your assigned tasks',
      sub: 'Open the list to mark them done',
      href: '/pantry/workplan',
    });
    // 2026-05-19 — Removed the "$ Paid · Salary received · Last cycle
    // was on time" reminder. It was a hardcoded placeholder: the label
    // pre-pended a literal `$` regardless of the family's currency,
    // and "Last cycle was on time" was static text not backed by any
    // payCheckIn / payroll data. Real payday signal lives on /helper
    // (PayCheckInCard); the helper home doesn't need a fake duplicate.
  }

  // Default fallback so the strip is never empty.
  if (reminders.length === 0) {
    reminders.push({
      tone: 'ok',
      label: '✓ All clear',
      title: "Nothing urgent today",
      sub: 'Enjoy the calm — come back later.',
      href: '/home',
    });
  }

  const stripe: Record<Reminder['tone'], string> = {
    warn: 'before:bg-kaya-gold',
    gold: 'before:bg-kaya-gold-dark',
    ok: 'before:bg-pantry-leaf',
  };
  const labelColor: Record<Reminder['tone'], string> = {
    warn: 'text-kaya-gold-dark',
    gold: 'text-kaya-gold-dark',
    ok: 'text-pantry-leaf-dk',
  };

  return (
    <div className="-mx-1 px-1 overflow-x-auto scrollbar-none">
      <div className="flex gap-2 min-w-min">
        {reminders.map((r, i) => (
          <Link
            key={i}
            href={r.href}
            className={`relative shrink-0 w-[72%] sm:w-[280px] lg:flex-1 lg:w-auto bg-white border border-kaya-warm-dark rounded-kaya px-3 pl-4 py-2.5 overflow-hidden before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${stripe[r.tone]} hover:border-kaya-chocolate transition-colors`}
          >
            <div className={`font-display font-extrabold text-[9.5px] uppercase tracking-wider ${labelColor[r.tone]}`}>
              {r.label}
            </div>
            <div className="font-display font-black text-[13px] text-kaya-chocolate leading-tight mt-0.5">{r.title}</div>
            <div className="text-[11px] text-kaya-sand mt-0.5 leading-snug">{r.sub}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Moments hero (2026-05-21) — the family feed, lifted to the top of
// Discover and made reliable. Replaces the old PhotoMosaic, which was
// disabled in prod because the empty gradient grid looked broken and
// photos loaded flakily. Now: a calm skeleton while loading
// (posts === null), a warm invite when empty, and a featured-photo
// hero + recent strip once moments exist. Each image fails closed to
// its gradient (see MomentImage) so one bad URL can't break the row.
function MomentsHero({ posts }: { posts: Post[] | null }) {
  if (posts === null) {
    return (
      <div>
        <MomentsHeader showOpen={false} />
        <div className="rounded-kaya overflow-hidden aspect-[16/10] bg-kaya-warm animate-pulse" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div>
        <MomentsHeader showOpen={false} />
        <Link
          href="/moments/new"
          className="block text-center rounded-kaya border border-kaya-warm-dark bg-gradient-to-b from-white to-[#FBF3DF] px-4 py-7 no-underline"
        >
          <div className="text-3xl">📸</div>
          <p className="font-display font-black text-[14px] text-kaya-chocolate mt-1">Share your first moment</p>
          <p className="text-[11px] text-kaya-sand mt-1">A photo or video of today — the family will see it here.</p>
          <span className="inline-flex items-center gap-1.5 mt-3 bg-kaya-gold text-white font-display font-black text-[11px] px-4 py-2 rounded-full">
            ＋ Add a moment
          </span>
        </Link>
      </div>
    );
  }

  const featured = posts[0];
  const rest = posts.slice(1, 5);

  return (
    <div>
      <MomentsHeader />
      {/* Featured — most-recent moment, big. */}
      <Link
        href={`/moments/${featured.id}`}
        className="relative block rounded-kaya overflow-hidden aspect-[16/10] bg-gradient-to-br from-[#F5C465] to-[#D4A017] no-underline group"
      >
        <MomentImage photo={featured.photos?.[0]} caption={featured.caption} className="object-cover group-hover:scale-105 transition-transform duration-300" />
        {featured.eventTag && (
          <span className="absolute top-2 right-2 bg-black/40 text-white font-display font-extrabold text-[9px] px-2 py-0.5 rounded-full backdrop-blur-sm">
            {featured.eventTag.emoji} {featured.eventTag.label}
          </span>
        )}
        <div className="absolute left-3 right-3 bottom-2.5 text-white">
          {featured.caption && (
            <p className="font-display font-black text-[14px] leading-tight drop-shadow-md line-clamp-2">{featured.caption}</p>
          )}
          <p className="text-[10px] mt-1 drop-shadow-md opacity-95">
            ❤️ {featured.reactionCount ?? 0} · 💬 {featured.commentCount ?? 0}
          </p>
        </div>
      </Link>

      {/* Recent strip — up to four more, each linking to its moment. */}
      {rest.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
          {rest.map((p) => (
            <Link
              key={p.id}
              href={`/moments/${p.id}`}
              className="relative block rounded-md overflow-hidden aspect-square bg-gradient-to-br from-[#7B9DB7] to-[#2C5C7E] no-underline"
            >
              <MomentImage photo={p.photos?.[0]} caption={p.caption} className="object-cover" />
            </Link>
          ))}
        </div>
      )}

      {/* Share CTA. */}
      <Link
        href="/moments/new"
        className="mt-1.5 flex items-center justify-center gap-1.5 border border-dashed border-kaya-warm-dark rounded-kaya py-2 font-display font-extrabold text-[11px] text-kaya-gold-dark bg-white no-underline hover:border-kaya-gold"
      >
        ＋ Share a moment
      </Link>
    </div>
  );
}

function MomentsHeader({ showOpen = true }: { showOpen?: boolean }) {
  return (
    <div className="flex items-end justify-between mb-2 px-0.5">
      <h2 className="font-display font-black text-[15px] flex items-center gap-1.5">📸 Moments</h2>
      {showOpen && (
        <Link href="/moments" className="font-display font-extrabold text-[10.5px] text-kaya-gold-dark uppercase tracking-wider no-underline">
          Open →
        </Link>
      )}
    </div>
  );
}

// One moment photo with graceful fallback — if the image errors (the
// old prod flakiness), we hide it and let the parent's gradient show
// through instead of a broken-image icon.
function MomentImage({ photo, caption, className }: { photo?: PhotoRef; caption?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = photo?.feedUrl || photo?.thumbUrl;
  if (!url || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={caption || 'Moment'}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`absolute inset-0 w-full h-full ${className ?? 'object-cover'}`}
    />
  );
}

function ActivityFeed({
  items, kids, ownChildId, role,
}: {
  items: ActivityItem[];
  kids: Child[];
  ownChildId?: string;
  role: Role;
}) {
  // Kid view only shows activity touching them.
  const visible = role === 'kid' && ownChildId
    ? items.filter((it) => it.childId === ownChildId)
    : items;

  const childById = (id: string) => kids.find((k) => k.id === id);

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h2 className="font-display font-black text-[13px] flex items-center gap-2">
          <span className="relative inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-pantry-leaf" />
            <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-pantry-leaf animate-ping opacity-60" />
          </span>
          {role === 'kid' ? 'Your week' : 'Live activity'}
        </h2>
        <span className="font-display font-extrabold text-[10px] text-kaya-sand uppercase tracking-wider">
          Last 24h
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-kaya-sand border-t border-kaya-warm-dark">
          Nothing yet — rate a routine or award a point to start.
        </div>
      ) : (
        visible.map((it, i) => {
          const kid = childById(it.childId);
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 py-2 border-t border-kaya-warm-dark"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
                style={{ backgroundColor: `${kid?.houseColor || '#9B8A72'}30` }}
              >
                {kid?.avatarEmoji || '👤'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-kaya-chocolate leading-snug truncate">
                  <span className="font-display font-black">{kid?.name || 'Unknown'}</span>
                  {' '}
                  · {it.desc}
                </div>
                <div className="text-[9.5px] text-kaya-sand font-display font-bold uppercase tracking-wider mt-0.5">
                  {it.by || it.date}
                </div>
              </div>
              <div className="font-display font-black text-[11px] text-kaya-gold-dark bg-kaya-gold-light px-2 py-1 rounded-full">
                {it.points > 0 ? '+' : ''}{it.points}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function FamilyScore({
  kids, total, topKid, role, ownChildId,
}: {
  kids: Child[];
  total: number;
  topKid?: Child;
  role: Role;
  ownChildId?: string;
}) {
  const ownKid = role === 'kid' && ownChildId
    ? kids.find((k) => k.id === ownChildId)
    : undefined;
  const displayTotal = ownKid ? (ownKid.weeklyPoints || 0) : total;
  const maxPts = Math.max(1, ...kids.map((k) => k.weeklyPoints || 0));
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya p-4 text-white">
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-kaya-gold/30 blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="font-display font-extrabold text-[9.5px] text-kaya-gold-light uppercase tracking-[0.16em]">
          {ownKid ? 'My points · this week' : 'Family score · this week'}
        </div>
        <div className="font-display font-black text-[34px] leading-none mt-1">{fmt(displayTotal)}</div>
        <div className="text-[11px] text-kaya-gold-light/85 mt-1">
          {ownKid
            ? (ownKid.houseName ? `${ownKid.avatarEmoji || '🏆'} ${ownKid.houseName} house` : 'Your week so far')
            : topKid
              ? `${topKid.avatarEmoji || '🏆'} ${topKid.name} leads · ${fmt(topKid.weeklyPoints || 0)} pts`
              : 'No kids yet'}
        </div>
        {kids.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {kids.slice(0, 3).map((k) => {
              const pct = ((k.weeklyPoints || 0) / maxPts) * 100;
              return (
                <div key={k.id} className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] shrink-0"
                    style={{ backgroundColor: `${k.houseColor || '#9B8A72'}40` }}
                  >
                    {k.avatarEmoji || '👤'}
                  </div>
                  <div className="font-display font-bold text-[10.5px] w-12 truncate">{k.name}</div>
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: k.houseColor || '#D4A017' }} />
                  </div>
                  <div className="font-display font-black text-[10px] text-kaya-gold-light w-8 text-right">
                    {fmt(k.weeklyPoints || 0)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MoneyPulse({ pending }: { pending: number }) {
  return (
    <div className="bg-gradient-to-br from-[#FFE6D9] to-white border border-hive-honey rounded-kaya p-4">
      <div className="font-display font-extrabold text-[10px] text-hive-honey-dk uppercase tracking-[0.16em] flex items-center gap-1.5">
        💰 Money pulse
      </div>
      <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] font-display font-extrabold">
        <div className="flex justify-between"><span>Pending approvals</span><span className="font-black text-hive-honey-dk">{pending}</span></div>
        <div className="flex justify-between"><span>Wallet activity</span><span className="font-black text-hive-honey-dk">Live</span></div>
      </div>
      <Link
        href="/parent/approvals"
        className="block mt-3 text-center bg-hive-honey hover:bg-hive-honey-dk text-white font-display font-extrabold text-[12px] py-2 rounded-kaya-sm transition-colors"
      >
        {pending > 0 ? `Review ${pending} approval${pending === 1 ? '' : 's'} →` : 'Open the Hive →'}
      </Link>
    </div>
  );
}

function MeetingCard({ meeting, role }: { meeting: Meeting; role: Role }) {
  const meetDate = new Date(meeting.date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = meetDate.toDateString() === today.toDateString();
  const dayLabel = isToday
    ? 'Tonight'
    : meetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf rounded-kaya p-4">
      <div className="font-display font-extrabold text-[10px] text-pantry-leaf-dk uppercase tracking-[0.14em]">
        {dayLabel}
      </div>
      <div className="font-display font-black text-[15px] mt-1 leading-tight">
        {role === 'kid' ? 'Share a win at the meeting' : 'Weekly family meeting'}
      </div>
      <div className="text-[11px] text-pantry-leaf-dk/90 mt-1 leading-snug">
        {role === 'kid' ? 'Pick something you are proud of.' : 'Gratitude · Awards · Rewards'}
      </div>
      <Link
        href="/meetings"
        className="inline-block mt-3 bg-pantry-leaf-dk hover:opacity-90 text-white font-display font-extrabold text-[11px] py-2 px-4 rounded-kaya-sm transition-opacity"
      >
        {role === 'kid' ? 'Prep' : 'Open agenda'}
      </Link>
    </div>
  );
}

function QuickActions({ role }: { role: Role }) {
  const sets: Record<Role, { emoji: string; label: string; href: string }[]> = {
    parent: [
      { emoji: '📋', label: 'Rate', href: '/rate' },
      { emoji: '🎖️', label: 'Award', href: '/award' },
      { emoji: '✓', label: 'Approve', href: '/parent/approvals' },
      { emoji: '📸', label: 'Moment', href: '/moments/new' },
    ],
    kid: [
      { emoji: '📋', label: 'Rate me', href: '/rate' },
      { emoji: '🐷', label: 'Wallet', href: '/hive' },
      { emoji: '🏆', label: 'Badges', href: '/badges' },
      { emoji: '📸', label: 'Moment', href: '/moments/new' },
    ],
    helper: [
      { emoji: '✓', label: 'Done', href: '/pantry' },
      { emoji: '🛒', label: 'Pantry', href: '/pantry' },
      { emoji: '📸', label: 'Photo', href: '/moments/new' },
      { emoji: '💬', label: 'Message', href: '/directory' },
    ],
    // Guests get the view-only essentials — no Rate / Award / write
    // actions. Surfacing Home, Badges, Moments, and Directory so they
    // can keep up with the family without contributing changes.
    guest: [
      { emoji: '🏠', label: 'Home',    href: '/' },
      { emoji: '🏆', label: 'Badges',  href: '/badges' },
      { emoji: '📸', label: 'Moments', href: '/moments' },
      { emoji: '💬', label: 'Family',  href: '/directory' },
    ],
  };
  const actions = sets[role];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="bg-white border border-kaya-warm-dark hover:border-kaya-chocolate rounded-kaya-sm py-2.5 px-2 text-center transition-colors"
        >
          <div className="text-lg leading-none">{a.emoji}</div>
          <div className="font-display font-extrabold text-[9.5px] text-kaya-chocolate mt-1.5">{a.label}</div>
        </Link>
      ))}
    </div>
  );
}

// ─── Helper-only blocks ───────────────────────────────────────────────

// HelperPriorities — real helper home card (2026-05-19, replaces the
// HelperTasks placeholder). Two stacked lists:
//   1. Today's workplan items (real, from listWorkplanItems)
//   2. Shop runs ready — approved + reconciling Purchase / Outdoor /
//      Drivers / Utility requests
// Both are tappable; the row deep-links to the right detail page.
function HelperPriorities({ familyId, uid, grants }: { familyId: string; uid: string; grants: HelperGrants }) {
  const [workplan, setWorkplan] = useState<WorkplanItem[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);

  // Today's workplan — one-shot read; cheap enough not to need a sub.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await listWorkplanItems(familyId, uid);
        if (cancelled) return;
        // itemsScheduledOn takes a Date; default = today.
        setWorkplan(itemsScheduledOn(all));
      } catch { /* swallow — helper page still renders */ }
    })();
    return () => { cancelled = true; };
  }, [familyId, uid]);

  // Approved + reconciling requests across the 4 non-payroll modules.
  // Subscribes ONLY to modules this helper has view tier on (so a
  // gardener doesn't see Drivers shop runs etc.). Module-scoped
  // subscriptions avoid the payroll permission_denied wall — see
  // purchase.ts comment for the rationale.
  useEffect(() => {
    const buckets: Record<string, PurchaseRequest[]> = { pantry: [], outdoor: [], drivers: [], utility: [] };
    const refresh = () => {
      const merged = [...buckets.pantry, ...buckets.outdoor, ...buckets.drivers, ...buckets.utility]
        .filter((r) => r.status === 'approved' || r.status === 'reconciling')
        .sort((a, b) => (b.approvedAt?.toMillis?.() ?? 0) - (a.approvedAt?.toMillis?.() ?? 0));
      setRequests(merged);
    };
    const allowedModules = (['pantry', 'outdoor', 'drivers', 'utility'] as const)
      .filter((m) => helperGrantsAllow(grants, `household:${m === 'pantry' ? 'purchase' : m}`));
    const unsubs = allowedModules.map((m) =>
      subscribeToOpenRequestsByModule(familyId, m, (r) => { buckets[m] = r; refresh(); }),
    );
    return () => { unsubs.forEach((u) => u()); };
  }, [familyId, grants]);

  const remainingCount = workplan.length + requests.length;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h2 className="font-display font-black text-[13px]">Today's priorities</h2>
        <span className="font-display font-extrabold text-[10px] text-kaya-sand uppercase tracking-wider">
          {remainingCount} item{remainingCount === 1 ? '' : 's'}
        </span>
      </div>

      {/* Approved shop runs first — they have time pressure (12h
          reconcile window) so the helper sees them top-of-card. */}
      {requests.length > 0 && (
        <>
          {requests.slice(0, 4).map((r) => {
            const moduleIcon = moduleEmoji(r.module);
            const isReconciling = r.status === 'reconciling';
            return (
              <Link
                key={r.id}
                href={`/pantry/purchase/${r.id}`}
                className="flex items-center gap-2.5 px-3 py-2 border-t border-kaya-warm-dark no-underline hover:bg-kaya-cream/40"
              >
                <div className="w-7 h-7 rounded-full bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-[14px] shrink-0">{moduleIcon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-black text-[12px] truncate text-kaya-ink">{r.name || 'Untitled request'}</div>
                  <div className="text-[10px] text-kaya-sand font-display font-bold mt-0.5">
                    {r.items.length} item{r.items.length === 1 ? '' : 's'} · {isReconciling ? 'reconciling' : 'approved · go shop'}
                  </div>
                </div>
                <div className={`font-display font-extrabold text-[10px] px-2 py-1 rounded-full ${
                  isReconciling
                    ? 'text-hive-honey-dk bg-[#FFF3D9]'
                    : 'text-pantry-leaf-dk bg-pantry-leaf-soft'
                }`}>
                  {isReconciling ? 'Close out' : 'Shop now'}
                </div>
              </Link>
            );
          })}
          {requests.length > 4 && (
            <Link
              href="/pantry/purchase"
              className="flex items-center justify-center px-3 py-2 border-t border-kaya-warm-dark no-underline text-kaya-gold-dark font-display font-extrabold text-[11px]"
            >
              + {requests.length - 4} more shop run{requests.length - 4 === 1 ? '' : 's'} →
            </Link>
          )}
        </>
      )}

      {/* Today's workplan tasks. */}
      {workplan.length > 0 && (
        <>
          {workplan.slice(0, 4).map((t) => (
            <Link
              key={t.id}
              href="/pantry/workplan"
              className="flex items-center gap-2.5 px-3 py-2 border-t border-kaya-warm-dark no-underline hover:bg-kaya-cream/40"
            >
              <div className="w-7 h-7 rounded-full bg-kaya-warm-dark/60 text-kaya-sand flex items-center justify-center text-[12px] shrink-0">
                {t.icon || '✓'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-black text-[12px] truncate text-kaya-ink">{t.label}</div>
                <div className="text-[10px] text-kaya-sand font-display font-bold mt-0.5">Today's workplan</div>
              </div>
              <div className="font-display font-extrabold text-[10px] text-kaya-gold-dark bg-kaya-gold-light px-2 py-1 rounded-full">Open</div>
            </Link>
          ))}
          {workplan.length > 4 && (
            <Link
              href="/pantry/workplan"
              className="flex items-center justify-center px-3 py-2 border-t border-kaya-warm-dark no-underline text-kaya-gold-dark font-display font-extrabold text-[11px]"
            >
              + {workplan.length - 4} more task{workplan.length - 4 === 1 ? '' : 's'} →
            </Link>
          )}
        </>
      )}

      {/* Empty state. */}
      {requests.length === 0 && workplan.length === 0 && (
        <div className="px-3 py-6 text-center border-t border-kaya-warm-dark">
          <div className="text-2xl mb-1">🌤️</div>
          <div className="font-display font-black text-[13px] text-kaya-ink">All clear</div>
          <div className="text-[11px] text-kaya-sand font-display font-bold mt-0.5">No shop runs or tasks waiting on you right now.</div>
        </div>
      )}
    </div>
  );
}

// Module → emoji for the helper priorities card.
function moduleEmoji(m: PurchaseRequest['module'] | undefined): string {
  switch (m) {
    case 'pantry':  return '🧾';
    case 'outdoor': return '🌿';
    case 'drivers': return '🚗';
    case 'utility': return '⚡';
    case 'payroll': return '🤝';
    default:        return '🧾';
  }
}

function HelperWorkCard({ name }: { name: string }) {
  return (
    <div className="bg-gradient-to-br from-[#FFE6D9] to-white border border-hive-honey rounded-kaya p-4">
      <div className="font-display font-extrabold text-[10px] text-hive-honey-dk uppercase tracking-[0.16em] flex items-center gap-1.5">
        💼 Your work
      </div>
      <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] font-display font-extrabold">
        <div className="flex justify-between"><span>Hours this week</span><span className="font-black text-hive-honey-dk">—</span></div>
        <div className="flex justify-between"><span>Next payday</span><span className="font-black text-hive-honey-dk">Soon</span></div>
      </div>
      <div className="mt-3 text-[11px] text-kaya-sand">
        Hi {name} — a fuller helper dashboard is coming soon.
      </div>
    </div>
  );
}
