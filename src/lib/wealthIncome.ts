// Kaya Wealth · Income Engine data layer (Phase 2 · PR6 · 2026-06-01).
//
// The growth heartbeat: the family's earning split into Active (salaries,
// director fees, less tax + savings) and Passive (coupons, interest,
// dividends, rent). The headline metric is passive coverage — passive income
// as a % of monthly expenses, framed as progress to financial independence
// (the point where passive ≥ expenses). Shown in both Shared + Personal views.
//
// Collection: families/{f}/wealth_income/{id}. Monthly-expenses figures (for
// the coverage meter) live on families/{f}/wealth_config/income.

import {
  collection, doc, getDocs, onSnapshot, query, where, setDoc, updateDoc, deleteDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type IncomeKind = 'active' | 'passive';
export type IncomeVisibility = 'shared' | 'personal';

export interface IncomeCategoryDef { id: string; kind: IncomeKind; label: string; emoji: string }

export const INCOME_CATEGORIES: IncomeCategoryDef[] = [
  { id: 'salary',        kind: 'active',  label: 'Salary',                emoji: '💼' },
  { id: 'director_fee',  kind: 'active',  label: 'Director fees',         emoji: '💼' },
  { id: 'business',      kind: 'active',  label: 'Business income',       emoji: '🏢' },
  { id: 'freelance',     kind: 'active',  label: 'Freelance / consulting', emoji: '🛠️' },
  { id: 'active_other',  kind: 'active',  label: 'Other active',          emoji: '🛠️' },
  { id: 'bond',          kind: 'passive', label: 'Bond coupons',          emoji: '📜' },
  { id: 'fixed_deposit', kind: 'passive', label: 'Fixed-deposit interest', emoji: '🏦' },
  { id: 'dividend',      kind: 'passive', label: 'Dividends',             emoji: '📈' },
  { id: 'rental',        kind: 'passive', label: 'Rental income',         emoji: '🏘️' },
  { id: 'tbill',         kind: 'passive', label: 'T-bill yield',          emoji: '📜' },
  { id: 'royalty',       kind: 'passive', label: 'Royalties / IP',        emoji: '🎵' },
  { id: 'passive_other', kind: 'passive', label: 'Other passive',         emoji: '🌙' },
];

export function incomeCatDef(id: string): IncomeCategoryDef {
  return INCOME_CATEGORIES.find((c) => c.id === id) ?? INCOME_CATEGORIES[0];
}

export interface IncomeSource {
  id: string;
  kind: IncomeKind;
  category: string;
  label: string;
  employer: string;   // which employer (for capturing multiple salaries)
  grossMonthlyCents: number;
  currency: string;
  taxPct: number;     // active: PAYE/tax %; passive: 0
  savedPct: number;   // active: % saved to the queue; passive: 0
  visibility: IncomeVisibility;
  ownerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const incomeCol = (familyId: string) => collection(db, 'families', familyId, 'wealth_income');

export function subscribeToIncome(familyId: string, uid: string, cb: (s: IncomeSource[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const col = incomeCol(familyId);
  // Row-conditional read rule (personal rows are owner-only) means an
  // UNCONSTRAINED collection query is rejected by Firestore — a plain
  // onSnapshot(col) returns permission-denied, so saved income never appears
  // and the engine looks broken. Run two rule-satisfying queries and merge:
  // every row I own (my personal + shared I added) + every shared row. A
  // co-parent's personal income matches neither, so it stays private.
  const mine = new Map<string, IncomeSource>();
  const shared = new Map<string, IncomeSource>();
  const seen = { mine: false, shared: false };
  const emit = () => {
    if (!seen.mine || !seen.shared) return;
    const m = new Map<string, IncomeSource>(shared);
    for (const [k, v] of mine) m.set(k, v);
    cb(Array.from(m.values()));
  };
  const u1 = onSnapshot(query(col, where('ownerId', '==', uid)),
    (snap) => { mine.clear(); snap.forEach((d) => mine.set(d.id, { id: d.id, ...d.data() } as IncomeSource)); seen.mine = true; emit(); },
    // eslint-disable-next-line no-console
    (err) => { seen.mine = true; console.error('[wealth/income] subscribe (own) failed:', err); emit(); });
  const u2 = onSnapshot(query(col, where('visibility', '==', 'shared')),
    (snap) => { shared.clear(); snap.forEach((d) => shared.set(d.id, { id: d.id, ...d.data() } as IncomeSource)); seen.shared = true; emit(); },
    // eslint-disable-next-line no-console
    (err) => { seen.shared = true; console.error('[wealth/income] subscribe (shared) failed:', err); emit(); });
  return () => { u1(); u2(); };
}

export async function listIncome(familyId: string): Promise<IncomeSource[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(incomeCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomeSource));
}

export interface CreateIncomeInput {
  familyId: string;
  kind: IncomeKind;
  category: string;
  label: string;
  employer?: string;
  grossMonthlyCents: number;
  currency: string;
  taxPct?: number;
  savedPct?: number;
  visibility: IncomeVisibility;
  ownerId: string;
}

export async function createIncome(input: CreateIncomeInput): Promise<{ id: string }> {
  if (isGuestActive()) return { id: 'guest' };
  const ref = doc(incomeCol(input.familyId));
  await setDoc(ref, {
    kind: input.kind,
    category: input.category,
    label: input.label,
    employer: input.employer ?? '',
    grossMonthlyCents: input.grossMonthlyCents,
    currency: input.currency,
    taxPct: input.kind === 'active' ? (input.taxPct ?? 0) : 0,
    savedPct: input.kind === 'active' ? (input.savedPct ?? 0) : 0,
    visibility: input.visibility,
    ownerId: input.ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id };
}

export type IncomePatch = Partial<Pick<IncomeSource,
  'category' | 'label' | 'employer' | 'grossMonthlyCents' | 'currency' | 'taxPct' | 'savedPct'>>;

export async function updateIncome(familyId: string, id: string, patch: IncomePatch): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId, 'wealth_income', id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deleteIncome(familyId: string, id: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(db, 'families', familyId, 'wealth_income', id));
}

// ── Monthly-expenses config (for the passive-coverage meter) ─────────

export interface IncomeConfig { expensesShared: number; expensesPersonal: Record<string, number> }

const configRef = (familyId: string) => doc(db, 'families', familyId, 'wealth_config', 'income');

export function subscribeIncomeConfig(familyId: string, cb: (c: IncomeConfig) => void): () => void {
  if (isGuestActive()) { cb({ expensesShared: 0, expensesPersonal: {} }); return () => {}; }
  return onSnapshot(
    configRef(familyId),
    (snap) => {
      const d = (snap.data() as Partial<IncomeConfig> | undefined) ?? {};
      cb({ expensesShared: d.expensesShared ?? 0, expensesPersonal: d.expensesPersonal ?? {} });
    },
    () => cb({ expensesShared: 0, expensesPersonal: {} }),
  );
}

export async function setMonthlyExpenses(familyId: string, view: IncomeVisibility, ownerId: string, cents: number): Promise<void> {
  if (isGuestActive()) return;
  const patch = view === 'shared'
    ? { expensesShared: cents }
    : { expensesPersonal: { [ownerId]: cents } };
  await setDoc(configRef(familyId), patch, { merge: true });
}

// ── Summary (active/passive totals + passive coverage) ───────────────

export type FxResolver = (currency: string) => number;

export interface IncomeSummary {
  active: IncomeSource[];
  passive: IncomeSource[];
  activeGrossCents: number;
  activeTaxCents: number;
  activeSavedCents: number;
  activeNetCents: number;     // gross − tax − saved (to household spend)
  passiveTotalCents: number;
  expensesCents: number;
  coveragePct: number;        // passive / expenses, 0–100+ (capped at 100 for the bar)
  householdCurrency: string;
}

export function computeIncomeSummary(
  sources: IncomeSource[],
  view: IncomeVisibility,
  ownerId: string,
  householdCurrency: string,
  rateFor: FxResolver,
  config: IncomeConfig,
): IncomeSummary {
  const filtered = sources.filter((s) => s.visibility === view && (view !== 'personal' || s.ownerId === ownerId));
  const toH = (s: IncomeSource) => {
    const r = rateFor(s.currency);
    return Math.round(s.grossMonthlyCents * (Number.isFinite(r) && r > 0 ? r : 1));
  };
  const active = filtered.filter((s) => s.kind === 'active').sort((a, b) => toH(b) - toH(a));
  const passive = filtered.filter((s) => s.kind === 'passive').sort((a, b) => toH(b) - toH(a));

  let gross = 0, tax = 0, saved = 0;
  for (const s of active) {
    const g = toH(s);
    gross += g;
    tax += Math.round(g * (s.taxPct || 0) / 100);
    saved += Math.round(g * (s.savedPct || 0) / 100);
  }
  const passiveTotal = passive.reduce((sum, s) => sum + toH(s), 0);
  const expensesCents = view === 'shared' ? config.expensesShared : (config.expensesPersonal[ownerId] ?? 0);
  const coveragePct = expensesCents > 0 ? Math.round((passiveTotal / expensesCents) * 100) : 0;

  return {
    active, passive,
    activeGrossCents: gross,
    activeTaxCents: tax,
    activeSavedCents: saved,
    activeNetCents: gross - tax - saved,
    passiveTotalCents: passiveTotal,
    expensesCents,
    coveragePct,
    householdCurrency,
  };
}
