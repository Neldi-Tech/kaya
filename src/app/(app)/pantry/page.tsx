'use client';

// /pantry — Home dashboard. The first thing parents see when they open
// the section. Phase 1A version: this-week list preview, supplier
// shortcuts, "Start a new list" CTA when nothing's open. Budget bar
// and upcoming-meals card return in Phase 1B.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  createListFromStaples, createList, thisWeekKey, thisWeekLabel,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import SupplierBadge from '@/components/pantry/SupplierBadge';

export default function PantryHomePage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { staples, sokoSuppliers, currentList, loading } = usePantry();
  const isParent = profile?.role === 'parent';
  const { config } = useHive();
  const currency = config.currency;

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const startWeek = async () => {
    if (!profile?.familyId || isGuest) return;
    setError('');
    setCreating(true);
    try {
      // Seed from staples if any exist; otherwise an empty list.
      const id = staples.length > 0
        ? await createListFromStaples(
            profile.familyId, staples, profile.uid, thisWeekKey(), thisWeekLabel(),
          )
        : await createList(
            profile.familyId, { name: thisWeekLabel(), weekOf: thisWeekKey() }, profile.uid,
          );
      router.push(`/pantry/list/${id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not start a new list.');
    }
    setCreating(false);
  };

  const itemCount = currentList?.items.length || 0;
  const doneCount = currentList?.items.filter((i) => i.done).length || 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · {family?.name ? `${family.name} household` : 'this week'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          Run the week 🛒
        </h1>
      </div>

      {/* Active list card — or "Start a new list" empty state. */}
      {loading ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-6 text-center text-hive-muted text-sm">
          Loading…
        </div>
      ) : currentList ? (
        <Link
          href={`/pantry/list/${currentList.id}`}
          className="block bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-4 no-underline text-inherit hover:border-pantry-leaf transition-colors"
        >
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-nunito font-extrabold text-[14px]">
              {currentList.name}
            </p>
            <span className="text-[11px] text-pantry-leaf-dk font-nunito font-extrabold">Open →</span>
          </div>
          <p className="text-[12px] text-hive-muted">
            <strong className="text-hive-navy">{itemCount}</strong> items · {doneCount} done · est.{' '}
            <strong className="text-pantry-leaf-dk">{formatCents(currentList.estimatedTotalCents, currency)}</strong>
          </p>
          {currentList.items.length === 0 && (
            <p className="text-[11px] text-hive-muted italic mt-2">
              Empty list — open it to add items, or start fresh from your staples.
            </p>
          )}
        </Link>
      ) : (
        <div className="bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf rounded-hive-lg p-5 mb-4 text-center">
          <p className="font-nunito font-black text-lg mb-1">No active list</p>
          <p className="text-[12px] text-hive-muted leading-relaxed mb-4">
            {staples.length > 0
              ? `Three ways to start — Smart-start, pick a template, or seed from your ${staples.length} saved staple${staples.length === 1 ? '' : 's'}.`
              : 'Pick a door — Smart-start asks 6 quick questions, or browse templates.'}
          </p>

          {/* Primary CTA → the three-doors page */}
          <Link
            href="/pantry/list/new"
            className="block w-full h-12 leading-[3rem] rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm transition-colors shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)] no-underline"
          >
            ✨ Start a new list
          </Link>

          {/* Quick pivot for parents who already have staples saved */}
          {staples.length > 0 && (
            <button
              onClick={startWeek}
              disabled={creating || isGuest}
              className="w-full mt-2 h-10 rounded-hive-pill bg-hive-paper border border-pantry-leaf/40 text-pantry-leaf-dk font-nunito font-extrabold text-[12px] disabled:opacity-40"
            >
              {creating ? 'Seeding…' : `Or seed from my ${staples.length} staples`}
            </button>
          )}
          {staples.length === 0 && (
            <p className="mt-3 text-[11px] text-hive-muted">
              <Link href="/pantry/staples" className="text-pantry-leaf-dk font-bold hover:underline">+ Add staples first</Link> for a saved master list later.
            </p>
          )}
          {error && <p className="text-hive-rose text-[12px] font-bold mt-2">{error}</p>}
        </div>
      )}

      {/* Quick actions — grouped per v4-final §02 (2026-05-18):
          Request modules · Catalogues & plans · Browse & suppliers.
          Finances + Budget are intentionally NOT here — they're in the
          sidebar / tab bar as parent-only money surfaces. */}

      {/* ── Request modules ── */}
      <Divider label="Request modules" />
      <div className="grid grid-cols-2 gap-3 mb-2">
        <Link href="/pantry/purchase"
          className="bg-pantry-leaf-soft border border-pantry-leaf rounded-hive p-4 flex flex-col gap-1 hover:border-pantry-leaf-dk transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">🧾</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Household Purchase</span>
          <span className="text-[11px] text-pantry-leaf-dk font-bold">Request → approve → reconcile</span>
        </Link>
        <Link href="/pantry/utility"
          className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-4 flex flex-col gap-1 hover:border-hive-honey-dk transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">⚡</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Utilities</span>
          <span className="text-[11px] text-hive-honey-dk font-bold">Top-ups + bills · per-meter</span>
        </Link>
        <Link href="/pantry/outdoor"
          className="bg-[#E6F2EC] border border-pantry-leaf rounded-hive p-4 flex flex-col gap-1 hover:border-pantry-leaf-dk transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">🌿</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Outdoor</span>
          <span className="text-[11px] text-pantry-leaf-dk font-bold">Garden · pool · kuku · pets</span>
        </Link>
        <Link href="/pantry/drivers"
          className="bg-[#E5EFF8] border border-[#B5CFE5] rounded-hive p-4 flex flex-col gap-1 hover:border-hive-blue transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">🚗</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Drivers</span>
          <span className="text-[11px] text-hive-blue font-bold">Fuel · service · spare parts</span>
        </Link>
        <Link href="/pantry/payroll"
          className="bg-[#F4EFFB] border border-[#C9B8E5] rounded-hive p-4 flex flex-col gap-1 hover:border-[#8A6FBF] transition-colors no-underline text-inherit col-span-2">
          <span className="text-2xl leading-none">🤝</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Payroll</span>
          <span className="text-[11px] text-[#5E4A8F] font-bold">Self-service · advances · loans</span>
        </Link>
      </div>

      {/* ── Catalogues & plans ── */}
      <Divider label="Catalogues & plans" />
      <div className="grid grid-cols-2 gap-3 mb-2">
        <Link href="/pantry/staples"
          className="bg-hive-paper border border-hive-line rounded-hive p-4 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">📦</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Staples</span>
          <span className="text-[11px] text-hive-muted">Your family's regulars · {staples.length} item{staples.length === 1 ? '' : 's'}</span>
        </Link>
        <Link href="/pantry/meals"
          className="bg-hive-paper border border-hive-line rounded-hive p-4 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit">
          <span className="text-2xl leading-none">📅</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Meal Planner</span>
          <span className="text-[11px] text-hive-muted">7-day timetable</span>
        </Link>
        <Link href="/pantry/people"
          className="bg-hive-paper border border-hive-line rounded-hive p-4 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit col-span-2">
          <span className="text-2xl leading-none">📋</span>
          <span className="font-nunito font-extrabold text-[15px] mt-1">Workplan</span>
          <span className="text-[11px] text-hive-muted">Helpers · duties · ＋ assign one-off work</span>
        </Link>
      </div>

      {/* ── Browse & suppliers ── */}
      <Divider label="Browse & suppliers" />
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Link href="/pantry/browse"
          className="bg-hive-paper border border-hive-line rounded-hive p-3 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit">
          <span className="text-xl leading-none">🧺</span>
          <span className="font-nunito font-extrabold text-[13px] mt-1">Browse Catalogue</span>
          <span className="text-[10px] text-hive-muted">Pantry · Foods + Household</span>
        </Link>
        <Link href="/pantry/browse/others"
          className="bg-hive-paper border border-hive-line rounded-hive p-3 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit">
          <span className="text-xl leading-none">📂</span>
          <span className="font-nunito font-extrabold text-[13px] mt-1">Other Catalogue</span>
          <span className="text-[10px] text-hive-muted">Outdoor · Utility · Drivers · Payroll</span>
        </Link>
        <Link href="/pantry/suppliers"
          className="bg-hive-paper border border-hive-line rounded-hive p-3 flex flex-col gap-1 hover:border-pantry-leaf transition-colors no-underline text-inherit">
          <span className="text-xl leading-none">🏪</span>
          <span className="font-nunito font-extrabold text-[13px] mt-1">Soko</span>
          <span className="text-[10px] text-hive-muted">
            {sokoSuppliers.length} supplier{sokoSuppliers.length === 1 ? '' : 's'}
          </span>
        </Link>
      </div>

      {/* Suppliers preview — top 3, tap-through to /pantry/suppliers */}
      {sokoSuppliers.length > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-nunito font-extrabold text-[14px]">Recent suppliers</h3>
            <Link href="/pantry/suppliers" className="text-[11px] font-nunito font-extrabold text-pantry-leaf-dk hover:underline">
              See all →
            </Link>
          </div>
          <div className="space-y-2">
            {sokoSuppliers.slice(0, 3).map((s) => (
              <Link
                key={s.id}
                href="/pantry/suppliers"
                className="flex items-center gap-3 p-2 rounded-hive border border-hive-line bg-hive-cream/30 hover:border-pantry-leaf transition-colors no-underline text-inherit"
              >
                <div className="w-9 h-9 rounded-[10px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center font-nunito font-black">
                  {s.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[13px] truncate">{s.name}</p>
                  {s.contactName && (
                    <p className="text-[10px] text-hive-muted truncate">{s.contactName}</p>
                  )}
                </div>
                {s.phone && (
                  <span className="text-[10px] text-pantry-leaf-dk font-bold">📱</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Hairline group divider with an uppercase label. Used to separate the
// /pantry tile grid into 3 semantic groups (Request modules · Catalogues
// & plans · Browse & suppliers) per the v4-final design.
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2 px-1 text-[10px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted">
      <span>{label}</span>
      <span className="flex-1 h-px bg-hive-line" />
    </div>
  );
}
