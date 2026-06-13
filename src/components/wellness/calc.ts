// Kaya Wellness — Weight Management "Kaya calculates" engine.
// All calcs are driven by the user's own profile (height/age/gender) — never hardcoded.
// Until the profile + at least one weight exist, callers show empty/setup states.

export type Gender = "woman" | "man" | "nb";
export interface WellnessProfile {
  heightCm?: number;
  age?: number;
  gender?: Gender;
  goalKg?: number;
}

export function bmi(weightKg: number, heightCm: number) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}
export function bmiBand(b: number) {
  if (b < 18.5) return { label: "Underweight", cls: "over" as const };
  if (b < 25) return { label: "Healthy range", cls: "normal" as const };
  if (b < 30) return { label: "Slightly over", cls: "over" as const };
  return { label: "Over", cls: "over" as const };
}
// Deurenberg BMI-based body-fat estimate. Needs age + gender + height — returns null otherwise.
export function bodyFatPct(weightKg: number, p: WellnessProfile): number | null {
  if (!p.heightCm || !p.age || !p.gender || p.gender === "nb") return null;
  const sex = p.gender === "man" ? 1 : 0;
  return Math.max(4, 1.2 * bmi(weightKg, p.heightCm) + 0.23 * p.age - 10.8 * sex - 5.4);
}
export function weeklyPace(weights: number[]) {
  if (weights.length < 2) return 0;
  return ((weights[0] - weights[weights.length - 1]) / weights.length) * 7;
}
export function weeksToGoal(current: number, pace: number, goalKg?: number) {
  if (!goalKg) return null;
  const toGo = current - goalKg;
  if (toGo <= 0) return 0;
  if (pace <= 0) return null;
  return Math.ceil(toGo / pace);
}
export function aiAnalysis(weights: number[], streak: number, p: WellnessProfile): string {
  if (weights.length === 0) {
    return "Log your weight for a few days and Kaya will spot the trend, estimate your pace, and project your goal date.";
  }
  if (weights.length < 3) {
    return `Nice start — ${weights.length} ${weights.length === 1 ? "entry" : "entries"} logged. Keep going for a few days and a clear trend + pace will appear here.`;
  }
  const cur = weights[weights.length - 1];
  const diff = weights[0] - cur;
  const pace = weeklyPace(weights);
  const goal = p.goalKg;
  if (goal && cur <= goal) {
    return `Goal reached 🎉 You're at or below ${goal} kg. Shift to maintenance — hold this range and keep protein high.`;
  }
  const wks = weeksToGoal(cur, pace, goal);
  const paceWord = Math.abs(pace) <= 0.9 ? "an ideal" : "a brisk";
  const dir = diff >= 0 ? "Down" : "Up";
  const goalBit = goal ? ` At this rate you'll hit ${goal} kg in ${wks == null ? "—" : `~${wks} weeks`}.` : ` Set a goal weight to see a projected date.`;
  return `${dir} ${Math.abs(diff).toFixed(1)} kg over ${weights.length} entries — about ${Math.abs(pace).toFixed(1)} kg/week, ${paceWord} pace.${goalBit} Logging streak ${streak} ${streak === 1 ? "day" : "days"}.`;
}
