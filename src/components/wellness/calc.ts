// Kaya Wellness — Weight Management "Kaya calculates" engine.
// Profile (height/age/gender) will come from the user's account in phase 2;
// sensible defaults for the personal-first MVP.
export const PROFILE = { heightM: 1.78, age: 38, gender: "male" as "male" | "female" };
export const GOAL_KG = 76.0;

export function bmi(weightKg: number, heightM = PROFILE.heightM) {
  return weightKg / (heightM * heightM);
}
export function bmiBand(b: number) {
  if (b < 18.5) return { label: "Underweight", cls: "over" as const };
  if (b < 25) return { label: "Healthy range", cls: "normal" as const };
  if (b < 30) return { label: "Slightly over", cls: "over" as const };
  return { label: "Over", cls: "over" as const };
}
// Deurenberg BMI-based body-fat estimate (no calipers needed).
export function bodyFatPct(weightKg: number) {
  const sex = PROFILE.gender === "male" ? 1 : 0;
  return Math.max(4, 1.2 * bmi(weightKg) + 0.23 * PROFILE.age - 10.8 * sex - 5.4);
}
export function weeklyPace(weights: number[]) {
  if (weights.length < 2) return 0;
  return ((weights[0] - weights[weights.length - 1]) / weights.length) * 7;
}
export function weeksToGoal(current: number, pace: number) {
  const toGo = current - GOAL_KG;
  if (toGo <= 0) return 0;
  if (pace <= 0) return null;
  return Math.ceil(toGo / pace);
}
export function aiAnalysis(weights: number[], streak: number) {
  const cur = weights[weights.length - 1];
  const diff = weights[0] - cur;
  const pace = weeklyPace(weights);
  const wks = weeksToGoal(cur, pace);
  if (cur <= GOAL_KG) {
    return `Goal reached 🎉 You're at or below ${GOAL_KG} kg. Shift to maintenance — hold this range and keep protein high.`;
  }
  const paceWord = Math.abs(pace) <= 0.9 ? "an ideal" : "a brisk";
  const eta = wks == null ? "—" : `~${wks} weeks`;
  return `Steady progress. Down ${diff.toFixed(1)} kg over ${weights.length} entries — about ${Math.abs(
    pace
  ).toFixed(1)} kg/week, ${paceWord} fat-loss pace. At this rate you'll hit ${GOAL_KG} kg in ${eta}. Logging streak ${streak} days.`;
}
export const SEED_WEIGHTS = [
  84.0, 83.7, 83.5, 83.2, 83.4, 82.9, 82.6, 82.4, 82.5, 82.1, 81.9, 81.7, 81.8, 81.5, 81.4,
];
