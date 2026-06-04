'use client';

// Kaya Wealth · Income Engine (Phase 2 · PR6 · 2026-06-01).
//
// Active vs Passive income, live, in both Shared + Personal views. The
// headline is passive coverage — passive income as a % of monthly expenses,
// framed as progress to financial independence (passive ≥ expenses). Reuses
// the mockup's `.inc` card styling from wealth.css.

import { useEffect, useMemo, useState } from 'react';
import { formatCents } from '@/components/pantry/format';
import { SUPPORTED_CURRENCIES } from '@/lib/fx';
import {
  subscribeToIncome, subscribeIncomeConfig, computeIncomeSummary, setMonthlyExpenses,
  createIncome, updateIncome, deleteIncome, incomeCatDef, INCOME_CATEGORIES,
  setSsFund, projectSsBalance, ssFundSetup, EMPTY_INCOME_CONFIG, incomeContributionCents,
  reconcileContributionMirror,
  type IncomeSource, type IncomeKind, type IncomeVisibility, type IncomeConfig,
} from '@/lib/wealthIncome';
import type { WealthData } from './useWealthData';
import { MoneyInput, moneyToCents, formatMoneyInput } from './MoneyInput';

export default function IncomeEngine({ data, view }: { data: WealthData; view: IncomeVisibility }) {
  const { familyId, author, householdCurrency, rateFor, isParent } = data;
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [config, setConfig] = useState<IncomeConfig>(EMPTY_INCOME_CONFIG);
  const [ssEdit, setSsEdit] = useState<null | { opening: string; since: string }>(null);
  const [modal, setModal] = useState<null | { kind: IncomeKind; source?: IncomeSource }>(null);
  const [expEdit, setExpEdit] = useState<string | null>(null);

  useEffect(() => { if (familyId) return subscribeToIncome(familyId, author.uid, setSources); }, [familyId, author.uid]);
  useEffect(() => { if (familyId) return subscribeIncomeConfig(familyId, setConfig); }, [familyId]);

  // Self-healing mirror: keep the shared-pool entries for MY OWN personal income
  // in sync with the wealth_config mirror — so a contribution set before this
  // shipped (or changed elsewhere) shows up in Shared without a manual re-save.
  // Each parent reconciles only their own rows; converges then stops writing.
  useEffect(() => {
    if (!familyId) return;
    for (const src of sources) {
      if (src.visibility !== 'personal' || src.ownerId !== author.uid) continue;
      const want = incomeContributionCents(src);
      const cur = config.contributions?.[src.id];
      const inSync = want > 0
        ? !!cur && cur.cents === want && cur.currency === src.currency && cur.label === src.label
        : !cur;
      if (!inSync) void reconcileContributionMirror(familyId, src);
    }
  }, [sources, config.contributions, familyId, author.uid]);

  const s = useMemo(
    () => computeIncomeSummary(sources, view, author.uid, householdCurrency, rateFor, config),
    [sources, view, author.uid, householdCurrency, rateFor, config],
  );
  const toH = (src: IncomeSource) => Math.round(src.grossMonthlyCents * (rateFor(src.currency) || 1));

  const saveExpenses = async () => {
    if (familyId && expEdit !== null) await setMonthlyExpenses(familyId, view, author.uid, Math.round((parseFloat(expEdit) || 0) * 100));
    setExpEdit(null);
  };
  const addLink = (kind: IncomeKind, label: string) => isParent
    ? <a onClick={() => setModal({ kind })} style={{ cursor: 'pointer', color: 'var(--blue)', fontSize: 12, fontWeight: 700 }}>{label}</a>
    : null;

  const ssSetup = ssFundSetup(config, view, author.uid);
  const ssBalance = projectSsBalance(ssSetup.opening, ssSetup.since, s.socialSecurityCents, new Date());
  const openSsEdit = () => setSsEdit({ opening: ssSetup.opening ? formatMoneyInput(String(ssSetup.opening / 100)) : '', since: ssSetup.since || '' });
  const saveSsFund = async () => {
    if (familyId && ssEdit) await setSsFund(familyId, view, author.uid, moneyToCents(ssEdit.opening), ssEdit.since);
    setSsEdit(null);
  };

  return (
    <div className="adult-block">
      <div className="section-title"><h2>💵 Income Engine <span className="pilltag">Active vs Passive</span></h2></div>
      <div className="grid g2">
        {/* ACTIVE */}
        <div className="card inc">
          <div className="head">
            <div className="t"><span className="badge b-active">🛠️</span> Active Income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>/ month</small></div>
            <div className="total">{formatCents(s.activeNetCents + (view === 'shared' ? s.pooledContributionsCents : 0), householdCurrency)} <small>{view === 'shared' && s.pooledContributionsCents > 0 ? 'incl. ↗ personal' : 'net take-home'}</small></div>
          </div>
          {s.active.length === 0 && s.pooledContributionsCents === 0 && <div className="iline"><span className="l">No active income yet</span><span className="r">{addLink('active', '+ Add')}</span></div>}
          {s.active.map((src) => (
            <div className="iline" key={src.id} role={isParent ? 'button' : undefined} style={isParent ? { cursor: 'pointer' } : undefined}
              onClick={() => isParent && setModal({ kind: 'active', source: src })}>
              <span className="l"><span className="ic">{incomeCatDef(src.category).emoji}</span>{src.label}{src.employer ? <span className="sub"> · {src.employer}</span> : null}{view === 'personal' && incomeContributionCents(src) > 0 ? <span className="sub" style={{ color: 'var(--purple)' }}> · ↗ {formatCents(Math.round(incomeContributionCents(src) * (rateFor(src.currency) || 1)), householdCurrency)} to family</span> : null}</span>
              <span className="r">{formatCents(toH(src), householdCurrency)}</span>
            </div>
          ))}
          {view === 'shared' && s.pooledContributionsCents > 0 && (
            <div className="iline pos"><span className="l"><span className="ic">↗</span>From personal income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>shared to the pool</small></span><span className="r">+ {formatCents(s.pooledContributionsCents, householdCurrency)}</span></div>
          )}
          {(s.socialSecurityCents > 0 || s.taxInfoCents > 0) && (
            <>
              {s.socialSecurityCents > 0 && (
                <div className="iline pos"><span className="l"><span className="ic">🛡️</span>Social Security <small style={{ color: 'var(--grey)', fontWeight: 600 }}>you + employer → Fund</small></span><span className="r">+ {formatCents(s.socialSecurityCents, householdCurrency)}</span></div>
              )}
              {s.taxInfoCents > 0 && (
                <div className="iline" style={{ opacity: .68 }}><span className="l"><span className="ic">🧾</span>Tax paid <small style={{ color: 'var(--grey)', fontWeight: 600 }}>(information only)</small></span><span className="r" style={{ color: 'var(--grey)' }}>{formatCents(s.taxInfoCents, householdCurrency)}</span></div>
              )}
            </>
          )}
          {s.active.length > 0 && <div style={{ marginTop: 8 }}>{addLink('active', '+ Add active income')}</div>}
        </div>

        {/* PASSIVE */}
        <div className="card inc">
          <div className="head">
            <div className="t"><span className="badge b-passive">🌙</span> Passive Income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>/ month</small></div>
            <div className="total">{formatCents(s.passiveTotalCents, householdCurrency)}</div>
          </div>
          {s.passive.length === 0 && <div className="iline"><span className="l">No passive income yet</span><span className="r">{addLink('passive', '+ Add')}</span></div>}
          {s.passive.map((src) => (
            <div className="iline pos" key={src.id} role={isParent ? 'button' : undefined} style={isParent ? { cursor: 'pointer' } : undefined}
              onClick={() => isParent && setModal({ kind: 'passive', source: src })}>
              <span className="l"><span className="ic">{incomeCatDef(src.category).emoji}</span>{src.label}{src.employer ? <span className="sub"> · {src.employer}</span> : null}{view === 'personal' && incomeContributionCents(src) > 0 ? <span className="sub" style={{ color: 'var(--purple)' }}> · ↗ {formatCents(Math.round(incomeContributionCents(src) * (rateFor(src.currency) || 1)), householdCurrency)} to family</span> : null}</span>
              <span className="r">+ {formatCents(toH(src), householdCurrency)}</span>
            </div>
          ))}
          {s.passive.length > 0 && <div style={{ marginTop: 8 }}>{addLink('passive', '+ Add passive income')}</div>}

          <div className="cover">
            <div className="cmrow">
              <span className="g">Passive covers your monthly expenses</span>
              <span className="p">
                {formatCents(s.passiveTotalCents, householdCurrency)} /{' '}
                {expEdit !== null ? (
                  <input autoFocus value={expEdit}
                    onChange={(e) => setExpEdit(e.target.value.replace(/[^\d.]/g, ''))}
                    onBlur={saveExpenses}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveExpenses(); }}
                    style={{ width: 84, padding: '2px 6px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 12 }} />
                ) : (
                  <span onClick={() => isParent && setExpEdit(s.expensesCents ? String(s.expensesCents / 100) : '')}
                    style={isParent ? { cursor: 'pointer', borderBottom: '1px dashed var(--grey)' } : undefined}>
                    {s.expensesCents > 0 ? formatCents(s.expensesCents, householdCurrency) : (isParent ? 'set expenses' : '—')}
                  </span>
                )}
              </span>
            </div>
            <div className="track"><i style={{ width: `${Math.min(100, Math.max(0, s.coveragePct))}%` }} /></div>
            <div className="fi">🎯 {s.coveragePct}% to financial independence — when passive ≥ expenses</div>
          </div>
        </div>
      </div>

      {view === 'shared' && s.pooledContributionsCents > 0 && (
        <div className="card" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, background: '#f6f2fc', borderColor: '#e6ddf4' }}>
          <span style={{ fontSize: 18 }}>↗</span>
          <div style={{ fontSize: 13, color: 'var(--navy)' }}><b>{formatCents(s.pooledContributionsCents, householdCurrency)}/mo</b> contributed from family members&apos; personal income into the shared pool — only this portion is shared; the rest stays private.</div>
        </div>
      )}

      {/* SOCIAL SECURITY FUND — grows by the monthly amount set on active income */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#ede9f7', width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>🛡️</span>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: 14.5 }}>Social Security Fund</div>
              <div style={{ fontSize: 11.5, color: 'var(--grey)' }}>Your future-savings pot — grows every month</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--navy)' }}>{formatCents(ssBalance, householdCurrency)}</div>
            {s.socialSecurityCents > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>▲ +{formatCents(s.socialSecurityCents, householdCurrency)} / mo</div>}
          </div>
        </div>

        {isParent && (ssEdit ? (
          <div style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
            <div className="kw-row2">
              <div className="kw-field"><label>Opening balance ({householdCurrency})</label><MoneyInput value={ssEdit.opening} onChange={(v) => setSsEdit({ ...ssEdit, opening: v })} placeholder="0" /></div>
              <div className="kw-field"><label>Saving since</label><input type="date" value={ssEdit.since} onChange={(e) => setSsEdit({ ...ssEdit, since: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="kw-btn-ghost" onClick={() => setSsEdit(null)}>Cancel</button>
              <button className="kw-btn-primary" onClick={saveSsFund}>Save</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--grey)' }}>Balance = opening + monthly Social Security × months since you started. Setup-only — auto-posting &amp; release come later.</span>
            <a onClick={openSsEdit} style={{ cursor: 'pointer', color: 'var(--blue)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>⚙︎ Set opening &amp; start date</a>
          </div>
        ))}
      </div>

      {modal && familyId && (
        <IncomeModal kind={modal.kind} source={modal.source} view={view} familyId={familyId}
          householdCurrency={householdCurrency} authorUid={author.uid} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ── Add / edit modal ─────────────────────────────────────────────────

function IncomeModal({ kind, source, view, familyId, householdCurrency, authorUid, onClose }: {
  kind: IncomeKind; source?: IncomeSource; view: IncomeVisibility;
  familyId: string; householdCurrency: string; authorUid: string; onClose: () => void;
}) {
  const cats = INCOME_CATEGORIES.filter((c) => c.kind === kind);
  const [category, setCategory] = useState(source?.category ?? cats[0].id);
  const [label, setLabel] = useState(source?.label ?? '');
  const [gross, setGross] = useState(source ? formatMoneyInput(String(source.grossMonthlyCents / 100)) : '');
  const [currency, setCurrency] = useState(source?.currency ?? householdCurrency);
  const [employer, setEmployer] = useState(source?.employer ?? '');
  const [social, setSocial] = useState(source ? formatMoneyInput(String((source.socialSecurityCents ?? 0) / 100)) : '');
  const [tax, setTax] = useState(source ? formatMoneyInput(String((source.taxCents ?? 0) / 100)) : '');
  const [shareMode, setShareMode] = useState<'pct' | 'amount'>(source?.shareToFamily?.mode ?? 'pct');
  const [shareValue, setShareValue] = useState(
    source?.shareToFamily
      ? (source.shareToFamily.mode === 'amount' ? formatMoneyInput(String(source.shareToFamily.value / 100)) : String(source.shareToFamily.value))
      : '',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const grossCents = moneyToCents(gross);
  const canSave = grossCents > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr('');
    const lbl = label.trim() || incomeCatDef(category).label;
    const emp = kind === 'active' ? employer.trim() : '';
    const share: { mode: 'pct' | 'amount'; value: number } | null = view === 'personal' && shareValue.trim()
      // % is clamped to 0–100 so an over-typed value can never balloon into the whole income.
      ? { mode: shareMode, value: shareMode === 'amount' ? moneyToCents(shareValue) : Math.min(100, Math.max(0, parseFloat(shareValue) || 0)) }
      : null;
    try {
      if (source) {
        await updateIncome(familyId, source.id, {
          category, label: lbl, employer: emp, grossMonthlyCents: grossCents, currency,
          socialSecurityCents: kind === 'active' ? moneyToCents(social) : 0,
          taxCents: kind === 'active' ? moneyToCents(tax) : 0,
          shareToFamily: share,
        });
        await reconcileContributionMirror(familyId, { id: source.id, visibility: view, ownerId: source.ownerId, kind, label: lbl, currency, grossMonthlyCents: grossCents, shareToFamily: share });
      } else {
        const { id } = await createIncome({
          familyId, kind, category, label: lbl, employer: emp, grossMonthlyCents: grossCents, currency,
          socialSecurityCents: kind === 'active' ? moneyToCents(social) : 0,
          taxCents: kind === 'active' ? moneyToCents(tax) : 0,
          shareToFamily: share,
          visibility: view, ownerId: authorUid,
        });
        await reconcileContributionMirror(familyId, { id, visibility: view, ownerId: authorUid, kind, label: lbl, currency, grossMonthlyCents: grossCents, shareToFamily: share });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error && /permission/i.test(e.message) ? 'Permission denied — reload and try again.' : 'Couldn’t save. Please try again.');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!source) return;
    await deleteIncome(familyId, source.id);
    // Clear any shared-pool mirror entry this income left behind.
    await reconcileContributionMirror(familyId, { id: source.id, visibility: source.visibility, ownerId: source.ownerId, kind: source.kind, label: source.label, currency: source.currency, grossMonthlyCents: 0, shareToFamily: null });
    onClose();
  };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{source ? '✏️ Edit' : '➕ Add'} {kind} income</h3>
        <div className="msub">{view === 'personal' ? 'Private to you.' : 'Shared with the family.'} Enter the net (take-home) monthly figure.</div>
        <div className="kw-field"><label>Source</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
          </select>
        </div>
        <div className="kw-field"><label>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={incomeCatDef(category).label} /></div>
        {kind === 'active' && (
          <div className="kw-field"><label>Employer <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(optional)</span></label><input value={employer} onChange={(e) => setEmployer(e.target.value)} placeholder="e.g. Neldi Inc — to capture multiple salaries" /></div>
        )}
        <div className="kw-row2">
          <div className="kw-field"><label>Net take-home / month ({currency})</label><MoneyInput value={gross} onChange={setGross} placeholder="0" /></div>
          <div className="kw-field"><label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
        </div>
        {kind === 'active' && (
          <>
            <div className="kw-row2">
              <div className="kw-field"><label>Social Security / month ({currency})</label><MoneyInput value={social} onChange={setSocial} placeholder="0" /></div>
              <div className="kw-field"><label>Tax paid / month ({currency})</label><MoneyInput value={tax} onChange={setTax} placeholder="0" /></div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--grey)', marginTop: -2, marginBottom: 10, lineHeight: 1.5 }}>
              🛡️ <b>Social Security</b> — your + the employer&apos;s contribution; it builds your Social Security Fund (counts as savings, not lost).<br />
              🧾 <b>Tax paid</b> is recorded for information only — it never changes any total.
            </div>
          </>
        )}
        {view === 'personal' && (
          <div className="kw-field" style={{ background: '#f3effb', border: '1px dashed #d9cdee', borderRadius: 11, padding: 12 }}>
            <label style={{ color: 'var(--purple)' }}>↗ Contribute to the shared family pool <span style={{ color: '#9a9a9a', fontWeight: 500 }}>(optional)</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={shareMode} onChange={(e) => setShareMode(e.target.value as 'pct' | 'amount')} style={{ width: 'auto', flex: 'none' }}>
                <option value="pct">%</option>
                <option value="amount">{currency}</option>
              </select>
              {shareMode === 'amount'
                ? <MoneyInput value={shareValue} onChange={setShareValue} placeholder="0" />
                : <input inputMode="decimal" value={shareValue} onChange={(e) => setShareValue(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />}
            </div>
            {/* Live mirror: fill % → see the amount; fill amount → see the %. */}
            {(() => {
              const raw = shareValue.trim();
              if (!raw || grossCents <= 0) return null;
              if (shareMode === 'pct') {
                const rawPct = parseFloat(raw) || 0;
                const pct = Math.min(100, Math.max(0, rawPct));
                const amt = Math.round(grossCents * pct / 100);
                return <div style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700, marginTop: 6 }}>= {formatCents(amt, currency)}/mo to family{rawPct > 100 ? ' · capped at 100%' : ''}</div>;
              }
              const amt = moneyToCents(raw);
              const capped = Math.min(amt, grossCents);
              const pct = grossCents > 0 ? Math.round((capped / grossCents) * 100) : 0;
              return <div style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700, marginTop: 6 }}>= {pct}% of your {formatCents(grossCents, currency)} net{amt > grossCents ? ' · capped at your net' : ''}</div>;
            })()}
            <div style={{ fontSize: 11, color: 'var(--grey)', marginTop: 6 }}>This portion counts in the family&apos;s shared pool; the rest stays private to you.</div>
          </div>
        )}
        {err && <div style={{ color: '#c0392b', fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>{err}</div>}
        <div className="kw-modal-actions">
          {source && <button className="kw-btn-ghost" style={{ color: '#E85C5C' }} onClick={remove}>Delete</button>}
          <button className="kw-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kw-btn-primary" disabled={!canSave} onClick={save}>{busy ? 'Saving…' : source ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}
