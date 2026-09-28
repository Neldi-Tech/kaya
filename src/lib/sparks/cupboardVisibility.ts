// Kaya Sparks · 🗄 Cupboard — who may see what (2026-09-28).
//
// Pure, server-safe rules the Cupboard gateway enforces, kept here so they
// are unit-tested (qa/cupboardVisibility.test.ts):
//   🔞 adultOnly    → parents always; a child only once they turn 18 (no
//                     birthday on file → stays hidden); helpers never.
//   🛒 shoppingList → parents and allow-listed helpers (the shoppers) only.

export const ADULT_AGE = 18;

export interface CupboardViewer {
  isParent: boolean;
  isHelper: boolean;
  /** The viewing child's id ('' for grown-ups). */
  childId: string;
  /** The viewing child's age in years, when a birthday is on file. */
  age?: number;
}

export function canSeeAdult(v: CupboardViewer): boolean {
  if (v.isParent) return true;
  return !!v.childId && v.age !== undefined && v.age >= ADULT_AGE;
}

export function canShop(v: CupboardViewer): boolean {
  return v.isParent || v.isHelper;
}

/** May this viewer see this item at all? */
export function visibleTo(v: CupboardViewer, t: { adultOnly?: unknown; shoppingList?: unknown }): boolean {
  if (t.adultOnly === true && !canSeeAdult(v)) return false;
  if (t.shoppingList === true && !canShop(v)) return false;
  return true;
}

/** May an adults-only title be given / lent to this child? */
export function adultOkForChild(age: number | undefined): boolean {
  return age !== undefined && age >= ADULT_AGE;
}
