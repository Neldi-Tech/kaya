// Kaya Wealth · Asset Register (Phase 1 · 2026-06-01).
//
// The live, class-grouped register from the approved mockup — shown in both
// Shared and Personal modes, filtered to that view's assets. Owns the class
// legend (filter chips), the liquidity-grouped cards with subtotals, the
// per-asset read-only edit log, the property insurance prompt, and the
// add/edit modal. Every create/edit writes its audit entry in the same
// batch (see lib/wealth.ts) — the log can never be missing or edited.

'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatCents } from '@/components/pantry/format';
import { SUPPORTED_CURRENCIES } from '@/lib/fx';
import {
  ASSET_CLASSES, assetClassDef, LIQUIDITY_LABEL, computeWealthSummary,
  createWealthAsset, updateWealthAsset, getWealthAsset, subscribeToEditLog,
  subTypesFor, subTypeLabel, assetInView, tenantMonthlyCents,
  type WealthAsset, type WealthVisibility, type AssetClassId,
  type WealthEditLogEntry, type WealthInsurance, type WealthHolding,
  type Tenant, type WealthRental,
} from '@/lib/wealth';
import { CLASS_ICON_BG, liqPillClass, tsToDisplay } from './wealthFormat';
import type { WealthData } from './useWealthData';
import DocumentScanner from './DocumentScanner';
import { MoneyInput, moneyToCents, formatMoneyInput } from './MoneyInput';
import { syncInsuranceMirror } from './wealthInsuranceMirror';

interface Props {
  data: WealthData;
  view: Extract<WealthVisibility, 'shared' | 'personal'>;
}

const ACTION_EMOJI: Record<string, string> = {
  created: '✨', value_updated: '📈', insurance_changed: '🛡️',
  document_added: '📎', edited: '✏️', archived: '🗄️',
};

export default function AssetRegister({ data, view }: Props) {
  const { householdCurrency, rateFor, author, isParent, familyId } = data;
  const assets = useMemo(
    () => data.assets.filter((a) => assetInView(a, view, author.uid)),
    [data.assets, view, author.uid],
  );
  const summary = useMemo(
    () => computeWealthSummary(assets, householdCurrency, rateFor),
    [assets, householdCurrency, rateFor],
  );

  const present = useMemo(() => new Set(assets.map((a) => a.class)), [assets]);
  const [hidden, setHidden] = useState<Set<AssetClassId>>(new Set());
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; asset?: WealthAsset } | null>(null);
  const [scanAsset, setScanAsset] = useState<WealthAsset | null>(null);

  const toggleClass = (id: AssetClassId) => {
    if (!present.has(id)) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const tagFor = view === 'shared' ? 'Shared' : null;
  const groups = summary.groups.filter((g) => !hidden.has(g.def.id));

  return (
    <div className="adult-block">
      <div className="section-title">
        <h2>📚 Asset Register <span className="pilltag">By class &amp; liquidity</span></h2>
        {isParent && <a onClick={() => setModal({ mode: 'add' })}>+ Add asset</a>}
      </div>

      <div className="legend" style={{ marginBottom: 14 }}>
        {ASSET_CLASSES.map((c) => {
          const isOn = present.has(c.id) && !hidden.has(c.id);
          return (
            <span
              key={c.id}
              className={`lchip ${isOn ? 'on' : 'off'}`}
              onClick={() => toggleClass(c.id)}
              role="button"
            >
              {isOn && <span className="dotc" />}{c.label}
            </span>
          );
        })}
      </div>

      {assets.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="ee">🗄️</div>
            <div className="eh">Your vault is ready</div>
            <div className="ep">
              Add what the {view === 'personal' ? 'you own privately' : 'family owns'} — property, accounts,
              investments, pensions. Everything you add is logged and kept current.
            </div>
            {isParent && (
              <button className="addbtn" style={{ marginTop: 14 }} onClick={() => setModal({ mode: 'add' })}>
                + Add your first asset
              </button>
            )}
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div className="card" style={{ marginBottom: 14 }} key={g.def.id}>
            <div className="grouphead">
              <div className="gl">
                {g.def.emoji} {g.def.label}{' '}
                <span className={`liq ${liqPillClass(g.def.liquidity)}`}>{LIQUIDITY_LABEL[g.def.liquidity]}</span>
              </div>
              <div className="gt">{formatCents(g.subtotalCents, householdCurrency)}</div>
            </div>

            {g.assets.map((a) => (
              <div key={a.id}>
                <div className="asset">
                  <div className={`icon ${CLASS_ICON_BG[a.class]}`}>{g.def.emoji}</div>
                  <div className="info">
                    <div className="nm">
                      {a.name}
                      {subTypeLabel(a.class, a.subType) && <span className="tag t-docs">{subTypeLabel(a.class, a.subType)}</span>}
                      {tagFor && a.visibility === 'shared' && <span className="tag t-shared">{tagFor}</span>}
                      {a.visibility === 'personal' && a.ownerId !== author.uid && <span className="tag t-shared">🔓 Shared personal</span>}
                      {a.media?.length ? <span className="tag t-docs">📎 {a.media.length} docs</span> : null}
                    </div>
                    {a.meta?.subtitle && <div className="meta">{a.meta.subtitle}</div>}
                    {a.meta?.maturityNote && <span className="matur">{a.meta.maturityNote}</span>}
                  </div>
                  <div className="val">
                    <div className="amt">{formatCents(a.valueCents, a.currency)}</div>
                    {typeof a.meta?.changePct === 'number' && (
                      <div className={`chg ${a.meta.changePct >= 0 ? 'up' : 'down'}`}>
                        {a.meta.changePct >= 0 ? '▲' : '▼'} {Math.abs(a.meta.changePct)}%
                      </div>
                    )}
                  </div>
                  <div className="acts">
                    {isParent && (
                      <button className="iconbtn" title="Edit" onClick={() => setModal({ mode: 'edit', asset: a })}>✏️</button>
                    )}
                    {isParent && (
                      <button className="iconbtn" title="Add document" onClick={() => setScanAsset(a)}>📎</button>
                    )}
                    <button
                      className="iconbtn"
                      title="Edit log"
                      onClick={() => setOpenLog(openLog === a.id ? null : a.id)}
                    >🕘</button>
                  </div>
                </div>

                {openLog === a.id && familyId && (
                  <EditLogPanel familyId={familyId} assetId={a.id} name={a.name} />
                )}

                {a.visibility === 'personal' && a.ownerId === author.uid && familyId && (
                  <TransparencyToggle asset={a} familyId={familyId} author={author} />
                )}

                {a.class === 'real_estate' && a.rental?.tenants?.length && familyId
                  ? <RentalBlock asset={a} familyId={familyId} author={author} rateFor={rateFor} householdCurrency={householdCurrency} />
                  : null}

                {a.class === 'real_estate' && <InsuranceBlock asset={a} />}
              </div>
            ))}
          </div>
        ))
      )}

      {modal && familyId && (
        <AssetModal
          mode={modal.mode}
          asset={modal.asset}
          view={view}
          familyId={familyId}
          householdCurrency={householdCurrency}
          author={author}
          onClose={() => setModal(null)}
        />
      )}

      {scanAsset && familyId && (
        <DocumentScanner
          familyId={familyId}
          author={author}
          defaultAssetId={scanAsset.id}
          assets={assets.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setScanAsset(null)}
        />
      )}
    </div>
  );
}

// ── Edit log panel (live, read-only) ─────────────────────────────────

function EditLogPanel({ familyId, assetId, name }: { familyId: string; assetId: string; name: string }) {
  const [entries, setEntries] = useState<WealthEditLogEntry[]>([]);
  useEffect(() => subscribeToEditLog(familyId, assetId, setEntries), [familyId, assetId]);
  return (
    <div className="editlog open">
      <div className="et">🕘 Edit log — {name}</div>
      {entries.length === 0 ? (
        <div className="logrow"><span className="what">No history yet.</span></div>
      ) : (
        entries.map((e) => (
          <div className="logrow" key={e.id}>
            <span className="when">{tsToDisplay(e.ts)}</span>
            <span className="what">{ACTION_EMOJI[e.action] ?? '•'} {e.summary}</span>
            <span className="who">{e.authorName}</span>
          </div>
        ))
      )}
      <div className="note">🔐 Every create, edit and document change is logged with author &amp; timestamp. Logs are read-only and cannot be deleted.</div>
    </div>
  );
}

// ── Property insurance prompt (display) ──────────────────────────────

function InsuranceBlock({ asset }: { asset: WealthAsset }) {
  const ins = asset.insurance;
  const insured = !!ins?.insured;
  return (
    <div className="ins">
      <div className="q">
        Is this property insured?
        <span className="toggle">
          <button className={insured ? 'on' : ''}>Yes</button>
          <button className={!insured ? 'on' : ''}>No</button>
        </span>
      </div>
      {insured && ins && (
        <>
          <div className="det">
            <div><div className="k">Insured amount</div><div className="v">{ins.amountCents != null ? formatCents(ins.amountCents, asset.currency) : '—'}</div></div>
            <div><div className="k">Provider</div><div className="v">{ins.provider || '—'}</div></div>
            <div><div className="k">Premium</div><div className="v">{ins.premiumCents != null ? `${formatCents(ins.premiumCents, ins.premiumCurrency || asset.currency)} / yr` : '—'}</div></div>
            <div><div className="k">Renews</div><div className="v">{ins.renewalIso || '—'}</div></div>
          </div>
          <div className="flow">↳ Premium &amp; renewal mirror to Household → Subscriptions (read-only)</div>
        </>
      )}
    </div>
  );
}

// ── Add / edit modal ─────────────────────────────────────────────────

interface ModalProps {
  mode: 'add' | 'edit';
  asset?: WealthAsset;
  view: Extract<WealthVisibility, 'shared' | 'personal'>;
  familyId: string;
  householdCurrency: string;
  author: { uid: string; name: string };
  onClose: () => void;
}

function AssetModal({ mode, asset, view, familyId, householdCurrency, author, onClose }: ModalProps) {
  const [name, setName] = useState(asset?.name ?? '');
  const [klass, setKlass] = useState<AssetClassId>(asset?.class ?? 'cash');
  const [subType, setSubType] = useState<string>(asset?.subType ?? '');
  const [holdings, setHoldings] = useState<HoldingDraft[]>(
    (asset?.holdings ?? []).map((h) => ({ id: h.id, symbol: h.symbol, units: h.units, valueStr: formatMoneyInput(String(h.valueCents / 100)) })),
  );
  const [value, setValue] = useState(asset ? formatMoneyInput(String(asset.valueCents / 100)) : '');
  const [currency, setCurrency] = useState(asset?.currency ?? householdCurrency);
  const [subtitle, setSubtitle] = useState(asset?.meta?.subtitle ?? '');
  const [insured, setInsured] = useState(!!asset?.insurance?.insured);
  const [provider, setProvider] = useState(asset?.insurance?.provider ?? '');
  const [premium, setPremium] = useState(asset?.insurance?.premiumCents ? formatMoneyInput(String(asset.insurance.premiumCents / 100)) : '');
  const [renewal, setRenewal] = useState(asset?.insurance?.renewalIso ?? '');
  const [tenants, setTenants] = useState<TenantDraft[]>(
    (asset?.rental?.tenants ?? []).map((t) => ({ id: t.id, name: t.name, rentStr: formatMoneyInput(String(t.rentCents / 100)), currency: t.currency, frequency: t.frequency, status: t.status })),
  );
  const [busy, setBusy] = useState(false);

  const isBroker = klass === 'investments' && subType === 'broker';
  const holdingsCents = holdings.reduce((s, h) => s + moneyToCents(h.valueStr), 0);
  const valueCents = isBroker ? holdingsCents : moneyToCents(value);
  const canSave = name.trim().length > 0 && valueCents >= 0 && !busy;
  const changeKlass = (k: AssetClassId) => { setKlass(k); setSubType(''); if (k !== 'investments') setHoldings([]); };

  const buildInsurance = (): WealthInsurance | null => {
    if (klass !== 'real_estate' || !insured) return klass === 'real_estate' ? { insured: false } : null;
    return {
      insured: true,
      provider: provider.trim() || undefined,
      premiumCents: premium ? moneyToCents(premium) : undefined,
      premiumCurrency: currency,
      renewalIso: renewal || undefined,
    };
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const insurance = buildInsurance();
      const subTypeVal = subTypesFor(klass).length > 0 ? (subType || null) : null;
      const builtHoldings: WealthHolding[] | null = isBroker
        ? holdings.filter((h) => h.symbol.trim() || moneyToCents(h.valueStr) > 0)
                  .map((h) => ({ id: h.id, symbol: h.symbol.trim(), units: h.units, valueCents: moneyToCents(h.valueStr) }))
        : null;
      const builtRental: WealthRental | null = klass === 'real_estate' && tenants.length
        ? { tenants: tenants.filter((t) => t.name.trim() || moneyToCents(t.rentStr) > 0)
              .map((t) => ({ id: t.id, name: t.name.trim(), rentCents: moneyToCents(t.rentStr), currency: t.currency, frequency: t.frequency, status: t.status })) }
        : null;
      let savedId = asset?.id ?? '';
      if (mode === 'add') {
        const res = await createWealthAsset({
          familyId, class: klass, subType: subTypeVal, name: name.trim(), valueCents, currency, holdings: builtHoldings,
          visibility: view, ownerId: author.uid,
          meta: subtitle.trim() ? { subtitle: subtitle.trim() } : {},
          insurance, rental: builtRental, author,
        });
        savedId = res.assetId;
      } else if (asset) {
        const valueChanged = valueCents !== asset.valueCents;
        const insChanged = JSON.stringify(insurance) !== JSON.stringify(asset.insurance ?? null);
        const change = valueChanged
          ? {
              action: 'value_updated' as const,
              summary: `Value updated ${formatCents(asset.valueCents, asset.currency)} → ${formatCents(valueCents, currency)}`,
              before: { valueCents: asset.valueCents, currency: asset.currency },
              after: { valueCents, currency },
            }
          : insChanged
            ? { action: 'insurance_changed' as const, summary: insured ? `Insurance set — ${provider || 'provider'}` : 'Insurance removed' }
            : { action: 'edited' as const, summary: `Edited — ${name.trim()}` };
        await updateWealthAsset({
          familyId, assetId: asset.id, author, change,
          patch: {
            class: klass, subType: subTypeVal, name: name.trim(), valueCents, currency, holdings: builtHoldings,
            meta: subtitle.trim() ? { ...asset.meta, subtitle: subtitle.trim() } : asset.meta,
            insurance, rental: builtRental,
          },
        });
      }
      // Funnel (down only, Non-Negotiable #8): mirror this asset's insurance
      // to Household → Subscriptions. Re-fetch the saved doc so the mirror
      // sees canonical state (incl. an existing mirroredSubscriptionId).
      if (savedId) {
        const saved = await getWealthAsset(familyId, savedId);
        if (saved) await syncInsuranceMirror({ familyId, asset: saved, householdCurrency, author });
      }
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[wealth] save failed:', err);
      setBusy(false);
    }
  };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'add' ? '➕ Add asset' : '✏️ Edit asset'}</h3>
        <div className="msub">{view === 'personal' ? 'Private to you — hidden from the family.' : 'Shared with the family.'} Every change is logged.</div>

        <div className="kw-field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mbezi Beach House" />
        </div>

        <div className="kw-row2">
          <div className="kw-field">
            <label>Class</label>
            <select value={klass} onChange={(e) => changeKlass(e.target.value as AssetClassId)}>
              {ASSET_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
            </select>
          </div>
          <div className="kw-field">
            <label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
        </div>

        {subTypesFor(klass).length > 0 && (
          <div className="kw-field">
            <label>Type</label>
            <select value={subType} onChange={(e) => setSubType(e.target.value)}>
              <option value="">— choose —</option>
              {subTypesFor(klass).map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
            </select>
          </div>
        )}

        {isBroker ? (
          <>
            <HoldingsEditor holdings={holdings} setHoldings={setHoldings} currency={currency} />
            <div className="kw-field">
              <label>Total value ({currency})</label>
              <input value={formatMoneyInput(String(holdingsCents / 100))} readOnly style={{ background: '#FBF7EE', color: '#0F1F44', fontWeight: 700 }} />
              <div style={{ fontSize: 11.5, color: '#9a9a9a', marginTop: 4 }}>Sum of the holdings above.</div>
            </div>
          </>
        ) : (
          <div className="kw-field">
            <label>{assetClassDef(klass).isLiability ? 'Amount owed' : 'Value'} ({currency})</label>
            <MoneyInput value={value} onChange={setValue} placeholder="0" />
          </div>
        )}

        <div className="kw-field">
          <label>Detail <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(optional)</span></label>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Plot 412 · Title CT-88291" />
        </div>

        {klass === 'real_estate' && (
          <div className="kw-field" style={{ background: '#FBF7EE', border: '1px dashed #E7E0D0', borderRadius: 11, padding: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={insured} onChange={(e) => setInsured(e.target.checked)} />
              Insured? (premium mirrors to Household → Subscriptions)
            </label>
            {insured && (
              <div style={{ marginTop: 10 }}>
                <div className="kw-row2">
                  <div className="kw-field"><label>Provider</label><input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Jubilee" /></div>
                  <div className="kw-field"><label>Premium / yr ({currency})</label><MoneyInput value={premium} onChange={setPremium} placeholder="0" /></div>
                </div>
                <div className="kw-field" style={{ marginBottom: 0 }}><label>Renews on</label><input type="date" value={renewal} onChange={(e) => setRenewal(e.target.value)} /></div>
              </div>
            )}
          </div>
        )}

        {klass === 'real_estate' && (
          <TenantsEditor tenants={tenants} setTenants={setTenants} currency={currency} />
        )}

        <div className="kw-modal-actions">
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={!canSave} onClick={save}>{busy ? 'Saving…' : mode === 'add' ? 'Add to vault' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Transparency toggle (share a personal asset with the co-parent) ───

function TransparencyToggle({ asset, familyId, author }: {
  asset: WealthAsset; familyId: string; author: { uid: string; name: string };
}) {
  const [busy, setBusy] = useState(false);
  const on = asset.sharedWithPartner === true;
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateWealthAsset({
        familyId, assetId: asset.id, author,
        change: { action: 'edited', summary: on ? 'Made private — hidden from the co-parent' : 'Shared with family — visible to the co-parent' },
        patch: { sharedWithPartner: !on },
      });
    } catch { /* ignore */ } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 2px 12px', fontSize: 12.5, flexWrap: 'wrap' }}>
      <button onClick={toggle} disabled={busy} aria-pressed={on} title="Show this asset to your co-parent in full"
        style={{ width: 40, height: 22, borderRadius: 999, border: 'none', cursor: busy ? 'default' : 'pointer', position: 'relative', flex: 'none', background: on ? '#2E7D34' : '#d9d2c2', transition: '.2s' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: '.2s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
      </button>
      <span style={{ fontWeight: 700, color: on ? '#2E7D34' : '#5A5A5A' }}>{on ? '👁️ Visible to family' : '🔒 Private to you'}</span>
      <span style={{ color: '#9a9a9a', fontWeight: 500 }}>· {on ? 'counts in the shared net worth' : 'only you can see it'}</span>
    </div>
  );
}

// ── Rental tenants editor + display (a property's passive income) ─────

type TenantDraft = { id: string; name: string; rentStr: string; currency: string; frequency: 'month' | 'day'; status: 'paid' | 'due' };

function TenantsEditor({ tenants, setTenants, currency }: {
  tenants: TenantDraft[]; setTenants: (t: TenantDraft[]) => void; currency: string;
}) {
  const update = (i: number, patch: Partial<TenantDraft>) => setTenants(tenants.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const add = () => setTenants([...tenants, { id: `t${Date.now().toString(36)}${tenants.length}`, name: '', rentStr: '', currency, frequency: 'month', status: 'due' }]);
  const remove = (i: number) => setTenants(tenants.filter((_, j) => j !== i));
  return (
    <div className="kw-field" style={{ background: '#eef4ee', border: '1px dashed #cfe0cf', borderRadius: 11, padding: 12 }}>
      <label>🏘️ Rental — tenants <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(this property&apos;s passive income)</span></label>
      {tenants.length === 0 && <div style={{ fontSize: 11.5, color: '#9a9a9a', margin: '2px 0 8px' }}>Add each tenant; the rent shows a paid / due reminder on the property.</div>}
      {tenants.map((t, i) => (
        <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr .8fr .8fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Unit A · J. Mushi" />
          <MoneyInput value={t.rentStr} onChange={(v) => update(i, { rentStr: v })} placeholder="rent" />
          <select value={t.currency} onChange={(e) => update(i, { currency: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </select>
          <select value={t.frequency} onChange={(e) => update(i, { frequency: e.target.value as 'month' | 'day' })}>
            <option value="month">/mo</option><option value="day">/day</option>
          </select>
          <button className="kw-btn-ghost" style={{ padding: '6px 9px' }} onClick={() => remove(i)} title="Remove">✕</button>
        </div>
      ))}
      <button className="kw-btn-ghost" style={{ marginTop: 2 }} onClick={add}>+ Add tenant</button>
    </div>
  );
}

function RentalBlock({ asset, familyId, author, rateFor, householdCurrency }: {
  asset: WealthAsset; familyId: string; author: { uid: string; name: string };
  rateFor: (c: string) => number; householdCurrency: string;
}) {
  const tenants = asset.rental?.tenants ?? [];
  const totalH = tenants.reduce((s, t) => s + Math.round(tenantMonthlyCents(t) * (rateFor(t.currency) || 1)), 0);
  const toggleStatus = async (t: Tenant) => {
    const next: Tenant[] = tenants.map((x) => (x.id === t.id ? { ...x, status: x.status === 'paid' ? 'due' : 'paid' } : x));
    try {
      await updateWealthAsset({
        familyId, assetId: asset.id, author,
        change: { action: 'edited', summary: `Rent ${t.status === 'paid' ? 'marked due' : 'marked paid'} — ${t.name || 'tenant'}` },
        patch: { rental: { tenants: next } },
      });
    } catch { /* ignore */ }
  };
  return (
    <div className="ins" style={{ background: '#f3f8f3' }}>
      <div className="q" style={{ marginBottom: 6 }}>🏘️ Rental income <span style={{ marginLeft: 'auto', fontWeight: 800, color: 'var(--green)' }}>+ {formatCents(totalH, householdCurrency)} / mo</span></div>
      {tenants.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{t.name || 'Tenant'}</span>
          <span style={{ color: 'var(--grey)' }}>{formatCents(t.rentCents, t.currency)} /{t.frequency === 'day' ? 'day' : 'mo'}</span>
          <button onClick={() => toggleStatus(t)} title="Toggle paid / due"
            style={{ marginLeft: 'auto', cursor: 'pointer', border: 'none', borderRadius: 999, padding: '2px 10px', fontSize: 10.5, fontWeight: 800,
              background: t.status === 'paid' ? '#E3F0E4' : '#fdecea', color: t.status === 'paid' ? '#2E7D34' : '#c0392b' }}>
            {t.status === 'paid' ? '✓ PAID' : '● DUE'}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Brokerage holdings editor (split a broker account by what you own) ─

type HoldingDraft = { id: string; symbol: string; units: number | null; valueStr: string };

function HoldingsEditor({ holdings, setHoldings, currency }: {
  holdings: HoldingDraft[]; setHoldings: (h: HoldingDraft[]) => void; currency: string;
}) {
  const update = (i: number, patch: Partial<HoldingDraft>) =>
    setHoldings(holdings.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const add = () => setHoldings([...holdings, { id: `h${Date.now().toString(36)}${holdings.length}`, symbol: '', units: null, valueStr: '' }]);
  const remove = (i: number) => setHoldings(holdings.filter((_, j) => j !== i));
  return (
    <div className="kw-field" style={{ background: '#FBF7EE', border: '1px dashed #E7E0D0', borderRadius: 11, padding: 12 }}>
      <label>Holdings — split by what you own</label>
      {holdings.length === 0 && <div style={{ fontSize: 11.5, color: '#9a9a9a', margin: '2px 0 8px' }}>Add each position; the total sums them.</div>}
      {holdings.map((h, i) => (
        <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr .8fr 1.1fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input value={h.symbol} onChange={(e) => update(i, { symbol: e.target.value })} placeholder="AAPL" />
          <input inputMode="decimal" value={h.units ?? ''} placeholder="units"
            onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); update(i, { units: v ? parseFloat(v) : null }); }} />
          <MoneyInput value={h.valueStr} onChange={(v) => update(i, { valueStr: v })} placeholder={`value (${currency})`} />
          <button className="kw-btn-ghost" style={{ padding: '6px 10px' }} onClick={() => remove(i)} title="Remove">✕</button>
        </div>
      ))}
      <button className="kw-btn-ghost" style={{ marginTop: 2 }} onClick={add}>+ Add holding</button>
    </div>
  );
}
