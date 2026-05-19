'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import { formatFamilyHandle, formatPersonHandle, handleToSlug } from '@/lib/handles';
import { toDisplayDate, dayOfWeek, daysToNextBirthday, ageNow, ageAtNextBirthday } from '@/lib/dates';
import { milestoneForYear, ordinal } from '@/lib/anniversaryMilestones';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

export default function FamilyTreePage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.familyId) return;
    getFamilyMembers(profile.familyId).then((m) => {
      setMembers(m);
      setLoading(false);
    });
  }, [profile?.familyId]);

  const parents = members.filter((m) => m.role === 'parent');
  const helpers = members.filter((m) => m.role === 'helper');
  const kidUsers = members.filter((m) => m.role === 'kid');
  const guests  = members.filter((m) => m.role === 'guest');
  const isParent = profile?.role === 'parent';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-6 lg:mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Family tree</h1>
          <p className="text-sm text-kaya-sand mt-0.5 lg:mt-1">
            Everyone in {family?.name || 'your family'}{family?.handle ? ` · ${formatFamilyHandle(family.handle)}` : ''}.
          </p>
        </div>
        {/* Quick jump to the new Family members card in Settings —
            that's where parents add/remove people. The tree view
            here is read-only by design (visual overview). */}
        {isParent && (
          <Link
            href="/settings"
            className="shrink-0 h-9 px-3 rounded-kaya-sm text-xs font-bold bg-kaya-warm hover:bg-kaya-warm-dark/40 text-kaya-sand transition-colors no-underline"
          >
            Manage →
          </Link>
        )}
      </div>

      {/* Family root */}
      {family && (
        <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-white rounded-kaya-lg p-5 lg:p-6 mb-6 flex items-center gap-4 lg:gap-5 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
          <div className="relative shrink-0">
            {family.photoUrl ? (
              <img src={family.photoUrl} alt={family.name} className="w-16 h-16 lg:w-20 lg:h-20 rounded-[18px] object-cover border-2 border-white/20" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-[18px] bg-kaya-gold-light text-kaya-chocolate flex items-center justify-center font-display font-black text-2xl lg:text-3xl">
                {(family.name || 'K').replace(/^the\s+/i, '').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="relative flex-1 min-w-0">
            <p className="text-kaya-gold text-[10px] font-bold uppercase tracking-[0.14em]">Root</p>
            <p className="font-display font-bold text-lg lg:text-2xl truncate">{family.name}</p>
            {family.handle && <p className="text-[12px] text-kaya-sand-light">{formatFamilyHandle(family.handle)}</p>}
          </div>
          <div className="relative text-right shrink-0">
            <p className="font-display font-black text-2xl lg:text-3xl">{members.length + children.length}</p>
            <p className="text-[10px] text-kaya-sand-light uppercase tracking-wider">Members</p>
          </div>
        </div>
      )}

      {/* Anniversary card — parents only as of 2026-05-19 (Elia helper-
          cleanup pass). Helpers don't need to see the family's wedding
          anniversary on their family-tree view — it's a personal-family
          milestone, not a workplace metric. Parents still see the
          card (and the "+ Add anniversary" prompt when unset). If
          finer-grained per-helper visibility is needed later, gate
          here on a family setting. */}
      {family && isParent && (() => {
        const anniversary = family.anniversary;
        const familyShortName = (family.name || '').replace(/^the\s+/i, '').replace(/\s+family$/i, '').trim() || family.name || '';
        if (!anniversary) {
          return isParent ? (
            <Link
              href="/settings#family"
              className="mb-6 rounded-kaya-lg p-4 lg:p-5 flex items-center gap-4 bg-white border border-dashed border-kaya-warm-dark hover:border-kaya-chocolate transition-colors no-underline text-inherit"
            >
              <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-[14px] flex items-center justify-center text-2xl lg:text-3xl shrink-0 bg-kaya-warm/60">💍</div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Anniversary</p>
                <p className="font-display font-bold text-base lg:text-lg">+ Add anniversary</p>
                <p className="text-[12px] text-kaya-sand">Both parents will see the countdown.</p>
              </div>
              <span className="text-[12px] text-kaya-gold font-bold shrink-0">Add →</span>
            </Link>
          ) : null;
        }
        const days = daysToNextBirthday(anniversary);
        const yearsTogether = ageNow(anniversary);
        // Years they will have completed *on* the next anniversary — drives
        // the milestone callout (e.g. 9 years today → "celebrating Tin (10th)
        // Anniversary in X days").
        const upcomingYear = ageAtNextBirthday(anniversary);
        const dow = dayOfWeek(anniversary);
        const isToday = days === 0;
        const title = family.anniversaryName?.trim() || 'Anniversary';
        // Heartfelt tagline that uses the family's short name when known,
        // falls back to a generic phrasing otherwise.
        const tagline = yearsTogether !== null
          ? (familyShortName
              ? `${yearsTogether} year${yearsTogether === 1 ? '' : 's'} of building the ${familyShortName} family with love together 💛`
              : `${yearsTogether} year${yearsTogether === 1 ? '' : 's'} of building this family with love together 💛`)
          : null;
        // Milestone for the upcoming celebration. When today IS the
        // anniversary, show the milestone for the year they JUST completed.
        const milestoneYear = isToday ? yearsTogether : upcomingYear;
        const milestone = milestoneYear !== null ? milestoneForYear(milestoneYear) : null;
        return (
          <div className={`mb-6 rounded-kaya-lg p-4 lg:p-5 flex items-start gap-4 ${
            isToday
              ? 'bg-gradient-to-br from-kaya-gold to-kaya-gold-dark text-white shadow-md'
              : 'bg-white border border-kaya-warm-dark'
          }`}>
            <div className={`w-12 h-12 lg:w-14 lg:h-14 rounded-[14px] flex items-center justify-center text-2xl lg:text-3xl shrink-0 ${
              isToday ? 'bg-white/20' : 'bg-kaya-gold-light'
            }`}>💍</div>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${isToday ? 'text-white/80' : 'text-kaya-sand'}`}>
                {title}
              </p>
              <p className="font-display font-bold text-base lg:text-lg truncate">
                {toDisplayDate(anniversary)}{dow && <span className={`font-normal ml-2 ${isToday ? 'text-white/80' : 'text-kaya-sand'}`}>· {dow}</span>}
              </p>
              <p className={`text-[12px] ${isToday ? 'text-white/90 font-bold' : 'text-kaya-gold font-semibold'}`}>
                {isToday
                  ? (milestone
                      ? `🎉 Today — celebrating ${milestone.emoji} ${milestone.name} (${ordinal(milestone.year)} year)`
                      : `🎉 Today — ${yearsTogether} year${yearsTogether === 1 ? '' : 's'} together`)
                  : (milestone && upcomingYear !== null
                      ? `${days} day${days === 1 ? '' : 's'} to celebrating ${milestone.emoji} ${milestone.name} (${ordinal(milestone.year)} year) Anniversary`
                      : `${days} day${days === 1 ? '' : 's'} to your ${upcomingYear !== null ? ordinal(upcomingYear) + ' ' : ''}anniversary${yearsTogether !== null ? ` · ${yearsTogether} year${yearsTogether === 1 ? '' : 's'} so far` : ''}`)}
              </p>
              {tagline && (
                <p className={`text-[12px] leading-snug mt-1.5 italic ${isToday ? 'text-white/85' : 'text-kaya-chocolate'}`}>
                  {tagline}
                </p>
              )}
            </div>
            {isParent && (
              <Link
                href="/settings#family"
                className="text-[11px] font-bold shrink-0 hover:underline self-center"
                style={{ color: isToday ? '#fff' : '#D4A017' }}
              >
                Edit
              </Link>
            )}
          </div>
        );
      })()}

      {loading ? (
        <p className="text-kaya-sand text-sm text-center py-8">Loading members…</p>
      ) : (
        <div className="space-y-6 lg:space-y-8">
          {/* Parents */}
          <Section title="Parents" emoji="👨‍👩" count={parents.length}>
            {parents.length === 0 ? (
              <Empty text="No parents yet." />
            ) : (
              <Grid>
                {parents.map((p) => (
                  <PersonCard key={p.uid} person={p} role="Parent" isMe={p.uid === profile?.uid} />
                ))}
              </Grid>
            )}
          </Section>

          {/* Helpers */}
          {helpers.length > 0 && (
            <Section title="Helpers" emoji="🤝" count={helpers.length}>
              <Grid>
                {helpers.map((h) => (
                  <PersonCard key={h.uid} person={h} role="Helper" isMe={h.uid === profile?.uid} />
                ))}
              </Grid>
            </Section>
          )}

          {/* Guests — view-only role added with the per-role invite
              codes feature. Only renders the section when at least one
              guest has joined, to keep the tree tidy. */}
          {guests.length > 0 && (
            <Section title="Guests" emoji="👀" count={guests.length}>
              <Grid>
                {guests.map((g) => (
                  <PersonCard key={g.uid} person={g} role="Guest" isMe={g.uid === profile?.uid} />
                ))}
              </Grid>
            </Section>
          )}

          {/* Kids — clickable: parents/helpers tap into the kid profile editor;
              kid users (signed in as themselves) get a non-clickable card. */}
          <Section title="Kids" emoji="👧" count={children.length}>
            {children.length === 0 ? (
              <Empty text="No kids added yet — start in Settings → Children." />
            ) : (
              <Grid>
                {children.map((c) => {
                  const linkedUser = kidUsers.find((u) => u.childId === c.id);
                  const inner = (
                    <>
                      <KidAvatar child={c} size="lg" shape="circle" bgOpacity="20" />
                      <div className="min-w-0 flex-1">
                        <p className="font-display font-bold text-base truncate">{c.name}</p>
                        <p className="text-[11px] text-kaya-sand truncate">{c.houseName} House</p>
                        {linkedUser ? (
                          <p className="text-[10px] font-semibold text-kaya-gold">Has login · {linkedUser.email}</p>
                        ) : c.email ? (
                          <p className="text-[10px] text-kaya-sand">{c.email}</p>
                        ) : null}
                      </div>
                      {isParent && (
                        <span className="text-[11px] text-kaya-gold font-semibold shrink-0">Edit →</span>
                      )}
                    </>
                  );
                  const cls = `bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 flex items-center gap-3 ${
                    isParent ? 'hover:border-kaya-chocolate transition-colors no-underline text-inherit' : ''
                  }`;
                  return isParent ? (
                    // ?edit=identity auto-opens the identity editor on arrival
                    // so a parent can complete the edit without an extra tap.
                    <Link key={c.id} href={`/profiles?child=${c.id}&edit=identity`} className={cls}>{inner}</Link>
                  ) : (
                    <div key={c.id} className={cls}>{inner}</div>
                  );
                })}
              </Grid>
            )}
          </Section>
        </div>
      )}

      <div className="mt-10 bg-kaya-warm/40 border border-kaya-warm-dark rounded-kaya p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-[10px] bg-kaya-gold-light flex items-center justify-center text-sm shrink-0">🌳</div>
        <div className="text-[12px] text-kaya-chocolate leading-relaxed">
          <p className="font-bold mb-0.5">Coming next</p>
          <p className="text-kaya-sand">
            Add immediate relatives (grandparents, aunts &amp; uncles, cousins) so the tree extends beyond the household. We&apos;ll never lose track of who&apos;s who.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, emoji, count, children }: { title: string; emoji: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display font-bold text-base lg:text-lg flex items-center gap-2">
          <span>{emoji}</span>{title}
        </h2>
        <span className="text-[11px] text-kaya-sand font-semibold">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">{children}</div>;
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-white border border-kaya-warm-dark/60 rounded-kaya p-6 text-center text-xs text-kaya-sand">
      {text}
    </div>
  );
}

function PersonCard({ person, role, isMe }: { person: UserProfile; role: string; isMe?: boolean }) {
  const initial = person.displayName?.[0]?.toUpperCase() || 'U';
  // Prefer the user-uploaded avatar if present; fall back to Google photoURL.
  const photo = person.avatarPhoto || person.photoURL;
  const handle = (person as any).handle as string | undefined;

  // Self → /settings#profile (anchor scrolls straight to the profile card).
  // Others with a public handle → /u/<slug> (their public Kaya page).
  // Anyone else → non-interactive card.
  const href = isMe ? '/settings#profile' : (handle ? `/u/${handleToSlug(handle)}` : null);

  const cardClass = `bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 flex items-center gap-3 ${
    href ? 'hover:border-kaya-chocolate transition-colors no-underline text-inherit' : ''
  }`;

  const inner = (
    <>
      {photo ? (
        <img src={photo} alt={person.displayName} className="w-12 h-12 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-white font-display font-black shrink-0">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display font-bold text-base truncate">{person.displayName || 'Member'}</p>
        <p className="text-[11px] text-kaya-sand truncate">{role}{isMe && ' · You'}</p>
        {handle && (
          <p className="text-[10px] font-semibold text-kaya-gold truncate">{formatPersonHandle(handle)}</p>
        )}
      </div>
      {isMe && (
        <span className="text-[11px] text-kaya-gold font-semibold shrink-0">Edit →</span>
      )}
      {!isMe && href && (
        <span className="text-[11px] text-kaya-sand font-semibold shrink-0">View →</span>
      )}
    </>
  );

  return href ? (
    <Link href={href} className={cardClass}>{inner}</Link>
  ) : (
    <div className={cardClass}>{inner}</div>
  );
}
