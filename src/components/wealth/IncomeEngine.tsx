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
  type IncomeSource, type IncomeKind, type IncomeVisibility, type IncomeConfig,
} from '@/lib/wealthIncome';
import type { WealthData } from './useWealthData';
import { MoneyInput, moneyToCents, formatMoneyInput } from './MoneyInput';

export default function IncomeEngine({ data, view }: { data: WealthData; view: IncomeVisibility }) {
  const { familyId, author, householdCurrency, rateFor, isParent } = data;
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [config, setConfig] = useState<IncomeConfig>({ expensesShared: 0, expensesPersonal: {} });
  const [modal, setModal] = useState<null | { kind: IncomeKind; source?: IncomeSource }>(null);
  const [expEdit, setExpEdit] = useState<string | null>(null);

  useEffect(() => { if (familyId) return subscribeToIncome(familyId, setSources); }, [familyId]);
  useEffect(() => { if (familyId) return subscribeIncomeConfig(familyId, setConfig); }, [familyId]);

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

  return (
    <div className="adult-block">
      <div className="section-title"><h2>💵 Income Engine <span className="pilltag">Active vs Passive</span></h2></div>
      <div className="grid g2">
        {/* ACTIVE */}
        <div className="card inc">
          <div className="head">
            <div className="t"><span className="badge b-active">🛠️</span> Active Income <small style={{ color: 'var(--grey)', fontWeight: 600 }}>/ month</small></div>
            <div className="total">{formatCents(s.activeGrossCents, householdCurrency)} <small>gross</small></div>
          </div>
          {s.active.length === 0 && <div className="iline"><span className="l">No active income yet</span><span className="r">{addLink('active', '+ Add')}</span></div>}
          {s.active.map((src) => (
            <div className="iline" key={src.id} role={isParent ? 'button' : undefined} style={isParent ? { cursor: 'pointer' } : undefined}
              onClick={() => isParent && setModal({ kind: 'active', source: src })}>
              <span className="l"><span className="ic">{incomeCatDef(src.category).emoji}</span>{src.label}{src.employer ? <span className="sub"> · {src.employer}</span> : null}</span>
              <span className="r">{formatCents(toH(src), householdCurrency)}</span>
            </div>
          ))}
          {s.activeGrossCents > 0 && (
            <>
              <div className="iline neg"><span className="l"><span className="ic">🧾</span>PAYE &amp; taxes</span><span className="r">− {formatCents(s.activeTaxCents, householdCurrency)}</span></div>
              <div className="iline pos"><span className="l"><span className="ic">🐷</span>Saved to queue</span><span className="r">+ {formatCents(s.activeSavedCents, householdCurrency)}</span></div>
              <div className="iline"><span className="l"><span className="ic">🏠</span>Net to household spend</span><span className="r">{formatCents(s.activeNetCents, householdCurrency)}</span></div>
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
              <span className="l"><span className="ic">{incomeCatDef(src.category).emoji}</span>{src.label}{src.employer ? <span className="sub"> · {src.employer}</span> : null}</span>
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
  const [taxPct, setTaxPct] = useState(source ? String(source.taxPct) : '');
  const [savedPct, setSavedPct] = useState(source ? String(source.savedPct) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const grossCents = moneyToCents(gross);
  const canSave = grossCents > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setErr('');
    const lbl = label.trim() || incomeCatDef(category).label;
    const emp = kind === 'active' ? employer.trim() : '';
    try {
      if (source) {
        await updateIncome(familyId, source.id, {
          category, label: lbl, employer: emp, grossMonthlyCents: grossCents, currency,
          taxPct: kind === 'active' ? (parseFloat(taxPct) || 0) : 0,
          savedPct: kind === 'active' ? (parseFloat(savedPct) || 0) : 0,
        });
      } else {
        await createIncome({
          familyId, kind, category, label: lbl, employer: emp, grossMonthlyCents: grossCents, currency,
          taxPct: parseFloat(taxPct) || 0, savedPct: parseFloat(savedPct) || 0,
          visibility: view, ownerId: authorUid,
        });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error && /permission/i.test(e.message) ? 'Permission denied — reload and try again.' : 'Couldn’t save. Please try again.');
      setBusy(false);
    }
  };
  const remove = async () => { if (source) { await deleteIncome(familyId, source.id); onClose(); } };

  return (
    <div className="kw-modal-back" onClick={onClose}>
      <div className="kw-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{source ? '✏️ Edit' : '➕ Add'} {kind} income</h3>
        <div className="msub">{view === 'personal' ? 'Private to you.' : 'Shared with the family.'} Enter the monthly figure.</div>
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
          <div className="kw-field"><label>Gross / month ({currency})</label><MoneyInput value={gross} onChange={setGross} placeholder="0" /></div>
          <div className="kw-field"><label>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </div>
        </div>
        {kind === 'active' && (
          <div className="kw-row2">
            <div className="kw-field"><label>Tax / PAYE %</label><input type="number" inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} placeholder="0" /></div>
            <div className="kw-field"><label>Saved to queue %</label><input type="number" inputMode="decimal" value={savedPct} onChange={(e) => setSavedPct(e.target.value)} placeholder="0" /></div>
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
