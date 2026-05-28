'use client';

// Kaya Sparks · Achievements (/sparks/[kidId]/achievements). The
// "achievement wall" from the mockup (head-green). Each row =
// coloured medal + title + subtitle. Captures use the same
// CaptureSheet (kid uploads a photo of the certificate / medal +
// titles it; OCR auto-extract lands with Slice 4).

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

// Medal palette — rotates across the wall so it reads as a mix of
// gold / coral / mint / purple medals from the mockup. The kid's
// real photo (when uploaded) goes in the medal circle.
const MEDAL_BG = ['#FFD93D', '#FFE7E0', '#DDF5DF', '#E5D6FF', '#C9F0EC'];
const MEDAL_ICON = ['🏆', '🥇', '🌟', '🎖️', '🏅'];

export default function AchievementsPage() {
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
    return subscribeToAreaItems(familyId, kidId, 'achievement', setItems);
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

  return (
    <>
      <AreaScreen
        kidId={kidId}
        kidName={kid.name}
        area="achievement"
        subtitle={items.length === 0 ? 'No certificates yet' : `${items.length} captured`}
        action={
          <AddItemButton onClick={() => setOpenCapture(true)} label="+ Add" />
        }
      >
        {items.length === 0 ? (
          <AreaEmptyState
            emoji="🏆"
            title={`Every certificate, every medal — saved`}
            body={`Snap a photo of the certificate, the medal, or the prize. AI OCR for issuer + date arrives in Slice 4.`}
            action={
              <button
                type="button"
                onClick={() => setOpenCapture(true)}
                className="inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
                style={{ background: '#2E7D34', color: '#fff' }}
              >
                + Add an achievement
              </button>
            }
          />
        ) : (
          <>
            <HighlightsRail
              items={highlights}
              fallbackTileGradient="linear-gradient(135deg,#FFD93D,#FFB627)"
              showEmptyState={canEdit}
              onOpenItem={(it) => setLightbox({
                photos: it.photo_urls ?? [],
                index: 0,
                caption: it.title,
                sub: it.description ? `${it.description} · ${toDisplayDate(it.date)}` : toDisplayDate(it.date),
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
                <ul className="m-0 p-0 list-none lg:grid lg:grid-cols-2 lg:gap-x-6">
                  {group.items.map((it, idx) => {
                    const photo = it.photo_urls?.[0];
                    return (
                      <li
                        key={it.id}
                        className="flex items-center gap-3 py-3 border-b border-[#ECE4D3] last:border-b-0"
                      >
                        {photo ? (
                          <button
                            type="button"
                            onClick={() => setLightbox({
                              photos: it.photo_urls ?? [],
                              index: 0,
                              caption: it.title,
                              sub: it.description ? `${it.description} · ${toDisplayDate(it.date)}` : toDisplayDate(it.date),
                            })}
                            className="w-10 h-10 rounded-full overflow-hidden shrink-0 border-0 p-0 cursor-zoom-in"
                            aria-label={`Open ${it.title} full screen`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo} alt={it.title} className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full grid place-items-center shrink-0 overflow-hidden"
                            style={{ background: MEDAL_BG[idx % MEDAL_BG.length] }}
                          >
                            <span className="text-lg" aria-hidden>{MEDAL_ICON[idx % MEDAL_ICON.length]}</span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <div className="text-[13px] font-extrabold text-[#0F1F44] leading-tight flex-1 truncate">
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
                          <div className="text-[11px] text-[#5A6488] mt-0.5">
                            {it.description ? `${it.description} · ` : ''}{toDisplayDate(it.date)}
                          </div>
                        </div>
                        {(() => {
                          const latest = ratingsMap.get(it.id)?.[0] ?? null;
                          if (latest) return <RatingDisplay rating={latest} onTap={() => isParent && setRateItem(it)} variant="wide" />;
                          if (isParent) return <RatingDisplay rating={null} onTap={() => setRateItem(it)} variant="wide" />;
                          return null;
                        })()}
                      </li>
                    );
                  })}
                </ul>
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
        area="achievement"
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
