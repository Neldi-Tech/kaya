// Kaya Games — Math Dash problem generator (pure; shared by the solo game AND
// the multi-device race, so every phone in a race plays the same problem bank).

export interface MathProblem { text: string; answer: number; choices: number[] }

export const MATH_DASH_SECONDS = 45;

export function makeProblem(): MathProblem {
  const op = Math.random() < 0.5 ? '+' : '-';
  let a = 1 + Math.floor(Math.random() * 12);
  let b = 1 + Math.floor(Math.random() * 12);
  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : a - b;
  const choices = new Set<number>([answer]);
  while (choices.size < 4) {
    const d = answer + (Math.floor(Math.random() * 7) - 3);
    if (d >= 0 && d !== answer) choices.add(d);
  }
  const arr = [...choices];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { text: `${a} ${op} ${b}`, answer, choices: arr };
}

/** A fixed bank of problems so every device in a race plays the SAME set. */
export function makeProblems(n: number): MathProblem[] {
  return Array.from({ length: Math.max(1, n) }, () => makeProblem());
}
