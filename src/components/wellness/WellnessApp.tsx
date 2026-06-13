"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import CelebrateHost from "./CelebrateHost";
import { WellnessProvider } from "./state";
import {
  View, Home, Weight, WeightSettings, Goals, Program, Circle,
  More, Onboard, Plan, Library, Gyms, Spark, Achievements, Impact, Reminders,
} from "./Screens";

const TABS: { id: View; icon: string; label: string }[] = [
  { id: "home", icon: "🏠", label: "Home" },
  { id: "weight", icon: "⚖️", label: "Weight" },
  { id: "goals", icon: "🎯", label: "Goals" },
  { id: "program", icon: "📋", label: "Program" },
  { id: "circle", icon: "👥", label: "Circle" },
  { id: "more", icon: "⋯", label: "More" },
];
const MORE_VIEWS: View[] = ["more", "onboard", "plan", "library", "gyms", "spark", "achievements", "impact", "reminders"];

export default function WellnessApp() {
  const { profile } = useAuth();
  const firstName = (profile?.displayName || "there").split(" ")[0];
  const [view, setView] = useState<View>("home");
  const activeTab: View = view === "weight-settings" ? "weight" : MORE_VIEWS.includes(view) ? "more" : view;

  // Personal-first: Kaya Wellness is a grown-up space for now (per-kid family
  // tracking arrives in phase 2). Kids who reach the route directly see a notice.
  if (profile && profile.role === "kid") {
    return (
      <div className="wl">
        <div className="scroll">
          <div className="top"><div className="t">Kaya Wellness<small>COMING FOR KIDS</small></div></div>
          <div className="card" style={{ textAlign: "center", marginTop: 16 }}>
            <div style={{ fontSize: 40 }}>🌱</div>
            <div style={{ fontWeight: 800, fontSize: 15, marginTop: 8 }}>This space is for grown-ups right now</div>
            <p style={{ fontSize: 12.5, color: "var(--w-grey)", fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>
              A fun Kaya Wellness just for kids — sleep, mood and movement quests — is on the way. ✨
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WellnessProvider>
      <div className="wl">
        <div className="scroll" key={view}>
          {view === "home" && <Home go={setView} name={firstName} />}
          {view === "weight" && <Weight go={setView} />}
          {view === "weight-settings" && <WeightSettings go={setView} />}
          {view === "goals" && <Goals name={firstName} />}
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
    </WellnessProvider>
  );
}
