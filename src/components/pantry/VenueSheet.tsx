'use client';

// VenueSheet — the "open a place" detail view for Dine Out venues.
//
// Opens when you tap a venue in "Places to go" (and, from PR3, in the
// Meal Planner's Places-to-Go panel). Shows the full historicals BEFORE
// you re-use a place: per-parent ratings, photo gallery (with lightbox),
// highlights, and the per-visit history (date · who · ★ · occasion ·
// what was eaten · spend). `onUse` (optional) surfaces the re-use button.

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toDisplayDate } from '@/lib/dates';
import { formatCents } from '@/components/pantry/format';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { uploadVenuePhoto, addVenuePhotos, type Venue, type VenueVisit } from '@/lib/dineOutVenues';
import { createPost, type PhotoRef } from '@/lib/moments';

const DINE = '#C2562E';

/** atMs → DD-Mmm-YYYY, computed in LOCAL time (Kaya helpers are worldwide). */
function visitDate(atMs: number): string {
  if (!atMs) return '';
  const d = new Date(atMs);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return toDisplayDate(iso);
}

function Stars({ n }: { n: number }) {
  if (!n) return null;
  return <span style={{ color: '#B8860B' }} className="font-bold">{'★'.repeat(n)}</span>;
}

export default function VenueSheet({
  venue, currency, onClose, onUse, familyId,
}: {
  venue: Venue;
  currency: string;
  onClose: () => void;
  onUse?: (v: Venue) => void;
  /** When provided (a parent context), enables "Add photos" on the sheet
   *  so pictures can be attached to this venue directly — including places
   *  logged before the gallery shipped. */
  familyId?: string;
}) {
  const { profile } = useAuth();
  const [lightbox, setLightbox] = useState<{ photos: PhotoRef[]; i: number } | null>(null);
  // Local photo list so adds appear instantly (the `venue` prop is the
  // snapshot taken when the sheet opened; the Firestore write persists).
  const [photos, setPhotos] = useState<PhotoRef[]>(venue.photos ?? []);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  useEffect(() => { setPhotos(venue.photos ?? []); setShared(false); }, [venue.id, venue.photos]);

  const onAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!familyId) return;
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (!files.length) return;
    setAddingPhotos(true);
    try {
      const refs: PhotoRef[] = [];
      for (const f of files) {
        try {
          refs.push(await uploadVenuePhoto(familyId, venue.id, await processPhotoForUpload(f)));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[venue-sheet] photo upload failed:', err);
        }
      }
      if (refs.length) {
        await addVenuePhotos(familyId, venue.id, refs);
        setPhotos((prev) => [...prev, ...refs]);
      }
    } finally {
      setAddingPhotos(false);
    }
  };

  // Push this venue's photos to the family Moments feed. Photos added via
  // "Add photos" only attach to the venue — this is the explicit share.
  const onShareToMoments = async () => {
    if (!familyId || !profile?.uid || photos.length === 0 || sharing) return;
    setSharing(true);
    try {
      const caption = `${venue.name} ${venue.emoji || '🍽️'}`
        + (venue.avgStars > 0 ? ` · ${'★'.repeat(Math.round(venue.avgStars))}` : '');
      await createPost(familyId, {
        authorUid: profile.uid,
        authorName: profile.displayName,
        ...(profile.avatarPhoto ? { authorAvatar: profile.avatarPhoto } : {}),
        caption,
        photos: photos.slice(0, 10), // Moments posts carry up to 10
        kidTags: [],
        eventTag: { id: 'dineout', emoji: '🍽️', label: 'Dine Out' },
        visibility: 'family',
      });
      setShared(true);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[venue-sheet] share to Moments failed:', err);
    } finally {
      setSharing(false);
    }
  };

  const ratingEntries = Object.values(venue.ratings ?? {}).filter((r) => r.stars > 0 || r.diamond);
  const visits: VenueVisit[] = [...(venue.visits ?? [])].reverse(); // newest first
  const avgSpend = venue.count > 0 ? Math.round(venue.totalSpentCents / venue.count) : 0;
  const lbStep = (d: number) => setLightbox((lb) => {
    if (!lb) return lb;
    const len = lb.photos.length;
    return { ...lb, i: (lb.i + d + len) % len };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-hive-paper w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-hive-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-hive-paper border-b border-hive-line px-4 py-3 flex items-start gap-3 z-10">
          <span className="text-3xl flex-shrink-0">{venue.emoji || '🍽️'}</span>
          <div className="flex-1 min-w-0">
            <h2 className="font-nunito font-black text-lg leading-tight flex items-center gap-1.5">
              {venue.name}
              {venue.diamond && <span title="Family Diamond — both parents' top pick">💎</span>}
            </h2>
            <p className="text-[12px] text-hive-muted font-bold mt-0.5">
              {venue.avgStars > 0 && <><Stars n={Math.round(venue.avgStars)} /> {venue.avgStars} · </>}
              {venue.count} visit{venue.count === 1 ? '' : 's'}
              {avgSpend > 0 && ` · ~${formatCents(avgSpend, currency)}/visit`}
            </p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="flex-shrink-0 w-8 h-8 rounded-full bg-hive-cream text-hive-muted text-base font-black flex items-center justify-center"
          >✕</button>
        </div>

        <div className="p-4">
          {/* Quick stats */}
          <div className="flex gap-4 flex-wrap">
            <div>
              <div className="font-nunito font-black text-lg">{formatCents(venue.totalSpentCents, currency)}</div>
              <div className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">total spent</div>
            </div>
            {ratingEntries.length > 0 && (
              <div className="min-w-0">
                <div className="font-nunito font-black text-sm flex flex-wrap gap-x-2 gap-y-0.5">
                  {ratingEntries.map((r, i) => (
                    <span key={i} className="whitespace-nowrap">
                      {r.name || 'Parent'} <Stars n={r.stars} />{r.diamond ? ' 💎' : ''}
                    </span>
                  ))}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">who rated</div>
              </div>
            )}
          </div>

          {/* Highlights */}
          {venue.highlights?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {venue.highlights.map((h) => (
                <span key={h} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#FBEAE0', border: '1px solid #E8C3AE', color: DINE }}>{h}</span>
              ))}
            </div>
          )}

          {/* Photos — the moments you took here. "Add photos" lets you
              attach pictures to any place (incl. ones logged earlier). */}
          {(familyId || photos.length > 0) && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Photos</div>
                {familyId && (
                  <label className="text-[11px] font-nunito font-black px-2.5 py-1 rounded-full border cursor-pointer transition-colors" style={{ borderColor: '#E8C3AE', background: '#FBEAE0', color: DINE }}>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={onAddPhotos} disabled={addingPhotos} />
                    {addingPhotos ? 'Adding…' : '＋ Add photos'}
                  </label>
                )}
              </div>
              {photos.length > 0 ? (
                <>
                  <div className="grid grid-cols-4 gap-1.5">
                    {photos.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => setLightbox({ photos, i })} aria-label="Open photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbUrl} alt="" loading="lazy" className="w-full aspect-square rounded-lg object-cover border border-hive-line" />
                      </button>
                    ))}
                  </div>
                  {familyId && (
                    <button
                      type="button" onClick={onShareToMoments} disabled={sharing}
                      className="mt-2 w-full rounded-hive py-2 font-nunito font-black text-[12px] border transition-colors disabled:opacity-50"
                      style={{ borderColor: '#9BC4E8', background: '#EAF1F8', color: '#2C6E9E' }}
                    >
                      {sharing ? 'Sharing…' : shared ? '✓ Shared to Moments · share again' : '📷 Share these to Moments'}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-hive-muted italic">No photos yet — tap “＋ Add photos” to keep the moments from this place here.</p>
              )}
            </div>
          )}

          {/* Visit history */}
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-hive-muted font-bold mb-1">Visit history</div>
            {visits.length === 0 ? (
              <p className="text-[12px] text-hive-muted italic">No detailed visits yet — new logs from now will show here with the occasion, what you ate and the spend.</p>
            ) : (
              <div className="flex flex-col">
                {visits.map((v, i) => (
                  <div key={i} className="border-t border-hive-line first:border-t-0 py-2">
                    <div className="font-nunito font-extrabold text-[12.5px] text-hive-navy">
                      {visitDate(v.atMs)}{v.byName ? ` · ${v.byName}` : ''}
                      {v.stars > 0 && <> · <Stars n={v.stars} /></>}
                      {v.diamond && ' 💎'}
                    </div>
                    <div className="text-[11.5px] text-hive-muted">
                      {v.note && <span className="italic">“{v.note}”</span>}
                      {v.note && (v.highlights?.length || v.spentCents > 0) && ' · '}
                      {v.highlights?.length ? v.highlights.join(', ') : ''}
                      {v.highlights?.length && v.spentCents > 0 ? ' · ' : (!v.note && v.spentCents > 0 ? '' : '')}
                      {v.spentCents > 0 && <>{(v.note || v.highlights?.length) ? ' · ' : ''}{formatCents(v.spentCents, currency)}</>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Use this place */}
          {onUse && (
            <button
              type="button"
              onClick={() => { onUse(venue); onClose(); }}
              className="mt-4 w-full text-white rounded-hive py-3 font-nunito font-black text-sm"
              style={{ background: DINE }}
            >
              Use this place →
            </button>
          )}
        </div>
      </div>

      {/* Lightbox (nested above the sheet) */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setLightbox(null); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.photos[lightbox.i].fullUrl || lightbox.photos[lightbox.i].feedUrl}
            alt="" className="max-h-[85vh] max-w-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button type="button" onClick={(e) => { e.stopPropagation(); setLightbox(null); }} aria-label="Close"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-hive-navy text-lg font-black flex items-center justify-center">✕</button>
          {lightbox.photos.length > 1 && (
            <>
              <button type="button" aria-label="Previous" onClick={(e) => { e.stopPropagation(); lbStep(-1); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-hive-navy text-2xl font-black flex items-center justify-center">‹</button>
              <button type="button" aria-label="Next" onClick={(e) => { e.stopPropagation(); lbStep(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-hive-navy text-2xl font-black flex items-center justify-center">›</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
