'use client';

// /pantry/onboard — first-time AI seeding. The parent describes their
// family in plain text ("family of 5 in Tanzania, 2 kids + 1 baby, no
// pork, prefer Pishori rice") and we hand back a ranked list of ~30
// staples with reasons + scaled quantities. One tap saves them all to
// the family's master list.
//
// Phase 1B uses a rule-based parser (`pantryDirectory.ts`) for offline
// reliability + zero API cost. The same UI swaps to an LLM call later
// when an env var is set — the parser returns the same OnboardingProfile
// shape either way, and the seed list is derived from STAPLES_DIRECTORY
// regardless of source.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import {
  parseFamilyDescription, seedStaplesFromProfile,
  SeededStaple, OnboardingProfile,
} from '@/lib/pantryDirectory';
import { addStaplesBulk, STAPLE_CATEGORIES } from '@/lib/pantry';
import BackButton from '@/components/ui/BackButton';

const SAMPLE_DESCRIPTIONS = [
  'Family of 5 in Tanzania, 2 kids and 1 baby. We love rice, chapati and beans. No pork.',
  'Indian household, 4 of us, vegetarian. We make dal-rice, biryani, paratha. Prefer basmati.',
  'Kenyan family of 6, 3 kids. Sukuma wiki and ugali every week. Healthy meals.',
  'Couple, 2 of us. We eat simple — pasta, salads, eggs. No big shopping.',
];

export default function OnboardPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { staples, loading: pantryLoading } = usePantry();

  const [text, setText] = useState('');
  const [profileResult, setProfileResult] = useState<OnboardingProfile | null>(null);
  const [seeded, setSeeded] = useState<SeededStaple[]>([]);
  // Per-row inclusion — defaults to all-on. Keyed by item label.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [error, setError] = useState('');

  const generate = () => {
    setError('');
    if (text.trim().length < 6) {
      setError('Tell us a little more — even one sentence works.');
      return;
    }
    const p = parseFamilyDescription(text);
    setProfileResult(p);
    const rows = seedStaplesFromProfile(p, 40);
    setSeeded(rows);
    const allOn: Record<string, boolean> = {};
    rows.forEach((r) => { allOn[r.item.label] = true; });
    setPicked(allOn);
    setSavedCount(null);
  };

  const togglePick = (label: string) => {
    setPicked((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const pickAll = (on: boolean) => {
    const next: Record<string, boolean> = {};
    seeded.forEach((r) => { next[r.item.label] = on; });
    setPicked(next);
  };

  const seedCount = useMemo(
    () => seeded.filter((r) => picked[r.item.label]).length,
    [seeded, picked],
  );

  const submit = async () => {
    if (!profile?.familyId || isGuest) {
      setError('Sign in to save your starter list.');
      return;
    }
    if (seedCount === 0) {
      setError('Pick at least one item to add.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const rows = seeded
        .filter((r) => picked[r.item.label])
        .map((r) => ({
          name: r.item.label,
          category: r.item.category,
          defaultQty: r.qty,
          unit: r.item.unit,
          cadence: r.item.cadence,
          preferredBrands: r.brands.length > 0 ? r.brands.slice(0, 3) : undefined,
        }));
      const written = await addStaplesBulk(profile.familyId, rows, staples);
      setSavedCount(written);
      // Brief toast then route to staples to confirm.
      setTimeout(() => router.push('/pantry/staples'), 1200);
    } catch (e: any) {
      setError(e?.message || 'Could not seed staples. Try again.');
    }
    setSaving(false);
  };

  // Group the seeded rows by category for the review screen.
  const grouped = useMemo(() => {
    const out: Record<string, SeededStaple[]> = {};
    for (const r of seeded) {
      const key = r.item.category;
      if (!out[key]) out[key] = [];
      out[key].push(r);
    }
    return out;
  }, [seeded]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-24">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">Pantry · Quick start</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1 leading-tight">Tell us about your family ✨</h1>
        <p className="text-[12px] text-hive-muted mt-1 leading-relaxed">
          One paragraph and we&apos;ll suggest a starter list. Tweak it before saving.
        </p>
      </div>

      {/* Free-text intake */}
      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Family of 5 in Tanzania, 2 kids + 1 baby. We love rice, chapati and beans. No pork. Prefer Pishori rice."
          rows={5}
          className="w-full bg-hive-cream rounded-hive p-3 text-[13px] leading-relaxed border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40 resize-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SAMPLE_DESCRIPTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => setText(s)}
              className="px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border border-hive-line bg-hive-cream/40 text-hive-muted hover:border-pantry-leaf/40 hover:text-pantry-leaf-dk transition-colors"
            >
              Sample {i + 1}
            </button>
          ))}
        </div>
        <button
          onClick={generate}
          disabled={text.trim().length < 6}
          className="mt-3 w-full h-12 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
        >
          ✨ Build my starter list
        </button>
      </div>

      {error && <p className="text-hive-rose text-sm font-bold mb-3 text-center">{error}</p>}

      {/* What we picked up */}
      {profileResult && (
        <div className="bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf rounded-hive-lg p-4 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk mb-2">What we picked up</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Pill>{profileResult.size} {profileResult.size === 1 ? 'person' : 'people'}</Pill>
            {profileResult.kids > 0 && <Pill>{profileResult.kids} kid{profileResult.kids === 1 ? '' : 's'}</Pill>}
            {profileResult.babies > 0 && <Pill>{profileResult.babies} baby</Pill>}
            {Array.from(profileResult.tags).map((t) => <Pill key={t}>{t}</Pill>)}
            {profileResult.brands.length > 0 && profileResult.brands.map((b) => (
              <Pill key={b} dim>brand: {b}</Pill>
            ))}
            {profileResult.excludes.length > 0 && profileResult.excludes.map((e) => (
              <Pill key={e} warn>no {e}</Pill>
            ))}
          </div>
          <p className="text-[11px] text-hive-muted">
            Not right? Edit your description and tap &quot;Build my starter list&quot; again.
          </p>
        </div>
      )}

      {/* Seeded list — grouped by category */}
      {seeded.length > 0 && (
        <>
          <div className="flex items-baseline justify-between mb-2 mt-4">
            <h2 className="font-nunito font-black text-xl">{seedCount} item{seedCount === 1 ? '' : 's'} ready</h2>
            <div className="flex gap-2">
              <button
                onClick={() => pickAll(true)}
                className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline"
              >
                Select all
              </button>
              <span className="text-hive-line">·</span>
              <button
                onClick={() => pickAll(false)}
                className="text-[11px] font-nunito font-extrabold text-hive-muted hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {STAPLE_CATEGORIES.map((cat) => {
              const rows = grouped[cat.id];
              if (!rows || rows.length === 0) return null;
              return (
                <div key={cat.id} className="bg-hive-paper border border-hive-line rounded-hive p-3">
                  <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-2">
                    {cat.emoji} {cat.label} · {rows.length}
                  </p>
                  <div className="space-y-1.5">
                    {rows.map((r) => {
                      const on = !!picked[r.item.label];
                      return (
                        <label
                          key={r.item.label}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-[10px] cursor-pointer transition-colors ${
                            on ? 'bg-pantry-leaf-soft/40' : 'opacity-60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => togglePick(r.item.label)}
                            className="w-4 h-4 accent-pantry-leaf"
                          />
                          <span className="text-base">{r.item.emoji}</span>
                          <span className="font-nunito font-extrabold text-[13px] flex-1 truncate">
                            {r.item.label}
                          </span>
                          <span className="text-[11px] text-hive-muted font-bold">
                            {r.qty} {r.item.unit}
                          </span>
                          {r.brands.length > 0 && (
                            <span className="text-[10px] text-pantry-leaf-dk font-bold uppercase tracking-wider">
                              {r.brands[0]}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 sticky bottom-2 bg-hive-paper/95 backdrop-blur border border-hive-line rounded-hive p-3 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.15)]">
            <button
              onClick={submit}
              disabled={saving || seedCount === 0 || isGuest}
              className="w-full h-12 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors"
            >
              {saving ? 'Saving…' : savedCount !== null ? `✓ Added ${savedCount}` : `Add ${seedCount} item${seedCount === 1 ? '' : 's'} to my staples`}
            </button>
            <p className="text-center text-[10px] text-hive-muted mt-2">
              You can edit, delete, or add more on the staples page.
            </p>
          </div>
        </>
      )}

      {/* Pre-state hint */}
      {seeded.length === 0 && !pantryLoading && staples.length > 0 && (
        <div className="text-[12px] text-hive-muted text-center mt-4">
          You already have <strong className="text-pantry-leaf-dk">{staples.length} staple{staples.length === 1 ? '' : 's'}</strong>.{' '}
          We&apos;ll skip duplicates when adding new ones.
        </div>
      )}

      <p className="text-center text-[11px] text-hive-muted mt-6">
        Prefer to browse? <Link href="/pantry/directory" className="text-pantry-leaf-dk font-bold hover:underline">Open the Directory →</Link>
      </p>
    </div>
  );
}

function Pill({ children, dim, warn }: { children: React.ReactNode; dim?: boolean; warn?: boolean }) {
  const tone = warn
    ? 'bg-hive-rose/15 text-hive-rose'
    : dim
      ? 'bg-hive-cream text-hive-muted'
      : 'bg-pantry-leaf-soft text-pantry-leaf-dk';
  return (
    <span className={`px-2 py-0.5 rounded-hive-pill text-[10px] font-nunito font-extrabold uppercase tracking-wider ${tone}`}>
      {children}
    </span>
  );
}
