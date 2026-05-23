'use client';

// /pantry/dine-out — Household → Dine Out (parent quick-log + venues).
//
// Eating out is parent-logged as a single amount — no itemised basket.
// We post it straight to budget (closed) so it rolls up into Budget /
// Pulse / Finances, AND record it against a VENUE (the place you ate):
// star rating, Diamond (both parents → family Diamond), highlight tags,
// typical spend, and photos. "Places to go" below lets you filter +
// re-pick a venue and browse its gallery.
//
// AI venue search (Dine Out 2.0): as you type, /api/venue-search returns
// the correct global name + a cuisine emoji. Photos stay with the venue
// and can optionally be shared to the Moments feed.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  DINE_OUT_CATEGORIES, type DineOutCategory,
  createDraftRequest, postDraftToBudget,
} from '@/lib/purchase';
import {
  subscribeToVenues, recordVenueVisit, uploadVenuePhoto, venueId, type Venue,
} from '@/lib/dineOutVenues';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { createPost, type PhotoRef } from '@/lib/moments';
import { formatCents } from '@/components/pantry/format';
import BudgetBalanceMeter from '@/components/pantry/BudgetBalanceMeter';
import BackButton from '@/components/ui/BackButton';

const DINE = '#C2562E';
const MAX_PHOTOS = 6;

interface VenueSuggestion { name: string; emoji: string; cuisine: string }

export default function DineOutPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  const [venue, setVenue] = useState('');
  const [venueEmoji, setVenueEmoji] = useState(''); // cuisine emoji from AI / picked suggestion
  const [amount, setAmount] = useState('');
  const [tag, setTag] = useState<DineOutCategory>('restaurant');
  const [stars, setStars] = useState(0);
  const [diamond, setDiamond] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [hlDraft, setHlDraft] = useState('');
  const [note, setNote] = useState('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [shareToMoments, setShareToMoments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // AI venue search
  const [suggests, setSuggests] = useState<VenueSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const [venues, setVenues] = useState<Venue[]>([]);
  const [placesFilter, setPlacesFilter] = useState<'all' | 'diamond' | 'top' | DineOutCategory>('all');
  const [lightbox, setLightbox] = useState<{ photos: PhotoRef[]; i: number } | null>(null);

  // Keep a ref so the AI-search effect can check saved venues without
  // re-firing on every venue-list snapshot.
  const venuesRef = useRef<Venue[]>([]);
  useEffect(() => { venuesRef.current = venues; }, [venues]);

  // Parent-only surface — bounce helpers back to the Pantry home.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToVenues(profile.familyId, setVenues);
  }, [profile?.familyId, profile?.role]);

  // Debounced AI venue-name search. Skips when the field is short or
  // already matches a saved venue exactly (you've logged it before).
  useEffect(() => {
    const q = venue.trim();
    if (q.length < 3) { setSuggests([]); setSearching(false); return; }
    if (venuesRef.current.some((v) => v.name.toLowerCase() === q.toLowerCase())) {
      setSuggests([]); setSearching(false); return;
    }
    let active = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/venue-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q }),
        });
        const data = await res.json();
        if (!active) return;
        const cands: VenueSuggestion[] = Array.isArray(data?.candidates) ? data.candidates : [];
        // Drop a candidate that's identical to what they already typed.
        setSuggests(cands.filter((c) => c?.name && c.name.toLowerCase() !== q.toLowerCase()).slice(0, 3));
      } catch {
        if (active) setSuggests([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 450);
    return () => { active = false; clearTimeout(t); };
  }, [venue]);

  // Local object-URL previews for picked photos (revoked on change/unmount).
  const photoPreviews = useMemo(() => photoFiles.map((f) => URL.createObjectURL(f)), [photoFiles]);
  useEffect(() => () => { photoPreviews.forEach((u) => URL.revokeObjectURL(u)); }, [photoPreviews]);

  const amountCents = Math.max(0, Math.round((parseFloat(amount) || 0) * 100));
  const canSave = amountCents > 0 && !saving && !isGuest;
  const tagEmoji = DINE_OUT_CATEGORIES.find((c) => c.id === tag)?.emoji ?? '🍽️';
  const tagLabel = DINE_OUT_CATEGORIES.find((c) => c.id === tag)?.label ?? 'Dine Out';
  const effectiveEmoji = venueEmoji || tagEmoji;

  const addHighlight = () => {
    const h = hlDraft.trim().replace(/\s+/g, ' ').slice(0, 22);
    if (!h || highlights.length >= 3 || highlights.includes(h)) { setHlDraft(''); return; }
    setHighlights((p) => [...p, h]);
    setHlDraft('');
  };

  const pickSuggest = (s: VenueSuggestion) => {
    setVenue(s.name);
    setVenueEmoji(s.emoji || '');
    if (s.cuisine === 'coffee') setTag('coffee');
    setSuggests([]);
  };

  const onPickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    setPhotoFiles((p) => [...p, ...files].slice(0, MAX_PHOTOS));
    e.target.value = ''; // let the same file be re-picked
  };

  const resetForm = () => {
    setVenue(''); setVenueEmoji(''); setAmount(''); setStars(0); setDiamond(false);
    setHighlights([]); setHlDraft(''); setNote('');
    setPhotoFiles([]); setShareToMoments(false); setSuggests([]);
  };

  const save = async () => {
    if (!profile?.familyId || !profile.uid || !canSave) return;
    setSaving(true);
    setJustSaved(false);
    try {
      const name = venue.trim();
      const context = [name || tagLabel, note.trim()].filter(Boolean).join(' · ');
      const id = await createDraftRequest(profile.familyId, {
        createdBy: profile.uid,
        createdByRole: 'parent',
        module: 'dineOut',
        context,
      });
      await postDraftToBudget(profile.familyId, id, profile.uid, amountCents);

      // Record the venue (reputation) — only when a venue name is given.
      if (name) {
        const vid = venueId(name);
        // Upload photos (best-effort, sequential — friendlier on mobile).
        const refs: PhotoRef[] = [];
        for (const f of photoFiles) {
          try {
            const processed = await processPhotoForUpload(f);
            refs.push(await uploadVenuePhoto(profile.familyId, vid, processed));
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[dine-out] photo upload failed:', err);
          }
        }
        await recordVenueVisit(profile.familyId, {
          name,
          parentUid: profile.uid,
          stars, diamond, highlights,
          spentCents: amountCents,
          subTag: tag, emoji: effectiveEmoji,
          newPhotos: refs,
        });
        // Optional: also share the photos to the family Moments feed.
        if (shareToMoments && refs.length) {
          try {
            const caption = `${name} ${effectiveEmoji}`
              + (stars ? ` · ${'★'.repeat(stars)}` : '')
              + (note.trim() ? ` · ${note.trim()}` : '');
            await createPost(profile.familyId, {
              authorUid: profile.uid,
              authorName: profile.displayName,
              ...(profile.avatarPhoto ? { authorAvatar: profile.avatarPhoto } : {}),
              caption,
              photos: refs,
              kidTags: [],
              eventTag: { id: 'dineout', emoji: '🍽️', label: 'Dine Out' },
              visibility: 'family',
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[dine-out] share to Moments failed:', err);
          }
        }
      }
      resetForm();
      setJustSaved(true);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[dine-out] save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const pickVenue = (v: Venue) => {
    setVenue(v.name);
    setVenueEmoji(v.emoji && v.emoji !== '🍽️' ? v.emoji : '');
    if (v.subTag && DINE_OUT_CATEGORIES.some((c) => c.id === v.subTag)) setTag(v.subTag as DineOutCategory);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredVenues = useMemo(() => {
    return venues.filter((v) => {
      if (placesFilter === 'all') return true;
      if (placesFilter === 'diamond') return v.diamond;
      if (placesFilter === 'top') return v.avgStars >= 4;
      return v.subTag === placesFilter;
    });
  }, [venues, placesFilter]);

  // Lightbox navigation
  const lbStep = (d: number) => setLightbox((lb) => {
    if (!lb) return lb;
    const n = lb.photos.length;
    return { ...lb, i: (lb.i + d + n) % n };
  });

  if (profile && profile.role !== 'parent') return null;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px]" style={{ color: DINE }}>Household · Dine Out</p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">Log a meal out</h1>
        <p className="text-hive-muted text-sm mt-1">Where you ate, the amount, and a quick rating — it counts toward your Dine Out budget and builds your Places to go.</p>
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 lg:p-5">
        {/* Venue + AI search */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Venue · restaurant / hotel</span>
          <div className="mt-1 flex items-center gap-2 border-2 border-hive-line rounded-hive px-3 py-2 focus-within:border-[#C2562E]">
            {effectiveEmoji && venue.trim() && <span className="text-xl flex-shrink-0">{effectiveEmoji}</span>}
            <input
              type="text" value={venue}
              onChange={(e) => { setVenue(e.target.value); setVenueEmoji(''); }}
              maxLength={60}
              placeholder="e.g. Mama's Kitchen"
              className="flex-1 bg-transparent font-nunito font-black text-lg focus:outline-none w-full"
            />
          </div>
        </label>
        {/* AI suggestions */}
        {(searching || suggests.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
            {searching && suggests.length === 0 && (
              <span className="text-[11px] text-hive-muted font-bold">✨ Finding the right name…</span>
            )}
            {suggests.map((s) => (
              <button
                key={s.name} type="button" onClick={() => pickSuggest(s)}
                className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1 rounded-full border border-[#E8C3AE] bg-[#FBEAE0] hover:border-[#C2562E] transition-colors"
                style={{ color: DINE }}
              >
                {s.emoji} {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Amount */}
        <label className="block mt-3">
          <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Amount</span>
          <div className="mt-1 flex items-center gap-2 border-2 border-hive-line rounded-hive px-3 py-2 focus-within:border-[#C2562E]">
            <span className="text-hive-muted font-bold text-sm">{currency}</span>
            <input
              type="number" inputMode="decimal" min="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent font-nunito font-black text-2xl focus:outline-none w-full"
            />
          </div>
        </label>

        {/* Sub-tag */}
        <div className="mt-3 flex flex-wrap gap-2">
          {DINE_OUT_CATEGORIES.map((c) => (
            <button
              key={c.id} type="button" onClick={() => setTag(c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                tag === c.id ? 'text-white border-transparent' : 'border-hive-line bg-white text-hive-muted hover:border-[#C2562E]'
              }`}
              style={tag === c.id ? { background: DINE } : undefined}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        {/* Rating + Diamond */}
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Your rating</span>
            <div className="mt-0.5 text-2xl leading-none select-none">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} type="button" onClick={() => setStars(stars === i ? i - 1 : i)} aria-label={`${i} stars`}
                  className="align-middle">
                  <span style={{ color: i <= stars ? '#D4A017' : '#E8E0D4' }}>★</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button" onClick={() => setDiamond((d) => !d)}
            className={`px-3 py-2 rounded-hive text-xs font-nunito font-black border-2 transition-colors ${
              diamond ? 'bg-[#EAF1F8] border-[#9BC4E8] text-[#2C6E9E]' : 'bg-white border-hive-line text-hive-muted'
            }`}
            title="Diamond — your top pick. Becomes a family Diamond when both parents agree."
          >
            💎 {diamond ? 'Diamond pick' : 'Mark Diamond'}
          </button>
        </div>

        {/* Highlights */}
        <div className="mt-3">
          <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Highlights · 1–2 words (filter later)</span>
          <div className="mt-1 flex flex-wrap gap-1.5 items-center">
            {highlights.map((h) => (
              <span key={h} className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: '#FBEAE0', border: '1px solid #E8C3AE', color: DINE }}>
                {h}
                <button type="button" onClick={() => setHighlights((p) => p.filter((x) => x !== h))} className="font-black" aria-label="Remove">×</button>
              </span>
            ))}
            {highlights.length < 3 && (
              <input
                type="text" value={hlDraft}
                onChange={(e) => setHlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addHighlight(); } }}
                onBlur={addHighlight}
                placeholder="e.g. great pizza"
                maxLength={22}
                className="text-[12px] font-bold border border-hive-line rounded-full px-3 py-1 focus:outline-none focus:border-[#C2562E] w-32"
              />
            )}
          </div>
        </div>

        {/* Optional note */}
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80}
          placeholder="Optional note · e.g. birthday dinner"
          className="mt-3 w-full border border-hive-line rounded-hive px-3 py-2 text-sm font-bold"
        />

        {/* Photos — stay with this place; optionally share to Moments */}
        {venue.trim() && (
          <div className="mt-3">
            <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Photos · stay with this place</span>
            <div className="mt-1 flex flex-wrap gap-2 items-center">
              {photoPreviews.map((src, i) => (
                <div key={i} className="relative w-16 h-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-16 h-16 rounded-lg object-cover border border-hive-line" />
                  <button
                    type="button" aria-label="Remove photo"
                    onClick={() => setPhotoFiles((p) => p.filter((_, idx) => idx !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-hive-line text-hive-muted text-xs font-black flex items-center justify-center shadow"
                  >×</button>
                </div>
              ))}
              {photoFiles.length < MAX_PHOTOS && (
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-hive-line flex items-center justify-center cursor-pointer hover:border-[#C2562E] transition-colors">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onPickPhotos} />
                  <span className="text-2xl text-hive-muted leading-none">＋</span>
                </label>
              )}
            </div>
            {photoFiles.length > 0 && (
              <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox" checked={shareToMoments}
                  onChange={(e) => setShareToMoments(e.target.checked)}
                  className="w-4 h-4 accent-[#C2562E]"
                />
                <span className="text-xs font-bold text-hive-muted">Also share these to Moments ✨</span>
              </label>
            )}
          </div>
        )}

        {/* Live budget meter */}
        <BudgetBalanceMeter module="dineOut" pendingAmountCents={amountCents} className="mt-4" />

        <button
          type="button" onClick={save} disabled={!canSave}
          className="mt-4 w-full text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg disabled:opacity-50"
          style={{ background: DINE, boxShadow: '0 10px 20px -8px rgba(194,86,46,.4)' }}
        >
          {saving ? 'Logging…' : amountCents > 0 ? `✓ Log ${formatCents(amountCents, currency)}${stars ? ` · ${'★'.repeat(stars)}` : ''}` : 'Enter an amount'}
        </button>
        {justSaved && <p className="text-center text-xs text-pantry-leaf-dk font-bold mt-2">✓ Logged · venue updated.</p>}
        {isGuest && <p className="text-center text-xs text-hive-muted mt-2">Guest mode — sign in to log spend.</p>}
      </div>

      {/* ── Places to go ───────────────────────────────────────── */}
      {venues.length > 0 && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-2 mb-2 px-0.5">
            <h2 className="font-nunito font-black text-[15px]">📍 Places to go</h2>
            <span className="text-[11px] text-hive-muted">{venues.length} saved</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {[
              { id: 'all', label: 'All' },
              { id: 'diamond', label: '💎 Diamond' },
              { id: 'top', label: '★ 4+' },
              ...DINE_OUT_CATEGORIES.map((c) => ({ id: c.id, label: `${c.emoji} ${c.label}` })),
            ].map((f) => (
              <button
                key={f.id} type="button" onClick={() => setPlacesFilter(f.id as typeof placesFilter)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                  placesFilter === f.id ? 'text-white border-transparent' : 'border-hive-line bg-white text-hive-muted hover:border-[#C2562E]'
                }`}
                style={placesFilter === f.id ? { background: DINE } : undefined}
              >{f.label}</button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {filteredVenues.map((v) => (
              <div
                key={v.id}
                className="bg-hive-paper border border-hive-line rounded-hive p-3 hover:border-[#C2562E] transition-colors"
              >
                <button type="button" onClick={() => pickVenue(v)} className="w-full flex items-center gap-3 text-left">
                  <span className="text-2xl flex-shrink-0">{v.emoji || '🍽️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate flex items-center gap-1.5">
                      {v.name}
                      {v.diamond && <span title="Family Diamond — both parents' top pick">💎</span>}
                    </div>
                    <div className="text-[11px] text-hive-muted mt-0.5 truncate">
                      {v.avgStars > 0 && <span className="font-bold" style={{ color: '#B8860B' }}>★ {v.avgStars}</span>}
                      {v.avgStars > 0 && ' · '}{v.count} visit{v.count === 1 ? '' : 's'}
                      {v.count > 0 && ` · ~${formatCents(Math.round(v.totalSpentCents / v.count), currency)}`}
                      {v.highlights.length > 0 && ` · ${v.highlights.slice(0, 2).join(', ')}`}
                    </div>
                  </div>
                  <span className="text-[11px] font-nunito font-extrabold flex-shrink-0" style={{ color: DINE }}>Use →</span>
                </button>
                {v.photos && v.photos.length > 0 && (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                    {v.photos.slice(0, 8).map((p, i) => (
                      <button
                        key={p.id} type="button"
                        onClick={() => setLightbox({ photos: v.photos!, i })}
                        className="flex-shrink-0"
                        aria-label={`Photo from ${v.name}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbUrl} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover border border-hive-line" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {filteredVenues.length === 0 && (
              <p className="text-[12px] text-hive-muted italic text-center py-3">No places match this filter.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Photo lightbox ─────────────────────────────────────── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.photos[lightbox.i].fullUrl || lightbox.photos[lightbox.i].feedUrl}
            alt=""
            className="max-h-[85vh] max-w-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button" onClick={() => setLightbox(null)} aria-label="Close"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 text-hive-navy text-lg font-black flex items-center justify-center"
          >✕</button>
          {lightbox.photos.length > 1 && (
            <>
              <button
                type="button" aria-label="Previous"
                onClick={(e) => { e.stopPropagation(); lbStep(-1); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-hive-navy text-2xl font-black flex items-center justify-center"
              >‹</button>
              <button
                type="button" aria-label="Next"
                onClick={(e) => { e.stopPropagation(); lbStep(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 text-hive-navy text-2xl font-black flex items-center justify-center"
              >›</button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/90 text-xs font-bold">
                {lightbox.i + 1} / {lightbox.photos.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
