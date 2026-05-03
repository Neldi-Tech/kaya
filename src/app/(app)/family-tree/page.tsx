'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import { formatFamilyHandle, formatPersonHandle } from '@/lib/handles';
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

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-6 lg:mb-8">
        <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Family tree</h1>
        <p className="text-sm text-kaya-sand mt-0.5 lg:mt-1">
          Everyone in {family?.name || 'your family'}{family?.handle ? ` · ${formatFamilyHandle(family.handle)}` : ''}.
        </p>
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
                  <PersonCard key={p.uid} person={p} role="Parent" />
                ))}
              </Grid>
            )}
          </Section>

          {/* Helpers */}
          {helpers.length > 0 && (
            <Section title="Helpers" emoji="🤝" count={helpers.length}>
              <Grid>
                {helpers.map((h) => (
                  <PersonCard key={h.uid} person={h} role="Helper" />
                ))}
              </Grid>
            </Section>
          )}

          {/* Kids */}
          <Section title="Kids" emoji="👧" count={children.length}>
            {children.length === 0 ? (
              <Empty text="No kids added yet — start in Settings → Children." />
            ) : (
              <Grid>
                {children.map((c) => {
                  const linkedUser = kidUsers.find((u) => u.childId === c.id);
                  return (
                    <div key={c.id} className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 flex items-center gap-3">
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
                    </div>
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

function PersonCard({ person, role }: { person: UserProfile; role: string }) {
  const initial = person.displayName?.[0]?.toUpperCase() || 'U';
  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 flex items-center gap-3">
      {person.photoURL ? (
        <img src={person.photoURL} alt={person.displayName} className="w-12 h-12 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-white font-display font-black shrink-0">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display font-bold text-base truncate">{person.displayName || 'Member'}</p>
        <p className="text-[11px] text-kaya-sand truncate">{role}</p>
        {(person as any).handle && (
          <p className="text-[10px] font-semibold text-kaya-gold truncate">{formatPersonHandle((person as any).handle)}</p>
        )}
      </div>
    </div>
  );
}
