'use client';

// Kaya Sparks · Home Projects (/sparks/[kidId]/home-projects).
// Mockup detail screen styled per `head-yellow`. Tile grid faithful to
// the rated cards in the mockup (Step 4) — Slice 2 shipped capture +
// display; Slice 3 (2026-05-27) wires ⭐ + % rating via the shared
// RatingSheet + RatingDisplay primitives. Workplan wiring lands in
// Slice 3b.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  ratingsByItemId, subscribeToAreaItems, subscribeToKidRatings,
  subscribeToSparksProfile,
} from '@/lib/sparks/firestore';
import type {
  SparksItem, SparksProfile, SparksRating,
} from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';
import AreaScreen, { AddItemButton, AreaEmptyState } from '@/components/sparks/AreaScreen';
import CaptureSheet from '@/components/sparks/CaptureSheet';
import RatingSheet from '@/components/sparks/RatingSheet';
import RatingDisplay from '@/components/sparks/RatingDisplay';
import PhotoLightbox from '@/components/sparks/PhotoLightbox';

const TILE_GRADIENTS = [
  'linear-gradient(135deg,#FFE7E0,#FFD93D)',
  'linear-gradient(135deg,#C9F0EC,#4ECDC4)',
  'linear-gradient(135deg,#E5D6FF,#A66CFF)',
  'linear-gradient(135deg,#DDF5DF,#6BCB77)',
];

const FALLBACK_EMOJIS = ['🛠', '✈️', '🏰', '🎨'];

export default function HomeProjectsPage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId ?? '';
  const { profile: authProfile } = useAuth();
  const { children } = useFamily();
  const familyId = authProfile?.familyId;
  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  const [items, setItems] = useState<SparksItem[]>([]);
  const [profile, setProfile] = useState<SparksProfile | null>(null);
  const [openCapture, setOpenCapture] = useState(false);
  const [ratings, setRatings] = useState<SparksRating[]>([]);
  const [rateItem, setRateItem] = useState<SparksItem | null>(null);
  const [editItem, setEditItem] = useState<SparksItem | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number; caption: string; sub: string } | null>(null);
  const isParent = authProfile?.role === 'parent';
  const canEdit = isParent || (authProfile?.role === 'kid' && authProfile?.childId === kidId);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAreaItems(familyId, kidId, 'home_project', setItems);
  }, [familyId, kidId]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToSparksProfile(familyId, kidId, setProfile);
  }, [familyId, kidId]);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToKidRatings(familyId, kidId, setRatings);
  }, [familyId, kidId]);

  const ratingsMap = useMemo(() => ratingsByItemId(ratings), [ratings]);

  if (!familyId || !kid) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#5A6488] text-sm">Loading…</div>;
  }

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="home_project"
        subtitle={items.length === 0 ? 'Nothing here yet' : `${items.length} captured · ratings land in Slice 3`}
        action={
          <AddItemButton
            onClick={() => setOpenCapture(true)}
            label="+ New"
            fg="#0F1F44"
            bg="rgba(15,31,68,0.10)"
          />
        }
      >
        {items.length === 0 ? (
          <AreaEmptyState
            emoji="🛠"
            title="What's been made at home?"
            body={`Paper planes, drawings, builds — capture ${kid.name}'s creativity as it happens.`}
            action={
              <button
                type="button"
                onClick={() => setOpenCapture(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#FFD93D', color: '#664D00' }}
              >
                + Add a project
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map((it, idx) => {
              const photo = it.photo_urls?.[0];
              const latest = ratingsMap.get(it.id)?.[0] ?? null;
              return (
                <div
                  key={it.id}
                  className="bg-[#FBF7EE] rounded-[14px] p-3 flex flex-col gap-2"
                >
                  {photo ? (
                    <button
                      type="button"
                      onClick={() => setLightbox({
                        photos: it.photo_urls ?? [],
                        index: 0,
                        caption: it.title,
                        sub: toDisplayDate(it.date),
                      })}
                      className="aspect-square rounded-[10px] overflow-hidden relative block w-full p-0 border-0 cursor-zoom-in"
                      aria-label={`Open ${it.title} full screen`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo} alt={it.title} className="w-full h-full object-cover" />
                      <span className="absolute top-1.5 right-1.5 bg-[rgba(15,31,68,0.85)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                        {toDisplayDate(it.date)}
                      </span>
                      {(it.photo_urls?.length ?? 0) > 1 && (
                        <span className="absolute bottom-1.5 right-1.5 bg-[rgba(15,31,68,0.85)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                          +{it.photo_urls!.length - 1}
                        </span>
                      )}
                    </button>
                  ) : (
                    <div
                      className="aspect-square rounded-[10px] overflow-hidden grid place-items-center relative"
                      style={{ background: TILE_GRADIENTS[idx % TILE_GRADIENTS.length] }}
                    >
                      <span className="text-4xl" aria-hidden>{FALLBACK_EMOJIS[idx % FALLBACK_EMOJIS.length]}</span>
                      <span className="absolute top-1.5 right-1.5 bg-[rgba(15,31,68,0.85)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                        {toDisplayDate(it.date)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <div className="text-[12px] font-extrabold text-[#0F1F44] truncate flex-1" title={it.title}>
                      {it.title}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setEditItem(it)}
                        className="text-[12px] text-[#5A6488] hover:text-[#0F1F44] shrink-0"
                        aria-label={`Edit ${it.title}`}
                        title="Edit"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                  {/* Rating — Parents rate or re-open via RatingSheet; kids
                      see the read-only display (or muted "Unrated"). */}
                  {isParent ? (
                    <RatingDisplay rating={latest} onTap={() => setRateItem(it)} />
                  ) : latest ? (
                    <RatingDisplay rating={latest} onTap={() => {}} />
                  ) : (
                    <div className="flex items-center gap-1 -mt-0.5">
                      <span className="text-[10px] opacity-30">⭐⭐⭐⭐⭐</span>
                      <span className="text-[9.5px] font-bold text-[#5A6488] ml-auto">Unrated</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AreaScreen>

      <CaptureSheet
        open={openCapture || !!editItem}
        onClose={() => { setOpenCapture(false); setEditItem(null); }}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        area="home_project"
        profile={profile}
        uid={authProfile.uid}
        existing={editItem}
      />

      {rateItem && (
        <RatingSheet
          open={!!rateItem}
          onClose={() => setRateItem(null)}
          familyId={familyId}
          item={rateItem}
          parentUid={authProfile.uid}
          mode="both"
        />
      )}

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox({ ...lightbox, index: i })}
          onClose={() => setLightbox(null)}
          caption={lightbox.caption}
          subCaption={lightbox.sub}
        />
      )}
    </>
  );
}
