'use client';

// /pantry/browse/other — Other Regulars · per-module sub-tabs.
//
// v5 (2026-05-19, Elia's "regulars under one roof" pass). Builds on
// v4-final by surfacing each non-Pantry module's regulars + curated
// suggestions in the same browse hub.
//
// Naming note: page-as-route still lives at /pantry/browse/other so
// existing bookmarks + the dashboard tile keep working; the user-
// facing label is "Other Regulars" everywhere (sidebar, dashboard,
// page heading). Conceptually it's the peer of Staples for the four
// non-Pantry modules.
//
// Four sub-tabs:
//
//   🌿 Outdoor  → family staples (module='outdoor') · DIRECTORY_OUTDOOR
//                 suggestions · OUTDOOR_CATEGORIES chips
//   ⚡ Utility  → family utilities (each meter = one row) ·
//                 DIRECTORY_UTILITIES suggestions · UTILITY_REQUEST_CATEGORIES chips
//   🚗 Drivers  → family staples (module='drivers') · DIRECTORY_DRIVERS
//                 suggestions · DRIVERS_CATEGORIES chips · vehicles
//                 registry link at top
//   🤝 Payroll  → category-only preview (request-driven, no list) ·
//                 PAYROLL_CATEGORIES chips
//
// Each tab has three layers:
//   1) Your regulars (live, editable, deletable)
//   2) Suggestions (curated DIRECTORY_* rows; tap to add)
//   3) Add custom (always-on, opens the inline editor)

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  OUTDOOR_CATEGORIES, UTILITY_REQUEST_CATEGORIES, PAYROLL_CATEGORIES,
  DRIVERS_CATEGORIES, HOME_CATEGORIES, MODULE_EMOJI, MODULE_LABEL,
  type PurchaseModule,
} from '@/lib/purchase';
import {
  DIRECTORY_OUTDOOR, DIRECTORY_DRIVERS, DIRECTORY_UTILITIES, DIRECTORY_HOME,
  type OutdoorCategoryId, type DriversCategoryId, type UtilitiesCategoryId,
} from '@/lib/pantryDirectory';
import {
  type Staple, type Cadence,
  addStaple, updateStaple, deleteStaple,
  addUtility, deleteUtility, CADENCE_LABEL,
} from '@/lib/pantry';
import {
  type Vehicle, subscribeToVehicles,
} from '@/lib/vehicles';
import { formatCents } from '@/components/pantry/format';
import { useHelperGrants, helperGrantsAllow } from '@/lib/useHelperGrants';

type OtherModule = Exclude<PurchaseModule, 'pantry'>;
const ALL_TABS: OtherModule[] = ['outdoor', 'utility', 'drivers', 'payroll', 'home', 'subscriptions', 'contributions'];

export default function OtherCataloguePage() {
  const { staples, utilities } = usePantry();
  const { config } = useHive();
  const { profile, isGuest } = useAuth();
  const confirmAction = useConfirm();
  const currency = config.currency;
  // 2026-05-19 — gate tabs by helper grants so a helper without (e.g.)
  // 'household:drivers' doesn't see the Drivers tab here either. Parents
  // and legacy helpers see all four; loading state hides until resolved.
  const grants = useHelperGrants();
  const TABS = ALL_TABS.filter((m) => helperGrantsAllow(grants, `household:${m}`));
  const [tab, setTab] = useState<OtherModule>('outdoor');
  const [cat, setCat] = useState<string | 'all'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Staple | 'new' | null>(null);
  const query = q.trim().toLowerCase();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToVehicles(profile.familyId, setVehicles);
  }, [profile?.familyId]);

  // If the current tab is no longer allowed (helper without grant or
  // grants resolved to a smaller set), snap to the first allowed tab.
  useEffect(() => {
    if (TABS.length === 0) return;
    if (!TABS.includes(tab)) setTab(TABS[0]);
  }, [TABS, tab]);

  const switchTab = (t: OtherModule) => { setTab(t); setCat('all'); setEditing(null); };

  // ── Tab-aware chips + category set ─────────────────────────────
  // Subscriptions + Contributions don't use category chips here — their
  // own catalogues live under /household/* with richer pickers (see the
  // redirect card rendered below). Return an empty set to skip the chip row.
  const chips = useMemo(() => {
    if (tab === 'outdoor') return OUTDOOR_CATEGORIES;
    if (tab === 'drivers') return DRIVERS_CATEGORIES;
    if (tab === 'utility') return UTILITY_REQUEST_CATEGORIES;
    if (tab === 'home') return HOME_CATEGORIES;
    if (tab === 'subscriptions' || tab === 'contributions') return [];
    return PAYROLL_CATEGORIES;
  }, [tab]);

  // ── Family items (per active tab) ──────────────────────────────
  const familyStaples = useMemo(() => {
    if (tab !== 'outdoor' && tab !== 'drivers' && tab !== 'home') return [];
    return staples
      .filter((s) => (s.module ?? 'pantry') === tab && s.active !== false)
      .filter((s) => cat === 'all' || s.category === cat)
      .filter((s) => !query
        || s.name.toLowerCase().includes(query)
        || (s.name2 ?? '').toLowerCase().includes(query));
  }, [staples, tab, cat, query]);

  const familyUtilities = useMemo(() => {
    if (tab !== 'utility') return [];
    return utilities
      .filter((u) => u.category !== 'salary' && u.active)
      .filter((u) => cat === 'all' || u.category === cat)
      .filter((u) => !query || u.name.toLowerCase().includes(query));
  }, [utilities, tab, cat, query]);

  // ── Curated suggestions (per active tab) ───────────────────────
  // Hide suggestions the family has already added (loose name match)
  // so the list stays useful as a discovery surface.
  const suggestions = useMemo(() => {
    const familyNames = new Set(
      [
        ...staples.filter((s) => (s.module ?? 'pantry') === tab).map((s) => s.name.toLowerCase()),
        ...utilities.map((u) => u.name.toLowerCase()),
      ].filter(Boolean),
    );
    const filter = <T extends { label: string; category: string; match: string[] }>(arr: T[]) =>
      arr
        .filter((r) => cat === 'all' || r.category === cat)
        .filter((r) => !familyNames.has(r.label.toLowerCase()))
        .filter((r) => !query
          || r.label.toLowerCase().includes(query)
          || r.match.some((m) => m.includes(query)));
    if (tab === 'outdoor') return filter(DIRECTORY_OUTDOOR);
    if (tab === 'drivers') return filter(DIRECTORY_DRIVERS);
    if (tab === 'utility') return filter(DIRECTORY_UTILITIES);
    if (tab === 'home') return filter(DIRECTORY_HOME);
    return [];
  }, [tab, cat, query, staples, utilities]);

  // ── Chip counts: family + curated combined ─────────────────────
  const chipCounts = useMemo(() => {
    const out = new Map<string, number>();
    out.set('all', 0);
    for (const c of chips) out.set(c.id, 0);
    const sourceCats: string[] = [];
    if (tab === 'outdoor') {
      sourceCats.push(
        ...staples.filter((s) => (s.module ?? 'pantry') === 'outdoor' && s.active !== false).map((s) => s.category),
        ...DIRECTORY_OUTDOOR.map((s) => s.category),
      );
    } else if (tab === 'drivers') {
      sourceCats.push(
        ...staples.filter((s) => (s.module ?? 'pantry') === 'drivers' && s.active !== false).map((s) => s.category),
        ...DIRECTORY_DRIVERS.map((s) => s.category),
      );
    } else if (tab === 'utility') {
      sourceCats.push(
        ...utilities.filter((u) => u.category !== 'salary' && u.active).map((u) => u.category),
        ...DIRECTORY_UTILITIES.map((s) => s.category),
      );
    } else if (tab === 'home') {
      sourceCats.push(
        ...staples.filter((s) => (s.module ?? 'pantry') === 'home' && s.active !== false).map((s) => s.category),
        ...DIRECTORY_HOME.map((s) => s.category),
      );
    } else {
      sourceCats.push(...PAYROLL_CATEGORIES.map((c) => c.id));
    }
    for (const c of sourceCats) {
      out.set('all', (out.get('all') ?? 0) + 1);
      out.set(c, (out.get(c) ?? 0) + 1);
    }
    return out;
  }, [tab, staples, utilities, chips]);

  // ── Actions ────────────────────────────────────────────────────
  const addCuratedAsFamily = async (
    label: string,
    category: string,
    qty: number,
    unit: string,
    cadence: Cadence,
  ) => {
    if (!profile?.familyId || isGuest) return;
    if (tab === 'outdoor' || tab === 'drivers' || tab === 'home') {
      try {
        await addStaple(profile.familyId, {
          name: label,
          // Re-use the curated category — already typed correctly per tab.
          category: category as Staple['category'],
          defaultQty: qty,
          unit,
          cadence,
          module: tab,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[other-catalogue] addStaple failed:', e);
      }
    } else if (tab === 'utility') {
      try {
        // Map UtilityRequestCategory → UtilityCategory. Most map 1:1;
        // electricity → power is the one rename.
        const map: Record<string, 'power'|'water'|'internet'|'tv'|'security'|'gas'|'rent'|'other'> = {
          electricity: 'power', water: 'water', internet: 'internet',
          gas: 'gas', tv: 'tv', security: 'security', rent: 'rent', other: 'other',
        };
        const utilCat = map[category] ?? 'other';
        await addUtility(profile.familyId, {
          name: label,
          category: utilCat,
          amountCents: 0,
          cadence,
          dueDay: 0,
          accountRef: '',
          preferredSupplierId: '',
          notes: '',
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[other-catalogue] addUtility failed:', e);
      }
    }
  };

  const deleteFamilyStaple = async (s: Staple) => {
    if (!profile?.familyId) return;
    const ok = await confirmAction({
      title: `Remove "${s.name}"?`,
      message: 'This removes it from your regulars list. The catalogue suggestion stays available.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteStaple(profile.familyId, s.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[other-catalogue] deleteStaple failed:', e);
    }
  };

  const deleteFamilyUtility = async (uid: string, name: string) => {
    if (!profile?.familyId) return;
    const ok = await confirmAction({
      title: `Remove "${name}"?`,
      message: 'This removes it from your bills list. The catalogue suggestion stays available.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteUtility(profile.familyId, uid);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[other-catalogue] deleteUtility failed:', e);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">
          Household · Catalogues &amp; plans
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          Other Regulars
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          The peer of <Link href="/pantry/staples" className="text-pantry-leaf-dk underline">Staples</Link> for everything outside the kitchen — Outdoor, Drivers, Utility, Payroll. Edit, add, or tap a suggestion.
        </p>
      </div>

      <div className="sticky top-0 bg-hive-cream z-10 pt-2 pb-3 -mx-4 px-4 lg:-mx-8 lg:px-8">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-hive-muted text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this module…"
            className="w-full bg-hive-paper border border-hive-line rounded-hive pl-10 pr-9 py-2.5 text-sm font-nunito font-bold placeholder:text-hive-muted placeholder:font-normal focus:outline-none focus:border-hive-honey"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-hive-line text-hive-muted text-sm font-black"
              aria-label="Clear search"
            >×</button>
          )}
        </div>

        {/* Module sub-tabs */}
        <div className="flex gap-1 mt-3 border-b border-hive-line overflow-x-auto">
          {TABS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTab(m)}
              className={`flex-shrink-0 px-3 py-2.5 -mb-px font-nunito font-extrabold text-sm border-b-[3px] whitespace-nowrap ${
                tab === m
                  ? 'text-hive-honey-dk border-hive-honey'
                  : 'text-hive-muted border-transparent'
              }`}
            >
              {MODULE_EMOJI[m]} {MODULE_LABEL[m]}
            </button>
          ))}
        </div>

        {/* Module-specific chips */}
        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setCat('all')}
            className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap ${
              cat === 'all'
                ? 'bg-hive-honey text-white border-hive-honey-dk'
                : 'bg-hive-paper border-hive-line text-hive-muted'
            }`}
          >
            All <span className="opacity-70">· {chipCounts.get('all') ?? 0}</span>
          </button>
          {chips.map((c) => {
            const n = chipCounts.get(c.id) ?? 0;
            const active = cat === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCat(active ? 'all' : c.id)}
                disabled={n === 0}
                className={`flex-shrink-0 text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border whitespace-nowrap disabled:opacity-40 ${
                  active
                    ? 'bg-hive-honey text-white border-hive-honey-dk'
                    : 'bg-hive-paper border-hive-line text-hive-muted'
                }`}
              >
                {c.emoji} {c.label} <span className="opacity-70">· {n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Subscriptions: redirect to the dedicated catalogue ────── */}
      {tab === 'subscriptions' && (
        <div className="mt-3 bg-hive-paper border border-hive-line rounded-hive p-5 text-center">
          <div className="text-3xl mb-1">🔁</div>
          <h3 className="font-nunito font-black text-base text-hive-navy">
            Subscriptions live in their own catalogue
          </h3>
          <p className="text-hive-muted text-sm mt-1 mb-3">
            Apps, memberships, streaming, property dues — managed under <strong>Household → Subscriptions</strong>, with Auto/Manual toggle, catalogue search, and FX-locked entry.
          </p>
          <Link
            href="/household/subscriptions"
            className="inline-flex items-center gap-1.5 bg-pulse-navy text-pulse-cream rounded-hive px-4 py-2 font-nunito font-black text-sm no-underline"
          >
            Open Subscriptions →
          </Link>
        </div>
      )}

      {/* ── Contributions: redirect to the dedicated catalogue ────── */}
      {tab === 'contributions' && (
        <div className="mt-3 bg-hive-paper border border-hive-line rounded-hive p-5 text-center">
          <div className="text-3xl mb-1">🤲</div>
          <h3 className="font-nunito font-black text-base text-hive-navy">
            Contributions live in their own catalogue
          </h3>
          <p className="text-hive-muted text-sm mt-1 mb-3">
            Tithes, msiba, charity, family support — managed under <strong>Household → Contributions</strong>. Parents-only by default, with the tithe% shortcut and occasion grouping.
          </p>
          <Link
            href="/household/contributions"
            className="inline-flex items-center gap-1.5 bg-pulse-navy text-pulse-cream rounded-hive px-4 py-2 font-nunito font-black text-sm no-underline"
          >
            Open Contributions →
          </Link>
        </div>
      )}

      {/* ── Drivers: vehicles registry banner ─────────────────────── */}
      {tab === 'drivers' && (
        <Link
          href="/pantry/drivers/vehicles"
          className="mt-3 bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3 no-underline"
        >
          <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">🚗</div>
          <div className="flex-1 min-w-0">
            <div className="font-nunito font-extrabold text-sm text-hive-navy">Your vehicles</div>
            <div className="text-[11px] text-hive-muted font-bold mt-0.5">
              {vehicles.length === 0
                ? 'Register cars so requests can pin to one.'
                : `${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'} · tap to manage`}
            </div>
          </div>
          <div className="text-hive-honey-dk font-nunito font-black text-sm flex-shrink-0">›</div>
        </Link>
      )}

      {/* ── Payroll: read-only category preview ────────────────────── */}
      {tab === 'payroll' && (
        <div className="mt-3 flex flex-col gap-2">
          {PAYROLL_CATEGORIES
            .filter((c) => cat === 'all' || c.id === cat)
            .filter((c) => !query || c.label.toLowerCase().includes(query))
            .map((c) => (
              <div key={c.id} className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-lg flex-shrink-0">{c.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-extrabold text-sm text-hive-navy">{c.label}</div>
                  <div className="text-[11px] text-hive-muted font-bold mt-0.5">Pay-related request type</div>
                </div>
              </div>
            ))}
          <div className="bg-pantry-leaf-soft border border-pantry-leaf/30 rounded-hive p-3 text-xs text-pantry-leaf-dk font-nunito">
            <span className="font-extrabold">Helper-locked flow.</span> Payroll requests are created by the helper themselves, then approved by the parent. To set up auto-payroll, see <Link href="/pantry/payroll" className="underline">Payroll</Link>.
          </div>
        </div>
      )}

      {/* ── Your regulars (Outdoor / Drivers) ─────────────────────── */}
      {(tab === 'outdoor' || tab === 'drivers') && (
        <Section
          title={`Your regulars · ${MODULE_LABEL[tab]}`}
          subtitle={familyStaples.length === 0 ? 'Nothing here yet — add one below or tap a suggestion.' : `${familyStaples.length} ${familyStaples.length === 1 ? 'item' : 'items'} in your list.`}
          icon={MODULE_EMOJI[tab]}
        >
          {familyStaples.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {familyStaples.map((s) => (
                <FamilyStapleRow
                  key={s.id}
                  staple={s}
                  currency={currency}
                  onEdit={() => setEditing(s)}
                  onDelete={() => deleteFamilyStaple(s)}
                />
              ))}
            </div>
          )}
          {!isGuest && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="mt-2 w-full bg-pantry-leaf-soft border border-pantry-leaf/30 rounded-hive py-2.5 text-pantry-leaf-dk font-nunito font-black text-sm"
            >
              ＋ Add a custom {MODULE_LABEL[tab].toLowerCase().replace(/s$/, '')} regular
            </button>
          )}
        </Section>
      )}

      {/* ── Your utilities (each meter as own row) ────────────────── */}
      {tab === 'utility' && (
        <Section
          title="Your bills · meters"
          subtitle={familyUtilities.length === 0
            ? 'No bills yet — tap a suggestion below or add custom in /pantry/utilities.'
            : `${familyUtilities.length} ${familyUtilities.length === 1 ? 'meter / bill' : 'meters / bills'} · tap to edit on the Utilities page.`}
          icon="⚡"
        >
          {familyUtilities.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              {familyUtilities.map((u) => (
                <FamilyUtilityRow
                  key={u.id}
                  name={u.name}
                  category={u.category}
                  cadence={u.cadence}
                  amountCents={u.amountCents}
                  currency={currency}
                  onDelete={() => deleteFamilyUtility(u.id, u.name)}
                />
              ))}
            </div>
          )}
          <Link
            href="/pantry/utilities"
            className="mt-2 w-full block text-center bg-pantry-leaf-soft border border-pantry-leaf/30 rounded-hive py-2.5 text-pantry-leaf-dk font-nunito font-black text-sm no-underline"
          >
            ＋ Add / edit utilities (with amount + due day)
          </Link>
        </Section>
      )}

      {/* ── Suggestions (curated catalogue) ────────────────────────── */}
      {(tab === 'outdoor' || tab === 'drivers' || tab === 'utility') && suggestions.length > 0 && (
        <Section
          title={`Suggestions · ${MODULE_LABEL[tab]}`}
          subtitle="Tap any to add it to your regulars. Editable after."
          icon="✨"
        >
          <div className="flex flex-col gap-2 mt-2">
            {suggestions.map((r) => (
              <SuggestionRow
                key={`${r.category}:${r.label}`}
                emoji={r.emoji}
                label={r.label}
                meta={`${r.defaultQty} ${r.unit} · ${r.cadence}${r.note ? ` · ${r.note}` : ''}`}
                disabled={isGuest}
                onAdd={() => addCuratedAsFamily(r.label, r.category, r.defaultQty, r.unit, r.cadence)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Outdoor/Drivers empty-after-filter hint */}
      {(tab === 'outdoor' || tab === 'drivers') && familyStaples.length === 0 && suggestions.length === 0 && (q || cat !== 'all') && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-3">
          <div className="text-3xl mb-2">{MODULE_EMOJI[tab]}</div>
          <h3 className="font-nunito font-black text-lg">Nothing matches</h3>
          <p className="text-hive-muted text-sm mt-1">
            <button onClick={() => { setQ(''); setCat('all'); }} className="text-pantry-leaf-dk font-bold underline">Clear filters</button>
          </p>
        </div>
      )}

      {/* ── Inline editor modal (Outdoor + Drivers only) ──────────── */}
      {editing && (tab === 'outdoor' || tab === 'drivers') && profile?.familyId && (
        <RegularEditor
          module={tab}
          familyId={profile.familyId}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────

function Section({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] mb-1 flex items-center gap-2 text-hive-honey-dk">
        {icon && <span className="text-base">{icon}</span>}
        <span>{title}</span>
      </div>
      {subtitle && <div className="text-[11px] text-hive-muted font-bold">{subtitle}</div>}
      {children}
    </div>
  );
}

function FamilyStapleRow({
  staple, currency, onEdit, onDelete,
}: {
  staple: Staple;
  currency: string;
  onEdit: () => void;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3 text-left hover:border-hive-honey"
      >
        <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">
          📌
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{staple.name}</div>
          {staple.name2 && (
            <div className="text-[11px] text-hive-muted font-bold truncate">{staple.name2}</div>
          )}
          <div className="text-[11px] text-hive-muted font-bold mt-0.5">
            {staple.defaultQty} {staple.unit} · {CADENCE_LABEL[staple.cadence]}
            {staple.dueDay && staple.dueDay > 0 ? ` · due ${ordinalDay(staple.dueDay)}` : ''}
            {' · '}{staple.category}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {staple.defaultPriceCents && staple.defaultPriceCents > 0 ? (
            <div className="font-nunito font-black text-sm text-hive-navy">
              {formatCents(staple.defaultPriceCents, currency)}
            </div>
          ) : null}
          {staple.dueDay && staple.dueDay > 0 ? (
            <div className="text-[9px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-honey-dk">🔔 fixed</div>
          ) : null}
          <div className="text-hive-muted font-nunito font-black text-sm">✎</div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onDelete(); }}
        className="flex-shrink-0 bg-hive-paper border border-hive-line rounded-hive px-3 text-hive-rose font-nunito font-black hover:bg-hive-rose/10 hover:border-hive-rose"
        aria-label={`Remove ${staple.name}`}
        title="Remove from regulars"
      >
        ×
      </button>
    </div>
  );
}

function FamilyUtilityRow({
  name, category, cadence, amountCents, currency, onDelete,
}: {
  name: string;
  category: string;
  cadence: Cadence;
  amountCents: number;
  currency: string;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-stretch gap-1.5">
      <Link
        href="/pantry/utilities"
        className="flex-1 bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3 no-underline hover:border-hive-honey"
      >
        <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base flex-shrink-0">⚡</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{name}</div>
          <div className="text-[11px] text-hive-muted font-bold mt-0.5">{cadence} · {category}</div>
        </div>
        <div className="text-right flex-shrink-0">
          {amountCents > 0 && (
            <div className="font-nunito font-black text-sm text-hive-navy">{formatCents(amountCents, currency)}</div>
          )}
          <div className="text-hive-muted font-nunito font-black text-xs">✎</div>
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onDelete(); }}
        className="flex-shrink-0 bg-hive-paper border border-hive-line rounded-hive px-3 text-hive-rose font-nunito font-black hover:bg-hive-rose/10 hover:border-hive-rose"
        aria-label={`Remove ${name}`}
        title="Remove from bills"
      >
        ×
      </button>
    </div>
  );
}

function SuggestionRow({
  emoji, label, meta, disabled, onAdd,
}: {
  emoji: string;
  label: string;
  meta: string;
  disabled?: boolean;
  onAdd: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-lg flex-shrink-0">{emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{label}</div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5 truncate">{meta}</div>
      </div>
      <button
        type="button"
        disabled={disabled || adding}
        onClick={async () => {
          if (disabled) return;
          setAdding(true);
          try { await onAdd(); }
          finally { setAdding(false); }
        }}
        className="flex-shrink-0 bg-pantry-leaf-soft border border-pantry-leaf/30 rounded-full px-3 py-1.5 text-pantry-leaf-dk font-nunito font-black text-[11px] hover:bg-pantry-leaf/15 disabled:opacity-50"
      >
        {adding ? '…' : '＋ Add'}
      </button>
    </div>
  );
}

// ── Compact inline editor (Outdoor + Drivers regulars) ────────────
// Skips supplier / brands / price (those live in the full StapleForm
// on /pantry/staples). Focus: the fields a parent actually edits when
// "putting items under one roof" — name, bilingual name2, category,
// qty + unit, cadence. The editor reuses the curated categories so the
// chips on the catalogue page stay consistent.

function RegularEditor({
  module, familyId, existing, onClose,
}: {
  module: 'outdoor' | 'drivers';
  familyId: string;
  existing?: Staple;
  onClose: () => void;
}) {
  const { config } = useHive();
  const currency = config.currency;
  const cats = module === 'outdoor' ? OUTDOOR_CATEGORIES : DRIVERS_CATEGORIES;
  const [name, setName] = useState(existing?.name ?? '');
  const [name2, setName2] = useState(existing?.name2 ?? '');
  const [category, setCategory] = useState<string>(existing?.category ?? cats[0].id);
  const [qty, setQty] = useState<number>(existing?.defaultQty ?? 1);
  const [unit, setUnit] = useState(existing?.unit ?? 'x');
  const [cadence, setCadence] = useState<Cadence>(existing?.cadence ?? 'monthly');
  // Price + due-date capture (2026-05-20). Price pre-fills the request
  // estimate; a due day marks the regular as a fixed commitment so the
  // reminder reaches BOTH parent + helper (vs cadence-only = helper).
  const [priceMajor, setPriceMajor] = useState<number>(
    existing?.defaultPriceCents ? existing.defaultPriceCents / 100 : 0,
  );
  const [dueDay, setDueDay] = useState<number>(existing?.dueDay ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A due day only makes sense for time-bound cadences (not as-needed).
  const dueEligible = cadence !== 'as-needed';
  const isFixedDate = dueEligible && dueDay > 0;

  const submit = async () => {
    setError('');
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required.'); return; }
    if (qty <= 0) { setError('Qty must be greater than zero.'); return; }
    setSaving(true);
    try {
      const payload: Partial<Staple> = {
        name: trimmed,
        name2: name2.trim() || undefined,
        category: category as Staple['category'],
        defaultQty: qty,
        unit: unit.trim() || 'x',
        cadence,
        module,
        defaultPriceCents: priceMajor > 0 ? Math.round(priceMajor * 100) : 0,
        dueDay: dueEligible && dueDay > 0 ? Math.min(31, Math.round(dueDay)) : 0,
      };
      if (existing) {
        await updateStaple(familyId, existing.id, payload);
      } else {
        await addStaple(familyId, {
          ...payload as Omit<Staple, 'id' | 'createdAt' | 'active'>,
          active: true,
        });
      }
      onClose();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[other-catalogue] save staple failed:', e);
      setError('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-hive-navy/40 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-hive-cream rounded-t-[28px] lg:rounded-hive p-5 pb-8 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-nunito font-black text-lg">
            {existing ? 'Edit regular' : `Add ${MODULE_LABEL[module].toLowerCase().replace(/s$/, '')} regular`}
          </h2>
          <button onClick={onClose} className="text-hive-muted text-xl font-black" aria-label="Close">×</button>
        </div>

        <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={module === 'outdoor' ? 'e.g. Layers mash' : 'e.g. Engine oil'}
          className="w-full bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 text-sm font-nunito font-bold mb-3 focus:outline-none focus:border-hive-honey"
        />

        <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">
          Local-language name <span className="text-hive-muted/70 normal-case">(optional)</span>
        </label>
        <input
          value={name2}
          onChange={(e) => setName2(e.target.value)}
          placeholder={module === 'outdoor' ? 'e.g. Chakula kuku' : 'e.g. Mafuta engine'}
          className="w-full bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 text-sm font-nunito font-bold mb-3 focus:outline-none focus:border-hive-honey"
        />

        <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">Category</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
                category === c.id
                  ? 'bg-hive-honey text-white border-hive-honey-dk'
                  : 'bg-hive-paper border-hive-line text-hive-muted'
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">Default qty</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 text-sm font-nunito font-bold focus:outline-none focus:border-hive-honey"
            />
          </div>
          <div>
            <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">Unit</label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="bag, L, x"
              className="w-full bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 text-sm font-nunito font-bold focus:outline-none focus:border-hive-honey"
            />
          </div>
        </div>

        {/* Price (per unit) — pre-fills the request estimate. */}
        <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">
          Price per {unit.trim() || 'unit'} <span className="text-hive-muted/70 normal-case">(optional)</span>
        </label>
        <div className="flex items-center gap-1 bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 mb-3 focus-within:border-hive-honey">
          <span className="text-xs text-hive-muted font-bold">{currency}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={priceMajor || ''}
            onChange={(e) => setPriceMajor(Number(e.target.value))}
            placeholder="0.00"
            className="flex-1 bg-transparent text-sm font-nunito font-bold focus:outline-none"
          />
        </div>

        <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">Cadence</label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(['daily','weekly','biweekly','semimonthly','monthly','quarterly','yearly','as-needed'] as Cadence[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              className={`text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
                cadence === c
                  ? 'bg-hive-honey text-white border-hive-honey-dk'
                  : 'bg-hive-paper border-hive-line text-hive-muted'
              }`}
            >
              {CADENCE_LABEL[c]}
            </button>
          ))}
        </div>

        {/* Due day — marks a fixed-date commitment. Hidden for as-needed. */}
        {dueEligible && (
          <>
            <label className="block text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-1">
              Due day of month <span className="text-hive-muted/70 normal-case">(optional — for fixed dates)</span>
            </label>
            <input
              type="number"
              min="0"
              max="31"
              value={dueDay || ''}
              onChange={(e) => setDueDay(Number(e.target.value))}
              placeholder="e.g. 5"
              className="w-full bg-hive-paper border border-hive-line rounded-hive px-3 py-2.5 text-sm font-nunito font-bold mb-2 focus:outline-none focus:border-hive-honey"
            />
          </>
        )}

        {/* Reminder explainer — tells the parent who gets reminded. */}
        <div className="rounded-hive border border-hive-line bg-hive-paper p-3 mb-4">
          <p className="text-[11px] font-nunito font-extrabold text-hive-ink">🔔 Reminders</p>
          <p className="text-[11px] text-hive-muted mt-0.5 leading-snug">
            {isFixedDate ? (
              <>Fixed on the <strong>{ordinalDay(dueDay)}</strong> — Kaya will remind <strong>both the parent &amp; helper</strong> when it's due.</>
            ) : cadence === 'as-needed' ? (
              <>Bought as needed — no schedule reminder. The helper requests it when they run low.</>
            ) : (
              <>Recurs <strong>{CADENCE_LABEL[cadence].toLowerCase()}</strong> — Kaya nudges the <strong>helper</strong> when it's due for a top-up.</>
            )}
          </p>
        </div>

        {error && <p className="text-xs text-hive-rose font-bold mb-2">{error}</p>}

        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="w-full bg-pantry-leaf text-white rounded-hive py-3 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30 disabled:opacity-60"
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Add to regulars'}
        </button>
      </div>
    </div>
  );
}

/** 5 → "5th", 1 → "1st" — for the reminder explainer. */
function ordinalDay(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Suppress unused-import warnings — these types are used by the
// useMemo predicates above via TS narrowing. Keeping the explicit
// imports up top keeps grepping for "OutdoorCategoryId" / similar
// landing on this file as a place those types are concretely used.
type _UnusedTypeKeepImports =
  | OutdoorCategoryId
  | DriversCategoryId
  | UtilitiesCategoryId;
const _t: _UnusedTypeKeepImports | undefined = undefined;
void _t;
