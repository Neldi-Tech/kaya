"use client";
import { createContext, useContext, useState, ReactNode } from "react";
import type { Gender, WellnessProfile } from "./calc";
import type { ChildGates, GateConfig } from "./gating";

export interface Goal {
  wish: string; tiny: string; pill: string; pcol: string;
  streak: number; todayDone: boolean; cheers: number; target: number;
}

interface WellnessState {
  profile: WellnessProfile;
  setProfile: (p: WellnessProfile) => void;
  profileReady: boolean;
  weights: number[];
  logWeight: (w: number) => void;
  weightStreak: number;
  ritualStreak: number;
  bumpRitualStreak: () => void;
  goals: Goal[];
  setGoals: (g: Goal[] | ((prev: Goal[]) => Goal[])) => void;
  programStarted: boolean;
  startProgram: () => void;
  // Parent-set per-child section gates (local until the persistence PR).
  gatesByChild: Record<string, ChildGates>;
  gatesFor: (childId: string) => ChildGates;
  setGate: (childId: string, sectionId: string, cfg: GateConfig) => void;
}

const Ctx = createContext<WellnessState | null>(null);

// Starter goals (templates) — all begin at streak 0, first-run.
const STARTER_GOALS: Goal[] = [
  { wish: "Daily movement", tiny: "Just 20 minutes today", pill: "⚡", pcol: "#1FB6A6", streak: 0, todayDone: false, cheers: 0, target: 7 },
  { wish: "Hydrate", tiny: "First glass of water on waking", pill: "💧", pcol: "#F9A826", streak: 0, todayDone: false, cheers: 0, target: 7 },
  { wish: "Calmer evenings", tiny: "3 deep breaths before bed", pill: "🧘", pcol: "#FF6B6B", streak: 0, todayDone: false, cheers: 0, target: 7 },
];

export function WellnessProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<WellnessProfile>({});
  const [weights, setWeights] = useState<number[]>([]);
  const [weightStreak, setWeightStreak] = useState(0);
  const [ritualStreak, setRitualStreak] = useState(0);
  const [goals, setGoals] = useState<Goal[]>(STARTER_GOALS);
  const [programStarted, setProgramStarted] = useState(false);
  const [gatesByChild, setGatesByChild] = useState<Record<string, ChildGates>>({});

  const gatesFor = (childId: string) => gatesByChild[childId] ?? {};
  const setGate = (childId: string, sectionId: string, cfg: GateConfig) =>
    setGatesByChild((prev) => ({
      ...prev,
      [childId]: { ...(prev[childId] ?? {}), [sectionId]: cfg },
    }));

  const logWeight = (w: number) => {
    setWeights((prev) => [...prev, w].slice(-30));
    setWeightStreak((s) => s + 1);
  };

  const profileReady = !!(profile.heightCm && profile.age && profile.gender);

  return (
    <Ctx.Provider value={{
      profile, setProfile, profileReady,
      weights, logWeight, weightStreak,
      ritualStreak, bumpRitualStreak: () => setRitualStreak((s) => s + 1),
      goals, setGoals,
      programStarted, startProgram: () => setProgramStarted(true),
      gatesByChild, gatesFor, setGate,
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
