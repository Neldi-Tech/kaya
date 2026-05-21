'use client';

// Kaya Business · Kids Projects — the maker space. A kid's projects (owned +
// collaborated), with a photo, status, and AI help inside each. Parents view
// any kid via the shared KidSwitcher.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { Project, PROJECT_STATUS_META, subscribeToKidProjects } from '@/lib/projects';
import KidSwitcher from '@/components/hive/KidSwitcher';

export default function ProjectsPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const { activeKidId } = useHive();
  const familyId = profile?.familyId;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId || !activeKidId) { setProjects([]); setLoading(false); return; }
    setLoading(true);
    return subscribeToKidProjects(familyId, activeKidId, (p) => { setProjects(p); setLoading(false); });
  }, [familyId, activeKidId]);

  const activeKid = children.find((c) => c.id === activeKidId);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Kids Projects</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
            {activeKid ? `${activeKid.name}'s projects` : 'Projects'}
          </h1>
        </div>
        <Link href="/business" className="shrink-0 text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline mt-1">Business →</Link>
      </div>

      <KidSwitcher />

      <div className="bg-[#F4ECD8] border border-hive-honey/60 rounded-hive p-4 mb-3">
        <p className="text-[13px] leading-relaxed text-hive-navy">
          🎨 <b>A place to make things.</b> Design + build a craft, a gadget, art, a recipe — get AI help,
          snap photos as you go, and share the best ones to Moments so the memory lasts.
        </p>
      </div>

      {loading ? (
        <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center mb-4">
          <div className="text-5xl mb-3">🛠️</div>
          <p className="font-nunito font-extrabold text-[16px]">No projects yet</p>
          <p className="text-hive-muted text-sm mt-1 mb-4">Start one — a birdhouse, a comic, slime, a paper circuit… anything you want to make.</p>
        </div>
      ) : (
        <div className="space-y-2.5 mb-4">
          {projects.map((p) => {
            const st = PROJECT_STATUS_META[p.status];
            const cover = p.photoUrls?.[0];
            return (
              <Link key={p.id} href={`/business/projects/${p.id}`}
                className="flex items-center gap-3 bg-hive-paper border border-hive-line rounded-hive p-3 no-underline text-hive-navy hover:border-hive-honey transition">
                <div className="w-14 h-14 rounded-hive bg-hive-cream overflow-hidden shrink-0 flex items-center justify-center text-2xl">
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" className="w-full h-full object-cover" />
                    : (st.emoji)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-extrabold text-[14px] truncate">{p.title}</div>
                  <div className="text-[11px] text-hive-muted truncate">{p.category || 'Project'}{p.photoUrls?.length ? ` · ${p.photoUrls.length} 📷` : ''}</div>
                </div>
                <span className={`text-[10px] font-nunito font-black px-2 py-0.5 rounded-hive-pill shrink-0 ${st.pill}`}>{st.emoji} {st.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {activeKid && (
        <Link href="/business/projects/new"
          className="w-full flex items-center justify-center gap-2 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] hover:brightness-110 active:scale-[0.99] transition no-underline">
          ＋ Start a project
        </Link>
      )}
    </div>
  );
}
