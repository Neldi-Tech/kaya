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
import MonthGroup from '@/components/sparks/MonthGroup';
import HighlightsRail from '@/components/sparks/HighlightsRail';
import HighlightStar from '@/components/sparks/HighlightStar';
import { defaultOpenMonths, groupByMonth } from '@/lib/sparks/grouping';

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
  const [ratings, setRatings] = useState<SparksRating[]>([]);
  const [rateItem, setRateItem] = useState<SparksItem | null>(null);
  const [editItem, setEditItem] = useState<SparksItem | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number; caption: string; sub: string } | null>(null);
  const isParent = authProfile?.role === 'parent';
  const canEdit = isParent || (authProfile?.role === 'kid' && authProfile?.childId === kidId);

  useEffect(() => {
    if (!familyId || !kidId) return;
    return subscribeToAreaItems(familyId, kidId, 'school_project', setItems);
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
  const groups = useMemo(() => groupByMonth(items), [items]);
  const highlights = useMemo(() => items.filter((it) => it.is_highlight), [items]);
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());
  const groupKeys = groups.map((g) => g.key).join('|');
  useEffect(() => {
    setOpenMonths(defaultOpenMonths(groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKeys]);
  const toggleMonth = (key: string) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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
          <>
            <HighlightsRail
              items={highlights}
              fallbackTileGradient={TILE_GRADIENTS[0]}
              showEmptyState={canEdit}
              onOpenItem={(it) => setLightbox({
                photos: it.photo_urls ?? [],
                index: 0,
                caption: it.title,
                sub: toDisplayDate(it.date),
              })}
            />

            {groups.map((group, groupIdx) => (
              <MonthGroup
                key={group.key}
                label={group.label}
                count={group.items.length}
                open={openMonths.has(group.key)}
                onToggle={() => toggleMonth(group.key)}
                first={groupIdx === 0}
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 lg:gap-3">
                  {group.items.map((it, idx) => {
                    const photo = it.photo_urls?.[0];
                    return (
                      <div
                        key={it.id}
                        className="bg-[#FBF7EE] rounded-[14px] p-2 flex flex-col gap-2"
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
                            <span className="text-4xl" aria-hidden>🎨</span>
                            <span className="absolute top-1.5 right-1.5 bg-[rgba(15,31,68,0.85)] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                              {toDisplayDate(it.date)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <div className="text-[12px] font-extrabold text-[#0F1F44] truncate flex-1" title={it.title}>
                            {it.title}
                          </div>
                          <HighlightStar
                            item={it}
                            familyId={familyId}
                            areaItems={items}
                            canEdit={canEdit}
                          />
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
                        {it.subject && (
                          <div className="text-[10.5px] text-[#5A6488] -mt-1.5 truncate">
                            {it.subject}
                          </div>
                        )}
                        {/* Rating — optional on school projects. Most parents
                            just capture for the gallery; the ones who want to
                            mark a stand-out can tap. */}
                        {(() => {
                          const latest = ratingsMap.get(it.id)?.[0] ?? null;
                          if (latest) return <RatingDisplay rating={latest} onTap={() => isParent && setRateItem(it)} />;
                          if (isParent) return <RatingDisplay rating={null} onTap={() => setRateItem(it)} />;
                          return null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              </MonthGroup>
            ))}
          </>
        )}
      </AreaScreen>

      <CaptureSheet
        open={openCapture || !!editItem}
        onClose={() => { setOpenCapture(false); setEditItem(null); }}
        familyId={familyId}
        kidId={kidId}
        kidName={kid.name}
        area="school_project"
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
          mode="stars"
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
