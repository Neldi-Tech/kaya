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

/* ---------- Projection: 3 pace plans, grounded in real history ---------- */
export type TierKey = "aggressive" | "steady" | "relaxed";
export interface PaceTier {
  key: TierKey; name: string; emoji: string; ratePerWk: number;
  weeks: number | null; deficit: string; sessions: string; note: string; tag: "hard" | "rec" | "easy";
}
// Safe ranges: ~0.25–1.0 kg/week. Recommended middle tier = "Steady".
export function paceTiers(current: number | null, goalKg?: number): PaceTier[] {
  const toGo = current != null && goalKg != null ? current - goalKg : null;
  const weeksFor = (rate: number): number | null => {
    if (toGo == null) return null;
    if (toGo <= 0) return 0;
    return Math.ceil(toGo / rate);
  };
  return [
    { key: "aggressive", name: "Aggressive", emoji: "🔥", ratePerWk: 0.9, weeks: weeksFor(0.9), deficit: "~−650 kcal/day", sessions: "5–6 / week", note: "Strict diet · hardest to sustain", tag: "hard" },
    { key: "steady", name: "Steady", emoji: "🌿", ratePerWk: 0.5, weeks: weeksFor(0.5), deficit: "~−400 kcal/day", sessions: "4 / week", note: "Moderate · most sustainable", tag: "rec" },
    { key: "relaxed", name: "Relaxed", emoji: "🍃", ratePerWk: 0.3, weeks: weeksFor(0.3), deficit: "~−250 kcal/day", sessions: "3 / week", note: "Gentle habits · easiest to keep", tag: "easy" },
  ];
}
export function goalDateLabel(weeks: number | null, now: Date = new Date()): string | null {
  if (weeks == null) return null;
  if (weeks === 0) return "now 🎉";
  const d = new Date(now);
  d.setDate(d.getDate() + weeks * 7);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
// Real pace (kg/week, positive = losing) from dated entries over the last `days`.
export function actualPaceKgPerWk(log: { date: string; kg: number }[], days = 90): number | null {
  if (log.length < 2) return null;
  const sorted = [...log].sort((a, b) => (a.date < b.date ? -1 : 1));
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const recent = sorted.filter((e) => new Date(e.date) >= cutoff);
  const use = recent.length >= 2 ? recent : sorted;
  const first = use[0], last = use[use.length - 1];
  const dDays = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000;
  if (dDays <= 0) return null;
  return ((first.kg - last.kg) / dDays) * 7;
}
export function recommendTier(actual: number | null): TierKey {
  if (actual == null) return "steady";
  const a = Math.abs(actual);
  if (a >= 0.75) return "aggressive";
  if (a >= 0.4) return "steady";
  return "relaxed";
}

/* ---------- Better-app CSV import ---------- */
export interface ImportedEntry { date: string; kg: number; bodyFat?: number; note?: string }
export interface ParseResult { entries: ImportedEntry[]; total: number; skipped: number; lbConverted: number; inferredHeightCm: number | null }
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { q = !q; continue; }
    if (ch === delim && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
export function parseBetterCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { entries: [], total: 0, skipped: 0, lbConverted: 0, inferredHeightCm: null };
  const delim = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const di = header.findIndex((h) => h.startsWith("date"));
  const wi = header.findIndex((h) => h.includes("weight"));
  const bmiI = header.findIndex((h) => h === "bmi" || h.startsWith("bmi"));
  const bfi = header.findIndex((h) => h.includes("body fat") || h.includes("body fat (%)") || h.includes("bodyfat"));
  const ni = header.findIndex((h) => h === "note" || h.startsWith("note"));
  const isLb = wi >= 0 && header[wi].includes("lb");
  let skipped = 0, lbConverted = 0, inferredHeightCm: number | null = null;
  const seen = new Set<string>(); const entries: ImportedEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i], delim);
    const date = (c[di] || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    let kg = parseFloat((c[wi] || "").replace(",", "."));
    if (isNaN(kg) || kg <= 0) { skipped++; continue; }
    if (isLb) { kg = kg * 0.453592; lbConverted++; }
    if (seen.has(date)) { skipped++; continue; }
    seen.add(date);
    if (inferredHeightCm == null && bmiI >= 0) {
      const bmiVal = parseFloat((c[bmiI] || "").replace(",", "."));
      if (!isNaN(bmiVal) && bmiVal > 0) inferredHeightCm = Math.round(100 * Math.sqrt(kg / bmiVal));
    }
    const bfRaw = bfi >= 0 ? parseFloat((c[bfi] || "").replace(",", ".")) : NaN;
    const bodyFat = !isNaN(bfRaw) && bfRaw > 0 ? bfRaw : undefined;
    const note = ni >= 0 ? (c[ni] || "").trim() || undefined : undefined;
    entries.push({ date, kg: Math.round(kg * 10) / 10, bodyFat, note });
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { entries, total: entries.length, skipped, lbConverted, inferredHeightCm };
}
