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
import { subscribeToFeed, Post } from '@/lib/moments';
import { subscribeToPendingApprovals } from '@/lib/hive';

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

  // ─── Data ──────────────────────────────────────────────────────────
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
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

            <PhotoMosaic posts={posts} familyId={profile?.familyId} />

            {!isHelper && (
              <ActivityFeed
                items={activity}
                kids={children}
                ownChildId={profile?.childId}
                role={role}
              />
            )}

            {isHelper && <HelperTasks />}

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
      href: '/pantry',
    });
    reminders.push({
      tone: 'ok',
      label: '$ Paid',
      title: 'Salary received',
      sub: 'Last cycle was on time',
      href: '/settings',
    });
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

function PhotoMosaic({ posts, familyId }: { posts: Post[]; familyId?: string }) {
  // 5-cell grid: 1 big + 4 small. Renders gradient placeholders for
  // empty cells when there aren't enough posts to fill it.
  const gradients = [
    'from-[#F5C465] to-[#D4A017]',
    'from-[#7B9DB7] to-[#2C5C7E]',
    'from-[#C9E5D7] to-[#5BA88C]',
    'from-[#9B8EC4] to-[#5A4A8E]',
    'from-[#F39C2F] to-[#C25A1F]',
  ];
  const cells = Array.from({ length: 5 }, (_, i) => posts[i]);

  return (
    <div>
      <div className="flex items-end justify-between mb-2 px-0.5">
        <h2 className="font-display font-black text-[14px] flex items-center gap-1.5">
          📸 Recent Moments
        </h2>
        <Link href="/moments" className="font-display font-extrabold text-[10.5px] text-kaya-gold-dark uppercase tracking-wider">
          Open →
        </Link>
      </div>
      <div
        className="grid gap-1.5 rounded-kaya overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(2, 80px)',
        }}
      >
        {cells.map((post, i) => {
          const isBig = i === 0;
          const gradient = gradients[i % gradients.length];
          const photoUrl = post?.photos?.[0]?.thumbUrl || post?.photos?.[0]?.feedUrl;
          return (
            <Link
              key={post?.id || `ph-${i}`}
              href={post ? `/moments/${post.id}` : '/moments'}
              className={`relative overflow-hidden rounded-md group ${
                isBig ? 'row-span-2 col-span-2' : ''
              } ${!photoUrl ? `bg-gradient-to-br ${gradient}` : ''}`}
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl}
                  alt={post?.caption || 'Moment'}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : null}
              {post && (
                <>
                  {post.eventTag && (
                    <span className="absolute top-1.5 right-1.5 bg-black/40 text-white font-display font-extrabold text-[8.5px] px-1.5 py-0.5 rounded backdrop-blur-sm">
                      {post.eventTag.emoji} {post.eventTag.label}
                    </span>
                  )}
                  {isBig && post.caption && (
                    <span className="absolute left-2 right-2 bottom-2 text-white font-display font-black text-[11px] leading-tight drop-shadow-md line-clamp-2">
                      {post.caption}
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>
    </div>
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

function HelperTasks() {
  // Placeholder until a real helper-task model lands. Shows the shape
  // the design promises so helpers see a non-empty page on day one.
  const tasks = [
    { title: 'Living room', desc: 'Mop & dust', due: 'Now', done: false },
    { title: 'Laundry', desc: 'Sort & wash whites', due: 'By 11am', done: false },
    { title: 'Dinner prep', desc: 'Pasta + salad', due: 'By 5pm', done: false },
  ];
  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5">
        <h2 className="font-display font-black text-[13px]">Today's chores</h2>
        <span className="font-display font-extrabold text-[10px] text-kaya-sand uppercase tracking-wider">0 of {tasks.length}</span>
      </div>
      {tasks.map((t, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-2 border-t border-kaya-warm-dark">
          <div className="w-7 h-7 rounded-full bg-kaya-warm-dark/60 text-kaya-sand flex items-center justify-center text-[12px] shrink-0">○</div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-black text-[12px] truncate">{t.title} · <span className="font-bold text-kaya-sand">{t.desc}</span></div>
            <div className="text-[9.5px] text-kaya-sand font-display font-bold uppercase tracking-wider mt-0.5">{t.due}</div>
          </div>
          <div className="font-display font-extrabold text-[10px] text-kaya-gold-dark bg-kaya-gold-light px-2 py-1 rounded-full">{t.due === 'Now' ? 'Now' : 'Later'}</div>
        </div>
      ))}
    </div>
  );
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
