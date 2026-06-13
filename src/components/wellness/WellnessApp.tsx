"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import CelebrateHost from "./CelebrateHost";
import {
  View, Home, Weight, WeightSettings, Goals, Program, Circle,
  More, Onboard, Plan, Library, Gyms, Spark, Achievements, Impact, Reminders, Juniors,
} from "./Screens";

const TABS: { id: View; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "weight", icon: "⚖️", label: "Weight" },
  { id: "goals", icon: "🎯", label: "Goals" },
  { id: "program", icon: "📋", label: "Program" },
  { id: "circle", icon: "👥", label: "Circle" },
  { id: "more", icon: "⋯", label: "More" },
];
const MORE_VIEWS: View[] = ["more", "onboard", "plan", "library", "gyms", "spark", "achievements", "impact", "reminders", "juniors"];

export default function WellnessApp() {
  const { profile } = useAuth();
  const firstName = (profile?.displayName || "there").split(" ")[0];
  const [view, setView] = useState<View>("home");

  const activeTab: View =
    view === "weight-settings" ? "weight" : MORE_VIEWS.includes(view) ? "more" : view;

  return (
    <div className="wl">
      <div className="scroll" key={view}>
        {view === "home" && <Home go={setView} name={firstName} />}
        {view === "weight" && <Weight go={setView} />}
        {view === "weight-settings" && <WeightSettings go={setView} />}
        {view === "goals" && <Goals />}
        {view === "program" && <Program />}
        {view === "circle" && <Circle />}
        {view === "more" && <More go={setView} />}
        {view === "onboard" && <Onboard go={setView} />}
        {view === "plan" && <Plan go={setView} />}
        {view === "library" && <Library go={setView} />}
        {view === "gyms" && <Gyms go={setView} />}
        {view === "spark" && <Spark go={setView} />}
        {view === "achievements" && <Achievements go={setView} />}
        {view === "impact" && <Impact go={setView} />}
        {view === "reminders" && <Reminders go={setView} />}
        {view === "juniors" && <Juniors />}
        <div className="pageend" />
      </div>

      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tb${activeTab === t.id ? " on" : ""}`} onClick={() => setView(t.id)}>
            <span className="i">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <CelebrateHost />
    </div>
  );
}
