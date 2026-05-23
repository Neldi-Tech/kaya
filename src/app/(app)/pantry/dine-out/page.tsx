'use client';

// /pantry/dine-out — Household → Dine Out (parent quick-log + venues).
//
// Eating out is parent-logged as a single amount — no itemised basket.
// We post it straight to budget (closed) so it rolls up into Budget /
// Pulse / Finances, AND record it against a VENUE (the place you ate):
// star rating, Diamond (both parents → family Diamond), highlight tags,
// typical spend. "Places to go" below lets you filter + re-pick a venue.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  DINE_OUT_CATEGORIES, type DineOutCategory,
  createDraftRequest, postDraftToBudget,
} from '@/lib/purchase';
import { subscribeToVenues, recordVenueVisit, type Venue } from '@/lib/dineOutVenues';
import { formatCents } from '@/components/pantry/format';
import BudgetBalanceMeter from '@/components/pantry/BudgetBalanceMeter';
import BackButton from '@/components/ui/BackButton';

const DINE = '#C2562E';

export default function DineOutPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  const [venue, setVenue] = useState('');
  const [amount, setAmount] = useState('');
  const [tag, setTag] = useState<DineOutCategory>('restaurant');
  const [stars, setStars] = useState(0);
  const [diamond, setDiamond] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [hlDraft, setHlDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const [venues, setVenues] = useState<Venue[]>([]);
  const [placesFilter, setPlacesFilter] = useState<'all' | 'diamond' | 'top' | DineOutCategory>('all');

  // Parent-only surface — bounce helpers back to the Pantry home.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToVenues(profile.familyId, setVenues);
  }, [profile?.familyId, profile?.role]);

  const amountCents = Math.max(0, Math.round((parseFloat(amount) || 0) * 100));
  const canSave = amountCents > 0 && !saving && !isGuest;
  const tagEmoji = DINE_OUT_CATEGORIES.find((c) => c.id === tag)?.emoji ?? '🍽️';
  const tagLabel = DINE_OUT_CATEGORIES.find((c) => c.id === tag)?.label ?? 'Dine Out';

  const addHighlight = () => {
    const h = hlDraft.trim().replace(/\s+/g, ' ').slice(0, 22);
    if (!h || highlights.length >= 3 || highlights.includes(h)) { setHlDraft(''); return; }
    setHighlights((p) => [...p, h]);
    setHlDraft('');
  };

  const resetForm = () => {
    setVenue(''); setAmount(''); setStars(0); setDiamond(false);
    setHighlights([]); setHlDraft(''); setNote('');
  };

  const save = async () => {
    if (!profile?.familyId || !profile.uid || !canSave) return;
    setSaving(true);
    setJustSaved(false);
    try {
      const context = [venue.trim() || tagLabel, note.trim()].filter(Boolean).join(' · ');
      const id = await createDraftRequest(profile.familyId, {
        createdBy: profile.uid,
        createdByRole: 'parent',
        module: 'dineOut',
        context,
      });
      await postDraftToBudget(profile.familyId, id, profile.uid, amountCents);
      // Record the venue (reputation) — only when a venue name is given.
      if (venue.trim()) {
        await recordVenueVisit(profile.familyId, {
          name: venue.trim(),
          parentUid: profile.uid,
          stars, diamond, highlights,
          spentCents: amountCents,
          subTag: tag, emoji: tagEmoji,
        });
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
        {/* Venue */}
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-hive-muted font-bold">Venue · restaurant / hotel</span>
          <input
            type="text" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={60}
            placeholder="e.g. Mama's Kitchen"
            className="mt-1 w-full border-2 border-hive-line rounded-hive px-3 py-2 font-nunito font-black text-lg focus:outline-none focus:border-[#C2562E]"
          />
        </label>

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
              <button
                key={v.id} type="button" onClick={() => pickVenue(v)}
                className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3 text-left hover:border-[#C2562E] transition-colors"
              >
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
            ))}
            {filteredVenues.length === 0 && (
              <p className="text-[12px] text-hive-muted italic text-center py-3">No places match this filter.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
