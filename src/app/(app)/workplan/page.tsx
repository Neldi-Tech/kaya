'use client';

// /workplan — role-branched, mirroring how /pantry/workplan branches
// parent vs helper:
//   • Kid    → their playful "My Workplan" timeline (tap-to-tick, points).
//   • Parent → child picker + KidWorkplanEditor (assign repeatable tasks
//     with real times, categories incl. Play, optional points).
//   • Helper → bounced to their own Workplan (/pantry/workplan).
//
// Part of the "My Day + Kids' Workplan" build (Phase 2). The Kids'
// Workplan engine here also feeds the kid "My Day" aggregator (Phase 3).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import KidWorkplanToday from '@/components/workplan/KidWorkplanToday';
import KidWorkplanEditor from '@/components/workplan/KidWorkplanEditor';

export default function WorkplanPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const role = profile?.role;

  // Helpers have their own Workplan surface — send them there.
  useEffect(() => {
    if (role === 'helper') router.replace('/pantry/workplan');
  }, [role, router]);

  if (!family || !profile) return null;
  if (role === 'helper') return null;

  // ── Kid view ──────────────────────────────────
  if (role === 'kid') {
    const me = children.find((c) => c.id === profile.childId);
    const name = me?.name ?? profile.displayName ?? 'friend';
    if (!profile.childId) return null;
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-32" style={{ background: 'transparent' }}>
        <div className="lg:hidden"><BackButton /></div>
        <p className="text-[11px] font-black uppercase tracking-[3px] mb-2" style={{ color: '#9B5DE5' }}>My Workplan</p>
        <KidWorkplanToday familyId={family.id} childId={profile.childId} childName={name} />
      </div>
    );
  }

  // ── Parent view ───────────────────────────────
  return <ParentWorkplan familyId={family.id} parentUid={profile.uid} />;
}

function ParentWorkplan({ familyId, parentUid }: { familyId: string; parentUid: string }) {
  const { children } = useFamily();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && children.length > 0) setSelectedId(children[0].id);
  }, [children, selectedId]);

  const selected = children.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mb-1">Kids · Workplan</p>
      <h1 className="font-display text-2xl lg:text-[32px] font-black tracking-tight">Kids&apos; Workplan</h1>
      <p className="text-[12px] text-hive-muted mt-1 mb-4">
        Build a repeatable weekly plan for each child — with real times (school schedule), play, chores &amp; homework. Kids tick tasks off in their own playful view and earn any points you set.
      </p>

      {children.length === 0 ? (
        <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-8 text-center">
          <div className="text-4xl mb-2">👧</div>
          <p className="font-nunito font-extrabold text-[14px]">No kids yet</p>
          <p className="text-[12px] text-hive-muted mt-1">Add a child first, then build their workplan here.</p>
        </div>
      ) : (
        <>
          {/* Child picker */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
            {children.map((c) => {
              const on = c.id === selectedId;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`flex items-center gap-2 flex-shrink-0 rounded-hive-pill border-2 pl-1.5 pr-3 py-1.5 ${on ? 'border-hive-navy bg-hive-navy/5' : 'border-hive-line bg-hive-paper'}`}>
                  <KidAvatar child={c} size="sm" shape="circle" bgOpacity="20" />
                  <span className="font-nunito font-extrabold text-[13px]">{c.name}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <KidWorkplanEditor
              key={selected.id}
              familyId={familyId}
              childId={selected.id}
              childName={selected.name}
              parentUid={parentUid}
            />
          )}
        </>
      )}
    </div>
  );
}
