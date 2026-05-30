'use client';

// /admin/families — operator-only family-admin console.
//
// Lists every family with their current plan, addons, founding-family
// flag, and member breakdown. Click "Edit plan" to change tier, toggle
// addons, or flip the founding flag — writes via /api/admin/families/[id].

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { DEFAULT_ADDONS, DEFAULT_TIERS, type SubscriptionTierId } from '@/lib/tiers';
import { capCopy, formatBytes, tierCapBytes, usagePercent, usageState } from '@/lib/storage';
import type { AdminFamilyRow } from '@/app/api/admin/families/route';
import { toDisplayDate } from '@/lib/dates';

const DAY_MS = 86_400_000;

// Whole days since an epoch-ms instant (local time); null if never active.
function daysSince(ms: number, now: number): number | null {
  if (!ms) return null;
  return Math.floor((now - ms) / DAY_MS);
}

// epoch-ms → "YYYY-MM-DD" in LOCAL time, for toDisplayDate().
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type ActiveFilter = 'all' | 'active' | 'dormant';

export default function AdminFamiliesPage() {
  const [families, setFamilies] = useState<AdminFamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(7);
  const [savedWindowDays, setSavedWindowDays] = useState(7);
  const [savingWindow, setSavingWindow] = useState(false);
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const [now] = useState(() => Date.now());

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/admin/families', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`load-failed-${res.status}`);
      const { families: rows } = (await res.json()) as { families: AdminFamilyRow[] };
      setFamilies(rows);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // Load the operator's dormancy window (default 7) once.
  useEffect(() => {
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) return;
        const token = await u.getIdToken();
        const res = await fetch('/api/admin/settings', { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const { settings } = (await res.json()) as { settings: { activeWindowDays: number } };
        setWindowDays(settings.activeWindowDays);
        setSavedWindowDays(settings.activeWindowDays);
      } catch { /* keep default window */ }
    })();
  }, []);

  const saveWindowDays = async () => {
    const v = Math.min(365, Math.max(1, Math.round(windowDays || 7)));
    setWindowDays(v);
    if (v === savedWindowDays) return;
    setSavingWindow(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ activeWindowDays: v }),
      });
      if (!res.ok) throw new Error(`save-failed-${res.status}`);
      const { settings } = (await res.json()) as { settings: { activeWindowDays: number } };
      setWindowDays(settings.activeWindowDays);
      setSavedWindowDays(settings.activeWindowDays);
    } catch (e) {
      alert(`Couldn't save window: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setSavingWindow(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      (f.handle ?? '').toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q),
    );
  }, [families, query]);

  // Split the search results into active/dormant by the operator's window,
  // then order: recency for all/active, longest-dormant-first for dormant.
  const { shown, activeCount, dormantCount } = useMemo(() => {
    const withD = filtered.map((f) => {
      const d = daysSince(f.lastActiveAtMs, now);
      return { f, d, dormant: d === null || d > windowDays };
    });
    const active = withD.filter((x) => !x.dormant).length;
    const list = withD.filter((x) =>
      filter === 'all' ? true : filter === 'active' ? !x.dormant : x.dormant,
    );
    list.sort((a, b) => {
      if (filter === 'dormant') {
        if (a.d === null && b.d === null) return 0;
        if (a.d === null) return -1;
        if (b.d === null) return 1;
        return b.d - a.d;
      }
      if (a.d === null && b.d === null) return 0;
      if (a.d === null) return 1;
      if (b.d === null) return -1;
      return a.d - b.d;
    });
    return { shown: list.map((x) => x.f), activeCount: active, dormantCount: withD.length - active };
  }, [filtered, now, windowDays, filter]);

  const editing = editingId ? families.find((f) => f.id === editingId) ?? null : null;

  const recountStorage = async (id: string) => {
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch(`/api/admin/families/${id}/recount-storage`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'unknown' }));
        throw new Error(error || 'recount-failed');
      }
      await reload();
    } catch (e) {
      alert(`Recount failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  };

  const saveFamily = async (id: string, patch: { tierId?: SubscriptionTierId; addons?: string[]; isFoundingFamily?: boolean; extraStorageGB?: number }) => {
    setSavingId(id);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error('not-signed-in');
      const token = await u.getIdToken();
      const res = await fetch(`/api/admin/families/${id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'unknown' }));
        throw new Error(error || 'save-failed');
      }
      await reload();
      setEditingId(null);
    } catch (e) {
      alert(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(160deg,#0F1F44 0%,#162954 100%)' }}>
      <div className="max-w-[1100px] mx-auto px-5 py-10">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-9 h-9 rounded-xl grid place-items-center"
              style={{ background: 'rgba(212,168,71,0.18)', border: '1px solid rgba(212,168,71,0.3)' }}
            >
              <span className="text-base">🏠</span>
            </div>
            <h1 className="font-display font-black text-2xl text-white tracking-tight m-0">Families</h1>
          </div>
          <p className="text-white/55 text-[13px] font-semibold ml-12">
            Every family in the project · tap a row to change plan, toggle add-ons, or mark a founding family.
          </p>
        </header>

        {/* Search bar */}
        <div
          className="rounded-2xl p-3 mb-4"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by family name, handle, or ID…"
            className="w-full bg-transparent text-white text-[14px] font-semibold placeholder-white/40 outline-none px-2"
          />
        </div>

        {loading && (
          <div className="text-white/55 text-sm py-12 text-center">Loading families…</div>
        )}
        {err && (
          <div className="text-[#FF7676] text-sm py-12 text-center bg-white/5 rounded-2xl">
            Couldn&apos;t load: <code>{err}</code>
          </div>
        )}

        {!loading && !err && (
          <>
            {/* Engagement toolbar — filter + dormancy window */}
            <div
              className="rounded-2xl p-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-1.5">
                {(['all', 'active', 'dormant'] as ActiveFilter[]).map((key) => {
                  const on = filter === key;
                  const label = key === 'all' ? 'All' : key === 'active' ? `Active ≤${windowDays}d` : `Dormant >${windowDays}d`;
                  const count = key === 'all' ? activeCount + dormantCount : key === 'active' ? activeCount : dormantCount;
                  return (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className="text-[12px] font-black px-3 py-1.5 rounded-full transition-colors"
                      style={
                        on
                          ? { background: '#D4A847', color: '#0F1F44' }
                          : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)' }
                      }
                    >
                      {label} <span className="opacity-70">· {count}</span>
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-[12px] font-bold text-white/55">
                <span>Dormant after</span>
                <input
                  value={String(windowDays)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '');
                    setWindowDays(v === '' ? 0 : Math.min(365, parseInt(v, 10)));
                  }}
                  onBlur={saveWindowDays}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  inputMode="numeric"
                  aria-label="Dormancy window in days"
                  className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-[13px] font-extrabold text-center outline-none"
                />
                <span>days{savingWindow ? ' · saving…' : ''}</span>
              </label>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-white/45 font-bold uppercase tracking-wider px-3 mb-1">
                {shown.length} {shown.length === 1 ? 'family' : 'families'}{filter !== 'all' ? ` · ${filter}` : ''}
              </div>
              {shown.map((f) => (
                <FamilyRow key={f.id} family={f} now={now} windowDays={windowDays} onEdit={() => setEditingId(f.id)} />
              ))}
              {shown.length === 0 && (
                <div className="text-white/45 text-sm py-12 text-center">
                  {filter === 'dormant'
                    ? 'No dormant families — all families are active 🎉'
                    : filter === 'active'
                      ? 'No active families in this window.'
                      : 'No families match that search.'}
                </div>
              )}
            </div>

            <div className="text-[10px] text-white/35 font-semibold mt-3 px-3 leading-snug">
              Last active comes from in-app presence — a family with no recent activity may simply not have opened Kaya since presence tracking shipped.
            </div>
          </>
        )}
      </div>

      {/* Edit drawer */}
      {editing && (
        <EditDrawer
          family={editing}
          saving={savingId === editing.id}
          onCancel={() => setEditingId(null)}
          onSave={(patch) => saveFamily(editing.id, patch)}
          onRecount={() => recountStorage(editing.id)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function LastActivePill({ ms, now, windowDays }: { ms: number; now: number; windowDays: number }) {
  const d = daysSince(ms, now);
  const dormant = d === null || d > windowDays;
  const dot = d === null ? '⚪' : dormant ? '🟡' : '🟢';
  const text = d === null ? 'never' : d === 0 ? 'today' : `${d}d`;
  const color = d === null ? 'rgba(255,255,255,0.45)' : dormant ? '#D4A847' : '#5BB85B';
  const title = d === null ? 'No recorded activity yet' : `Last active ${toDisplayDate(isoDay(ms))} (${d}d ago)`;
  return (
    <span
      title={title}
      className="flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color }}
    >
      <span>{dot}</span>
      <span>{text}</span>
    </span>
  );
}

function FamilyRow({ family, now, windowDays, onEdit }: { family: AdminFamilyRow; now: number; windowDays: number; onEdit: () => void }) {
  const tier = DEFAULT_TIERS[family.tierId];
  const m = family.members;
  return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center gap-4 transition-colors hover:bg-white/8"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="text-2xl flex-shrink-0">{tier.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-white font-black text-[14px] truncate">{family.name}</div>
          {family.handle && (
            <span className="text-[#D4A847] text-[12px] font-bold">@{family.handle}</span>
          )}
          {family.isFoundingFamily && (
            <span
              className="rounded-full text-[10px] font-black px-2 py-0.5"
              style={{ background: 'rgba(212,168,71,0.18)', color: '#D4A847' }}
            >
              🌟 Founding
            </span>
          )}
        </div>
        <div className="text-white/55 text-[12px] font-semibold mt-0.5 flex items-center gap-3 flex-wrap">
          <span>{tier.name}</span>
          <span>·</span>
          <span>{m.parents}P · {m.helpers}H · {m.kids}K{m.guests > 0 ? ` · ${m.guests}G` : ''}</span>
          {family.addons.length > 0 && (
            <>
              <span>·</span>
              <span className="text-[#D4A847]">+{family.addons.length} add-on{family.addons.length === 1 ? '' : 's'}</span>
            </>
          )}
          <span>·</span>
          <StorageInline family={family} />
        </div>
      </div>
      <LastActivePill ms={family.lastActiveAtMs} now={now} windowDays={windowDays} />
      <button
        type="button"
        onClick={onEdit}
        className="text-[12px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
        style={{ background: '#D4A847', color: '#0F1F44' }}
      >
        Edit plan
      </button>
    </div>
  );
}

// Compact "248 MB / 200 MB · 24%" inline next to the member counts, with
// founding-family / castle copy variants. State colour is the same as
// the family-side bar.
function StorageInline({ family }: { family: AdminFamilyRow }) {
  const tier = DEFAULT_TIERS[family.tierId];
  const capBytes = tierCapBytes(tier, family.storage.extraGB);
  const pct = usagePercent(family.storage.bytes, capBytes);
  const state = usageState(pct);
  const color = family.isFoundingFamily
    ? '#D4A847'
    : state === 'over' ? '#FF7676' : state === 'warning' ? '#D4A847' : 'rgba(255,255,255,0.55)';
  const right = family.isFoundingFamily
    ? '🌟 uncapped'
    : family.tierId === 'castle'
      ? 'Plenty of room'
      : `${formatBytes(family.storage.bytes)} / ${formatBytes(capBytes)}`;
  return <span style={{ color }}>{right}</span>;
}

function EditDrawer({
  family,
  saving,
  onCancel,
  onSave,
  onRecount,
}: {
  family: AdminFamilyRow;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: { tierId?: SubscriptionTierId; addons?: string[]; isFoundingFamily?: boolean; extraStorageGB?: number }) => void;
  onRecount: () => Promise<void>;
}) {
  const [tierId, setTierId] = useState<SubscriptionTierId>(family.tierId);
  const [addons, setAddons] = useState<Set<string>>(new Set(family.addons));
  const [founding, setFounding] = useState(family.isFoundingFamily);
  const [extraGB, setExtraGB] = useState(String(family.storage.extraGB ?? 0));
  const [recounting, setRecounting] = useState(false);

  const dirty =
    tierId !== family.tierId ||
    founding !== family.isFoundingFamily ||
    [...addons].sort().join(',') !== [...family.addons].sort().join(',') ||
    Number(extraGB || 0) !== (family.storage.extraGB ?? 0);

  // Castle includes every addon implicitly — surface that as a note.
  const isCastle = tierId === 'castle';

  return (
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center z-50 px-4 py-6"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[480px] rounded-3xl p-6 max-h-[85vh] overflow-y-auto"
        style={{ background: '#162954', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-white font-black text-lg">{family.name}</div>
            {family.handle && <div className="text-[#D4A847] text-[12px] font-bold">@{family.handle}</div>}
          </div>
          <button onClick={onCancel} className="text-white/55 text-xl leading-none" aria-label="Close">×</button>
        </div>

        {/* Tier picker */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Plan</div>
          <div className="flex flex-col gap-2">
            {(['nest', 'home', 'castle'] as SubscriptionTierId[]).map((id) => {
              const t = DEFAULT_TIERS[id];
              const selected = tierId === id;
              return (
                <button
                  key={id}
                  onClick={() => setTierId(id)}
                  className="text-left rounded-xl px-3 py-2.5 flex items-center gap-3 transition-colors"
                  style={{
                    background: selected ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
                    border: selected ? '1px solid rgba(212,168,71,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <span className="text-xl">{t.emoji}</span>
                  <span className="flex-1">
                    <span className="block text-white font-bold text-[13px]">{t.name}</span>
                    <span className="block text-white/55 text-[11px] font-semibold">{t.tagline}</span>
                  </span>
                  {selected && <span className="text-[#D4A847] text-sm">✓</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* Add-ons */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">
            Add-ons {isCastle && <span className="text-[#D4A847] normal-case ml-1 font-bold">— Castle includes everything</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_ADDONS.map((a) => {
              const on = addons.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    const next = new Set(addons);
                    if (on) next.delete(a.id); else next.add(a.id);
                    setAddons(next);
                  }}
                  disabled={isCastle}
                  className="text-left rounded-xl px-3 py-2 flex items-center gap-2 transition-colors disabled:opacity-50"
                  style={{
                    background: on ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
                    border: on ? '1px solid rgba(212,168,71,0.4)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <span className="text-base">{a.emoji}</span>
                  <span className="text-white font-bold text-[12px] truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Founding family */}
        <section className="mb-5">
          <button
            onClick={() => setFounding((v) => !v)}
            className="w-full text-left rounded-xl px-3 py-3 flex items-center gap-3"
            style={{
              background: founding ? 'rgba(212,168,71,0.18)' : 'rgba(255,255,255,0.04)',
              border: founding ? '1px solid rgba(212,168,71,0.4)' : '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="text-xl">🌟</span>
            <span className="flex-1">
              <span className="block text-white font-bold text-[13px]">Founding family</span>
              <span className="block text-white/55 text-[11px] font-semibold">Permanently bypass every tier gate (closed-beta grandfather).</span>
            </span>
            <span
              className="w-9 h-5 rounded-full relative flex-shrink-0"
              style={{ background: founding ? '#D4A847' : 'rgba(255,255,255,0.15)' }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                style={{ left: founding ? '18px' : '2px' }}
              />
            </span>
          </button>
        </section>

        {/* Storage */}
        <section className="mb-5">
          <div className="text-[11px] font-black text-white/55 uppercase tracking-wider mb-2">Storage</div>
          {(() => {
            const tier = DEFAULT_TIERS[tierId];
            const capBytes = tierCapBytes(tier, Number(extraGB || 0));
            const pct = usagePercent(family.storage.bytes, capBytes);
            const state = usageState(pct);
            const barColor = state === 'over' ? '#FF7676' : state === 'warning' ? '#D4A847' : '#5BB85B';
            return (
              <div
                className="rounded-xl p-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12px] font-bold text-white/80">
                    {formatBytes(family.storage.bytes)} / {capCopy(tierId, capBytes, founding)}
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: barColor }}>
                    {founding ? 'uncapped' : `${pct.toFixed(0)}%`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                </div>
                <div className="text-[10px] text-white/45 font-semibold mt-1.5">
                  {family.storage.recountedAtMs > 0
                    ? `Last recounted ${new Date(family.storage.recountedAtMs).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
                    : 'Never recounted — totals reflect tracked uploads only.'}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1">
                    <div className="text-[10px] font-black text-white/55 uppercase tracking-wider mb-1">Extra GB grant</div>
                    <input
                      value={extraGB}
                      onChange={(e) => setExtraGB(e.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[13px] font-extrabold outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => { setRecounting(true); try { await onRecount(); } finally { setRecounting(false); } }}
                    disabled={recounting}
                    className="self-end text-[11px] font-black px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'rgba(212,168,71,0.18)', color: '#D4A847', border: '1px solid rgba(212,168,71,0.35)' }}
                  >
                    {recounting ? 'Scanning…' : '⟳ Recount'}
                  </button>
                </div>
              </div>
            );
          })()}
        </section>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 text-[13px] font-bold py-2.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({
              tierId,
              addons: isCastle ? [] : [...addons],
              isFoundingFamily: founding,
              extraStorageGB: Number(extraGB || 0),
            })}
            disabled={!dirty || saving}
            className="flex-1 text-[13px] font-black py-2.5 rounded-xl disabled:opacity-50"
            style={{ background: '#D4A847', color: '#0F1F44' }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
