// Kaya Wellness — age + gender gating engine (pure, no React/Firestore).
// Rule: age + parent decide WHETHER a section shows; gender only TUNES content inside it.

export type Tier = "junior" | "teen" | "teen15" | "adult";
export type TierDefault = "on" | "gate" | "na";
export type GenderTrack = "girls" | "boys" | "all";
export type GateMode = "off" | "now" | "age";
export interface GateConfig { mode: GateMode; age?: number }
export type ChildGates = Record<string, GateConfig>; // sectionId -> config

export function tierForAge(age: number | null): Tier {
  if (age == null) return "teen"; // unknown → safest non-junior default (no weight, gated content off)
  if (age < 12) return "junior";
  if (age < 15) return "teen";
  if (age < 18) return "teen15";
  return "adult";
}

export function tierLabel(t: Tier): string {
  return t === "junior" ? "Junior" : t === "teen" ? "Teen" : t === "teen15" ? "Teen 15+" : "Adult";
}

// Compute age in LOCAL time from a YYYY-MM-DD birthday (per Kaya date rules).
export function ageFromBirthday(birthday?: string): number | null {
  if (!birthday) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return null;
  const by = +m[1], bm = +m[2], bd = +m[3];
  const now = new Date();
  let age = now.getFullYear() - by;
  const beforeBirthday = now.getMonth() + 1 < bm || (now.getMonth() + 1 === bm && now.getDate() < bd);
  if (beforeBirthday) age--;
  return age < 0 || age > 120 ? null : age;
}

export function genderTrack(gender?: string): GenderTrack {
  if (gender === "female") return "girls";
  if (gender === "male") return "boys";
  return "all"; // other / unspecified / undefined → inclusive neutral
}

export interface Section {
  id: string;
  emoji: string;
  label: string;
  alwaysOn?: boolean;       // basics — every tier, can't be turned off
  gendered?: boolean;       // content has girls/boys/all variants
  girlsOnly?: boolean;      // section itself only offered to the girls track
  hardFloorAge?: number;    // cannot be enabled below this age, ever
  tiers: Record<Tier, TierDefault>;
}

// The contract from the approved matrix.
export const SECTIONS: Section[] = [
  { id: "move",    emoji: "🏃", label: "Movement",        alwaysOn: true,  tiers: { junior: "on", teen: "on", teen15: "on", adult: "on" } },
  { id: "sleep",   emoji: "😴", label: "Sleep",            alwaysOn: true,  tiers: { junior: "on", teen: "on", teen15: "on", adult: "on" } },
  { id: "mood",    emoji: "🙂", label: "Mood check-in",    alwaysOn: true,  tiers: { junior: "on", teen: "on", teen15: "on", adult: "on" } },
  { id: "hydrate", emoji: "💧", label: "Hydration",        alwaysOn: true,  tiers: { junior: "on", teen: "on", teen15: "on", adult: "on" } },
  { id: "breathe", emoji: "🌬️", label: "Breathe / calm",   alwaysOn: true,  tiers: { junior: "on", teen: "on", teen15: "on", adult: "on" } },
  { id: "body",    emoji: "🌱", label: "Body changes",     gendered: true,  tiers: { junior: "na", teen: "gate", teen15: "gate", adult: "na" } },
  { id: "weight",  emoji: "⚖️", label: "Weight Management", hardFloorAge: 15, tiers: { junior: "na", teen: "na", teen15: "gate", adult: "on" } },
  { id: "strength",emoji: "💪", label: "Strength / programs", tiers: { junior: "na", teen: "gate", teen15: "gate", adult: "on" } },
  { id: "cycle",   emoji: "🩸", label: "Cycle health",     gendered: true, girlsOnly: true, tiers: { junior: "na", teen: "gate", teen15: "gate", adult: "on" } },
  { id: "community", emoji: "👥", label: "Community",       tiers: { junior: "na", teen: "gate", teen15: "gate", adult: "on" } },
];

// Sections a parent actually configures (gated, non-basic).
export const PARENT_GATEABLE = SECTIONS.filter(
  (s) => !s.alwaysOn && (s.tiers.teen === "gate" || s.tiers.teen15 === "gate")
);

export type AccessState =
  | { state: "on" }
  | { state: "locked"; reason: string }
  | { state: "hidden" };

// Resolve whether a kid of `age`/`tier` can currently see a section, given parent gates.
export function resolveAccess(
  section: Section,
  tier: Tier,
  age: number | null,
  gate: GateConfig | undefined,
  track: GenderTrack
): AccessState {
  if (section.alwaysOn) return { state: "on" };
  if (tier === "adult") return { state: "on" };
  if (section.girlsOnly && track !== "girls") return { state: "hidden" };

  const def = section.tiers[tier];
  if (def === "na") return { state: "hidden" };
  if (def === "on") return { state: "on" };

  // def === "gate"
  if (section.hardFloorAge != null && (age == null || age < section.hardFloorAge)) {
    return { state: "locked", reason: `Unlocks at ${section.hardFloorAge}` };
  }
  const g = gate ?? { mode: "off" as GateMode };
  if (g.mode === "now") return { state: "on" };
  if (g.mode === "age") {
    const at = g.age ?? section.hardFloorAge ?? 13;
    if (age != null && age >= at) return { state: "on" };
    return { state: "locked", reason: `Unlocks at ${at}` };
  }
  return { state: "locked", reason: "Ask a parent" }; // off
}

// Is a minor (under 18) — used to suppress body-fat % and over/under labels.
export function isMinor(age: number | null): boolean {
  return age == null ? true : age < 18;
}

// The lowest age a parent may set for a section's "allow at age" (respects hard floors).
export function minGateAge(section: Section): number {
  return section.hardFloorAge ?? 10;
}
