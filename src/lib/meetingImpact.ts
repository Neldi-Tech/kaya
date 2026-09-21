// 📊 "What it changes" — the pure math behind the Impact pop-up (Sunday
// Meeting upgrade · PR5 · approved design v2, 21-Sep-2026 · S10/S11/S16 · R17).
//
// After a meeting award is proposed (kid) or given (parent) the family sees,
// for the child receiving it: Last 7 days now → new, This month now → new,
// the place it moves them to, and the gap to the next place — so every kid
// can SEE why the points matter. Same House-Points formula as the Points
// tab: HP = floor(routine pts ÷ rate) + bonus HP, per window.
//
// Honest by construction (F7): it counts ONLY the award(s) in hand, and the
// real leaderboard is never touched — this is a projection.

export interface KidTotals { childId: string; name: string; emoji: string; routinePts: number; bonusHp: number }

export interface ImpactWindow {
  now: number;
  next: number;
  rankNow: number;
  rankNext: number;
  of: number;
  /** One short, true line: who they pass, or the gap that changed. */
  note: string;
  moved: boolean;
}

export interface ImpactRow { childId: string; name: string; emoji: string; points: number; week: ImpactWindow; month: ImpactWindow }

const first = (n: string) => (n || '').split(' ')[0];

function hpOf(t: KidTotals, ppHP: number, extra = 0): number {
  return Math.floor(t.routinePts / Math.max(1, ppHP)) + t.bonusHp + extra;
}

/** Competition ranking (1,1,3): a tie shares the place, like the podium. */
function rankOf(id: string, hp: Map<string, number>): number {
  const mine = hp.get(id) ?? 0;
  let r = 1;
  for (const [k, v] of hp) if (k !== id && v > mine) r += 1;
  return r;
}

function windowImpact(childId: string, totals: KidTotals[], ppHP: number, grants: Map<string, number>): ImpactWindow {
  const before = new Map(totals.map((t) => [t.childId, hpOf(t, ppHP)]));
  const after = new Map(totals.map((t) => [t.childId, hpOf(t, ppHP, grants.get(t.childId) || 0)]));
  const now = before.get(childId) ?? 0;
  const next = after.get(childId) ?? 0;
  const rankNow = rankOf(childId, before);
  const rankNext = rankOf(childId, after);
  const nameOf = (id: string) => first(totals.find((t) => t.childId === id)?.name || '');

  let note = '';
  if (rankNext < rankNow) {
    // Who they were behind and are now level with or ahead of — name the best of them.
    const passed = totals
      .filter((t) => t.childId !== childId && (before.get(t.childId) ?? 0) > now && (after.get(t.childId) ?? 0) <= next)
      .sort((a, b) => (after.get(b.childId) ?? 0) - (after.get(a.childId) ?? 0))[0];
    if (passed) {
      const theirs = after.get(passed.childId) ?? 0;
      note = theirs === next ? `level with ${first(passed.name)} (${theirs})` : `passes ${first(passed.name)} (${theirs})`;
    }
  } else if (rankNext === 1) {
    const runner = totals.filter((t) => t.childId !== childId).sort((a, b) => (after.get(b.childId) ?? 0) - (after.get(a.childId) ?? 0))[0];
    if (runner) {
      const lead = next - (after.get(runner.childId) ?? 0);
      note = lead > 0 ? `${lead} ahead of ${first(runner.name)}` : `level with ${first(runner.name)}`;
    }
  } else {
    // Same place — the most useful true thing is the gap to the place above.
    const above = totals
      .filter((t) => t.childId !== childId && (after.get(t.childId) ?? 0) > next)
      .sort((a, b) => (after.get(a.childId) ?? 0) - (after.get(b.childId) ?? 0))[0];
    if (above) {
      const gapNow = (before.get(above.childId) ?? 0) - now;
      const gapNext = (after.get(above.childId) ?? 0) - next;
      note = gapNow === gapNext ? `${gapNext} behind ${nameOf(above.childId)}` : `gap to ${nameOf(above.childId)}: ${gapNow} → ${gapNext}`;
    }
  }
  return { now, next, rankNow, rankNext, of: totals.length, note, moved: rankNext !== rankNow };
}

/** One row per child receiving points. A bundle (whole podium) is applied all at once. */
export function computeImpact(o: {
  grants: Array<{ childId: string; points: number }>;
  week: KidTotals[];
  month: KidTotals[];
  pointsPerHousePoint: number;
}): ImpactRow[] {
  const grants = new Map<string, number>();
  for (const g of o.grants) grants.set(g.childId, (grants.get(g.childId) || 0) + g.points);
  return Array.from(grants.entries()).map(([childId, points]) => {
    const who = o.week.find((t) => t.childId === childId) || o.month.find((t) => t.childId === childId);
    return {
      childId, points, name: who?.name || '', emoji: who?.emoji || '🧒',
      week: windowImpact(childId, o.week, o.pointsPerHousePoint, grants),
      month: windowImpact(childId, o.month, o.pointsPerHousePoint, grants),
    };
  });
}

/** "5 points just changed who leads the month." — only when it is true. */
export function impactHeadline(rows: ImpactRow[]): string {
  const total = rows.reduce((s, r) => s + r.points, 0);
  const ledMonth = rows.find((r) => r.month.moved && r.month.rankNext === 1);
  if (ledMonth) return `✨ ${total} point${total === 1 ? '' : 's'} just changed who leads the month.`;
  const ledWeek = rows.find((r) => r.week.moved && r.week.rankNext === 1);
  if (ledWeek) return `✨ ${total} point${total === 1 ? '' : 's'} just changed who leads the week.`;
  if (rows.some((r) => r.week.moved || r.month.moved)) return '✨ A few points just moved the table.';
  return '';
}

/** For the bundle variant: the closest race at the top of the month, after the awards. */
export function monthRaceLine(month: KidTotals[], ppHP: number, grants: Array<{ childId: string; points: number }>): string {
  const g = new Map<string, number>();
  for (const x of grants) g.set(x.childId, (g.get(x.childId) || 0) + x.points);
  const sorted = month.map((t) => ({ t, hp: hpOf(t, ppHP, g.get(t.childId) || 0) })).sort((a, b) => b.hp - a.hp);
  if (sorted.length < 2) return '';
  const gap = sorted[0].hp - sorted[1].hp;
  if (gap === 0) return `Month race: ${first(sorted[0].t.name)} and ${first(sorted[1].t.name)} are level.`;
  return `Month race: ${first(sorted[1].t.name)} is ${gap <= 5 ? 'only ' : ''}${gap} behind ${first(sorted[0].t.name)}.`;
}
