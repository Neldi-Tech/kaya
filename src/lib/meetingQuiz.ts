// 🎓 Learn & Grow memory-check quiz (SM3.1 · #4a) — pure builders.
//
// The questions are DETERMINISTIC — built from the kid's actual window data,
// so the answers are already known and nothing depends on AI to be correct.
// The /api/meetings/behaviour-quiz route only REPHRASES the wording warmly;
// when it's unavailable these template texts show as-is.
//
// How many questions? Proportional to the Bads (Elia 2026-07-04):
//   0 Bads → no quiz (a 🎉 clean-week celebration instead)
//   1–2   → 1 question · 3–4 → 2 · 5+ → 3 (hard cap — a game, not a drill)
//   formula: min(3, ceil(bads / 2))
// The LAST question is always positive-framed so the game ends looking up.

import type { DayScore } from '@/lib/meetingReview';

export interface QuizQuestion {
  kind: 'tricky-routine' | 'tough-day' | 'strong-routine';
  q: string;
  options: string[];
  correctIndex: number;
  explain: string;          // shown after answering — warm, factual
}

export function quizCountForBads(bads: number): number {
  if (bads <= 0) return 0;
  return Math.min(3, Math.ceil(bads / 2));
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return yyyyMmDd;
  return `${DAY_ABBR[new Date(y, m - 1, d).getDay()]} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${y}`;
}

/** Fisher–Yates on a copy; returns the shuffled options + where the correct
 *  answer landed. Math.random is fine here — questions stay correct because
 *  correctIndex tracks the answer through the shuffle. */
function shuffleWithAnswer(correct: string, distractors: string[]): { options: string[]; correctIndex: number } {
  const options = [correct, ...distractors];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, correctIndex: options.indexOf(correct) };
}

/** Build up to `count` questions for one kid from their window day-scores.
 *  Questions that can't be built fairly (not enough distinct routines/days)
 *  are simply skipped — the quiz shrinks rather than asking a bad question. */
export function buildKidQuiz(
  kidName: string,
  kidDayScores: DayScore[],
  routineNameById: Map<string, string>,
  count: number,
): QuizQuestion[] {
  if (count <= 0 || kidDayScores.length === 0) return [];

  // Per-routine tallies across the window.
  const badByRoutine = new Map<string, number>();
  const excellentByRoutine = new Map<string, number>();
  const ratedRoutineIds = new Set<string>();
  let worstDay: DayScore | null = null;
  for (const ds of kidDayScores) {
    for (const id of ds.badRoutineIds) {
      badByRoutine.set(id, (badByRoutine.get(id) || 0) + 1);
      ratedRoutineIds.add(id);
    }
    for (const id of ds.excellentRoutineIds) {
      excellentByRoutine.set(id, (excellentByRoutine.get(id) || 0) + 1);
      ratedRoutineIds.add(id);
    }
    const isWorse = !worstDay
      || ds.badCount > worstDay.badCount
      || (ds.badCount === worstDay.badCount && ds.excellentCount < worstDay.excellentCount);
    if (isWorse) worstDay = ds;
  }

  const nameOf = (id: string) => routineNameById.get(id) || id;
  const routinePool = Array.from(ratedRoutineIds);
  const pickRoutineDistractors = (excludeId: string, n: number): string[] =>
    routinePool.filter((id) => id !== excludeId).slice(0, 8)
      .sort(() => Math.random() - 0.5)
      .slice(0, n)
      .map(nameOf);

  const out: QuizQuestion[] = [];

  // Q · tricky-routine — anchored to the most-Bad routine.
  const worstRoutineId = Array.from(badByRoutine.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (worstRoutineId) {
    const distractors = pickRoutineDistractors(worstRoutineId, 2);
    if (distractors.length === 2) {
      const { options, correctIndex } = shuffleWithAnswer(nameOf(worstRoutineId), distractors);
      out.push({
        kind: 'tricky-routine',
        q: `Which routine was the trickiest for ${kidName} this window?`,
        options,
        correctIndex,
        explain: `${nameOf(worstRoutineId)} slipped ${badByRoutine.get(worstRoutineId)}× — let's look at it together.`,
      });
    }
  }

  // Q · tough-day — anchored to the worst day (needs ≥3 distinct days).
  const dayPool = kidDayScores.map((d) => d.date);
  if (worstDay && worstDay.badCount > 0 && dayPool.length >= 3) {
    const others = dayPool.filter((d) => d !== worstDay!.date)
      .sort(() => Math.random() - 0.5).slice(0, 2).map(fmtDay);
    if (others.length === 2) {
      const { options, correctIndex } = shuffleWithAnswer(fmtDay(worstDay.date), others);
      out.push({
        kind: 'tough-day',
        q: `Which day was the toughest one this window?`,
        options,
        correctIndex,
        explain: `${fmtDay(worstDay.date)} had ${worstDay.badCount} Bad${worstDay.badCount === 1 ? '' : 's'} — and still ${worstDay.excellentCount} Excellent${worstDay.excellentCount === 1 ? '' : 's'} 👏`,
      });
    }
  }

  // Q · strong-routine (ALWAYS LAST — the game ends looking up).
  const bestRoutineId = Array.from(excellentByRoutine.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (bestRoutineId) {
    const distractors = pickRoutineDistractors(bestRoutineId, 2);
    if (distractors.length === 2) {
      const { options, correctIndex } = shuffleWithAnswer(nameOf(bestRoutineId), distractors);
      out.push({
        kind: 'strong-routine',
        q: `And the bright side — which routine went BEST for ${kidName}?`,
        options,
        correctIndex,
        explain: `${nameOf(bestRoutineId)} earned ${excellentByRoutine.get(bestRoutineId)} Excellents — keep that one shining 🌟`,
      });
    }
  }

  // Order + trim: tricky first, positive last, tough-day in between.
  const order: QuizQuestion['kind'][] = count >= 3
    ? ['tricky-routine', 'tough-day', 'strong-routine']
    : count === 2 ? ['tricky-routine', 'strong-routine'] : ['tricky-routine'];
  const byKind = new Map(out.map((q) => [q.kind, q]));
  return order.map((k) => byKind.get(k)).filter(Boolean) as QuizQuestion[];
}
