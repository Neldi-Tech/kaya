"use client";
import { createContext, useContext, useState, ReactNode } from "react";
import type { Gender, WellnessProfile } from "./calc";
import type { ChildGates, GateConfig } from "./gating";

export interface Goal {
  wish: string; tiny: string; pill: string; pcol: string;
  streak: number; todayDone: boolean; cheers: number; target: number;
}
export type Period = "morning" | "evening";
export interface WeightEntry { date: string; kg: number; bodyFat?: number; note?: string }
export interface MoodEntry { date: string; level: number; period: Period }
export interface GymEntry { date: string; place: "gym" | "home" | "rest"; type: string; period: Period; details?: string }
export interface Sport { id: string; name: string; emoji: string; venue: string; days: string[]; time: string; myDay: boolean; email: boolean }
export interface HomeCard { id: string; label: string; on: boolean }

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface WellnessState {
  profile: WellnessProfile;
  setProfile: (p: WellnessProfile) => void;
  profileReady: boolean;
  weights: number[];          // derived, oldest→newest (kg only) — back-compat
  weightLog: WeightEntry[];   // dated entries, oldest→newest
  logWeight: (w: number) => void;
  importWeights: (entries: WeightEntry[]) => void;
  weightStreak: number;
  ritualStreak: number;
  bumpRitualStreak: () => void;
  goals: Goal[];
  setGoals: (g: Goal[] | ((prev: Goal[]) => Goal[])) => void;
  addGoal: (g: Goal) => void;
  programStarted: boolean;
  startProgram: () => void;
  gatesByChild: Record<string, ChildGates>;
  gatesFor: (childId: string) => ChildGates;
  setGate: (childId: string, sectionId: string, cfg: GateConfig) => void;
  // v2: logging + sports + home prefs (local until persistence PR)
  moods: MoodEntry[];
  logMood: (level: number, period: Period, date?: string) => void;
  gymLogs: GymEntry[];
  logGym: (e: GymEntry) => void;
  recordDays: string[];           // weekday short names the user wants reminded
  setRecordDays: (d: string[]) => void;
  sports: Sport[];
  addSport: (s: Sport) => void;
  removeSport: (id: string) => void;
  homeCards: HomeCard[];
  toggleHomeCard: (id: string) => void;
  activityStreak: number;         // consecutive days with any gym log / done goal
}

const Ctx = createContext<WellnessState | null>(null);

const STARTER_GOALS: Goal[] = [
  { wish: "Daily movement", tiny: "Just 20 minutes today", pill: "⚡", pcol: "#1FB6A6", streak: 0, todayDone: false, cheers: 0, target: 7 },
  { wish: "Hydrate", tiny: "First glass of water on waking", pill: "💧", pcol: "#F9A826", streak: 0, todayDone: false, cheers: 0, target: 7 },
  { wish: "Calmer evenings", tiny: "3 deep breaths before bed", pill: "🧘", pcol: "#FF6B6B", streak: 0, todayDone: false, cheers: 0, target: 7 },
];

const DEFAULT_HOME_CARDS: HomeCard[] = [
  { id: "spark", label: "✨ Daily Spark", on: true },
  { id: "streak", label: "🔥 Streak & momentum", on: true },
  { id: "goals", label: "🎯 Goals for today", on: true },
  { id: "gymlog", label: "🏋️ Gym log", on: true },
  { id: "sports", label: "🎾 Sports today", on: true },
  { id: "weight", label: "⚖️ Weight snapshot", on: false },
  { id: "news", label: "📰 Sports news", on: false },
];

export function WellnessProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<WellnessProfile>({});
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([]);
  const [ritualStreak, setRitualStreak] = useState(0);
  const [goals, setGoals] = useState<Goal[]>(STARTER_GOALS);
  const [programStarted, setProgramStarted] = useState(false);
  const [gatesByChild, setGatesByChild] = useState<Record<string, ChildGates>>({});
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [gymLogs, setGymLogs] = useState<GymEntry[]>([]);
  const [recordDays, setRecordDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [homeCards, setHomeCards] = useState<HomeCard[]>(DEFAULT_HOME_CARDS);

  const gatesFor = (childId: string) => gatesByChild[childId] ?? {};
  const setGate = (childId: string, sectionId: string, cfg: GateConfig) =>
    setGatesByChild((prev) => ({ ...prev, [childId]: { ...(prev[childId] ?? {}), [sectionId]: cfg } }));

  const sortLog = (l: WeightEntry[]) => [...l].sort((a, b) => (a.date < b.date ? -1 : 1));
  const logWeight = (w: number) => setWeightLog((prev) => {
    const today = todayStr();
    return sortLog([...prev.filter((e) => e.date !== today), { date: today, kg: w }]);
  });
  const importWeights = (entries: WeightEntry[]) => setWeightLog((prev) => {
    const byDate = new Map(prev.map((e) => [e.date, e]));
    for (const e of entries) byDate.set(e.date, { ...byDate.get(e.date), ...e });
    return sortLog([...byDate.values()]);
  });
  const weights = weightLog.map((e) => e.kg);
  const addGoal = (g: Goal) => setGoals((prev) => [...prev, g]);
  const logMood = (level: number, period: Period, date = todayStr()) =>
    setMoods((prev) => [{ date, level, period }, ...prev.filter((m) => !(m.date === date && m.period === period))]);
  const logGym = (e: GymEntry) => setGymLogs((prev) => [e, ...prev.filter((g) => g.date !== e.date)]);
  const toggleHomeCard = (id: string) => setHomeCards((prev) => prev.map((c) => (c.id === id ? { ...c, on: !c.on } : c)));
  const addSport = (s: Sport) => setSports((prev) => [...prev, s]);
  const removeSport = (id: string) => setSports((prev) => prev.filter((s) => s.id !== id));

  const profileReady = !!(profile.heightCm && profile.age && profile.gender);

  // Activity streak: count back from today over days that have a non-rest gym log or a done goal today.
  const loggedDays = new Set(gymLogs.filter((g) => g.place !== "rest").map((g) => g.date));
  let activityStreak = 0;
  const cur = new Date();
  for (let i = 0; i < 60; i++) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    const active = loggedDays.has(ds) || (i === 0 && goals.some((g) => g.todayDone));
    if (active) activityStreak++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 1);
  }

  // Weight streak: consecutive days up to today with a logged weight.
  const weighDays = new Set(weightLog.map((e) => e.date));
  let weightStreak = 0;
  const wc = new Date();
  for (let i = 0; i < 400; i++) {
    const ds = `${wc.getFullYear()}-${String(wc.getMonth() + 1).padStart(2, "0")}-${String(wc.getDate()).padStart(2, "0")}`;
    if (weighDays.has(ds)) weightStreak++;
    else if (i > 0) break;
    wc.setDate(wc.getDate() - 1);
  }

  return (
    <Ctx.Provider value={{
      profile, setProfile, profileReady,
      weights, weightLog, logWeight, importWeights, weightStreak,
      ritualStreak, bumpRitualStreak: () => setRitualStreak((s) => s + 1),
      goals, setGoals, addGoal,
      programStarted, startProgram: () => setProgramStarted(true),
      gatesByChild, gatesFor, setGate,
      moods, logMood, gymLogs, logGym, recordDays, setRecordDays,
      sports, addSport, removeSport, homeCards, toggleHomeCard, activityStreak,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWellness() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWellness must be used within WellnessProvider");
  return c;
}

export type { Gender };
