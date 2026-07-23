// Money Buddy 🤖 — the Hive's friendly money brain (CASH UPGRADE, design §4-5).
//
// Deposit categories: a small built-in set plus categories the FAMILY creates.
// Money Buddy suggests a category from the parent's note and REMEMBERS the
// choice: every confirmed deposit teaches it (note keywords → category), and
// most-used categories float to the front of the chip row.
//
// Deliberately deterministic (keyword learning, no LLM round-trip): instant,
// offline-safe, free, and predictable for kids and parents. Learned state
// lives on the family doc under hiveConfig:
//   depositCategories    — custom chips  [{ id: 'custom:school-snacks', emoji, label }]
//   depositCategoryHints — { keyword → categoryId } learned from notes
//   depositCategoryUsage — { categoryId → count } drives chip ordering

import type { HiveConfig, TxCategory } from './hive';

export interface DepositCategory {
  id: string;            // built-in TxCategory id, or 'custom:<slug>'
  emoji: string;
  label: string;
  /** The TxCategory actually written on the ledger row. Customs map to
   *  'other' — their label is preserved in the row description. */
  txCategory: TxCategory;
}

export const DEPOSIT_BUILTINS: DepositCategory[] = [
  { id: 'allowance', emoji: '💵', label: 'Allowance', txCategory: 'allowance' },
  { id: 'gift',      emoji: '🎁', label: 'Gift',      txCategory: 'gift' },
  { id: 'award',     emoji: '🏅', label: 'Reward',    txCategory: 'award' },
  { id: 'business',  emoji: '🌳', label: 'Business',  txCategory: 'business' },
  { id: 'other',     emoji: '✨', label: 'Other',     txCategory: 'other' },
];

/** Built-ins + the family's own categories, most-used first (stable within
 *  equal usage: built-in order, then customs by creation order). */
export function depositCategories(config: HiveConfig): DepositCategory[] {
  const customs: DepositCategory[] = (config.depositCategories || []).map((c) => ({
    id: c.id, emoji: c.emoji || '✨', label: c.label, txCategory: 'other' as TxCategory,
  }));
  const all = [...DEPOSIT_BUILTINS, ...customs];
  const usage = config.depositCategoryUsage || {};
  return all
    .map((c, i) => ({ c, i, n: usage[c.id] || 0 }))
    .sort((a, b) => (b.n - a.n) || (a.i - b.i))
    .map((x) => x.c);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'this', 'that', 'money', 'their',
  'kids', 'week', 'month', 'monthly', 'weekly', 'some', 'little', 'auntie', 'uncle',
]);

/** Salient lowercase tokens of a note — what Money Buddy learns from. */
export function noteTokens(note: string): string[] {
  return (note || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
    .slice(0, 8);
}

// First-run instincts, before the family has taught Money Buddy anything.
const HEURISTICS: Array<{ match: RegExp; id: string }> = [
  { match: /allowance|pocket\s*money|poket|posho/i,                     id: 'allowance' },
  { match: /birthday|gift|christmas|xmas|eid|holiday|present|zawadi/i,  id: 'gift' },
  { match: /reward|prize|well\s*done|congrats|bravo|good\s*(job|work)/i, id: 'award' },
  { match: /sale|sold|business|profit|customer|produce|biashara/i,      id: 'business' },
];

export interface DepositSuggestion {
  category: DepositCategory;
  /** true when this came from the family's own learned hints. */
  learned: boolean;
}

/** Suggest a category for a deposit note. Learned family hints win over the
 *  built-in instincts; returns null when Money Buddy has nothing useful. */
export function suggestDepositCategory(
  note: string,
  config: HiveConfig,
): DepositSuggestion | null {
  const cats = depositCategories(config);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const hints = config.depositCategoryHints || {};
  for (const token of noteTokens(note)) {
    const id = hints[token];
    const cat = id ? byId.get(id) : undefined;
    if (cat) return { category: cat, learned: true };
  }
  for (const h of HEURISTICS) {
    if (h.match.test(note || '')) {
      const cat = byId.get(h.id);
      if (cat && cat.id !== 'other') return { category: cat, learned: false };
    }
  }
  return null;
}

/** Slug for a new custom category, namespaced so it can never collide with a
 *  built-in TxCategory id. */
export function customCategoryId(label: string): string {
  return `custom:${label.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40)}`;
}

// ── Spend-side Money Buddy 🤖 (design screen E + §5) ──────────────
// Read-only instincts for the KID spend form: suggest the right category
// from the description, spot business costs, and cheer good choices.
// (No learning writes here — kids can't edit family config, by design.)

export type SpendSuggestion =
  | { kind: 'category'; id: TxCategory; emoji: string; label: string }
  | { kind: 'business' };

const SPEND_HEURISTICS: Array<{ match: RegExp; s: SpendSuggestion }> = [
  { match: /seed|seedling|fertili[sz]er|manure|feed|stock|supplies|inventory|packaging|mbegu/i,
    s: { kind: 'business' } },
  { match: /book|pencil|pen\b|notebook|school|exam|kitabu/i,
    s: { kind: 'category', id: 'books', emoji: '📚', label: 'Books' } },
  { match: /ice\s*cream|candy|sweet|soda|chips|snack|chocolate|cake|biscuit|pipi/i,
    s: { kind: 'category', id: 'treats', emoji: '🍦', label: 'Treats' } },
  { match: /donat|church|mosque|charity|help(ing)?\s|offering|sadaka/i,
    s: { kind: 'category', id: 'donation', emoji: '❤️', label: 'Donation' } },
];

export function suggestSpendCategory(desc: string): SpendSuggestion | null {
  for (const h of SPEND_HEURISTICS) {
    if (h.match.test(desc || '')) return h.s;
  }
  return null;
}

/** A friendly one-liner for the moment before sending the request. */
export function buddyCheer(category: TxCategory, isBusinessReinvest: boolean): string | null {
  if (isBusinessReinvest) return 'Nice one! Money into your business can come back as sales 🌱';
  switch (category) {
    case 'books':    return 'Books are brain-honey — great pick 📚🐝';
    case 'donation': return 'Giving back — that’s a big-heart move ❤️';
    case 'savings':  return 'Saving it? The bees approve 🐝';
    default:         return null;
  }
}

/** The hiveConfig patch that teaches Money Buddy from a confirmed deposit:
 *  note keywords → chosen category, plus a usage bump for chip ordering.
 *  Caller writes it via setHiveConfig (parent-only). */
export function learnDepositChoicePatch(
  note: string,
  categoryId: string,
  config: HiveConfig,
): Partial<HiveConfig> {
  const hints = { ...(config.depositCategoryHints || {}) };
  for (const token of noteTokens(note)) hints[token] = categoryId;
  const usage = { ...(config.depositCategoryUsage || {}) };
  usage[categoryId] = (usage[categoryId] || 0) + 1;
  return { depositCategoryHints: hints, depositCategoryUsage: usage };
}
