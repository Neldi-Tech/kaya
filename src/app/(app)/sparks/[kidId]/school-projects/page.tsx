'use client';

// Kaya Sparks · School Projects (/sparks/[kidId]/school-projects).
// Mockup-quality detail screen styled per `head-coral`. 2-col gallery
// of tiles with photo thumbs (or coloured gradient fallbacks for
// photo-less items) + date pill in the corner.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  subscribeToAreaItems, subscribeToSparksProfile,
} from '@/lib/sparks/firestore';
import type { SparksItem, SparksProfile } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import CaptureSheet from '@/components/sparks/CaptureSheet';

// Gradient backdrops for photo-less tiles — rotates so the gallery
// reads as bright + varied even before photos land. Pulled from the
// mockup (Step 4 · Sample Screens → "School Projects").
const TILE_GRADIENTS = [
  'linear-gradient(135deg,#FFE7E0,#FFD93D)',
  'linear-gradient(135deg,#DDF5DF,#6BCB77)',
  'linear-gradient(135deg,#E5D6FF,#A66CFF)',
  'linear-gradient(135deg,#C9F0EC,#4ECDC4)',
];

export default function SchoolProjectsPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [items, setItems] = useState<SparksItem[]>([]);
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [openCapture, setOpenCapture] = useState(false);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAreaItems(familyId, kidId, 'school_project', setItems);
  }, [familyId, kidId]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToSparksProfile(familyId, kidId, setProfile);
  }, [familyId, kidId]);

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  const subtitle = items.length === 0
    ? 'Nothing captured yet'
    : `${items.length} captured`;

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="school_project"
        subtitle={subtitle}
        action={
          <AddItemButton onClick={() => setOpenCapture(true)} label="+ New" />
        }
      >
        {items.length === 0 ? (
          <AreaEmptyState
            emoji="🎨"
            title="Capture the first project"
            body={`Photo a model, snap a worksheet, add a description. ${kid.name}'s gallery starts here.`}
            action={
              <button
                type="button"
                onClick={() => setOpenCapture(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#E85C5C', color: '#fff' }}
              >
                + Add a project
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((it, idx) => {
              const photo = it.photo_urls?.[0];
              return (
                <div
                  key={it.id}
                  className="bg-[#FBF7EE] rounded-[14px] p-2 flex flex-col gap-2"
                >
                  <div
                    className="aspect-square rounded-[10px] overflow-hidden grid place-items-center relative"
                    style={photo ? undefined : { background: TILE_GRADIENTS[idx % TILE_GRADIENTS.length] }}
                  >
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={it.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl" aria-hidden>🎨</span>
                    )}
                    <span className="absolute top-1.5 right-1.5 bg-[rgba(15,31,68,0.85)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                      {toDisplayDate(it.date)}
                    </span>
                  </div>
                  <div className="text-[12px] font-extrabold text-[#0F1F44] truncate" title={it.title}>
                    {it.title}
                  </div>
                  {it.subject && (
                    <div className="text-[10.5px] text-[#5A6488] -mt-1.5 truncate">
                      {it.subject}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AreaScreen>

      <CaptureSheet
        open={openCapture}
        onClose={() => setOpenCapture(false)}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        area="school_project"
        profile={profile}
        uid={authProfile.uid}
      />
    </>
  );
}
