"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import CelebrateHost from "./CelebrateHost";
import { WellnessProvider } from "./state";
import KidWellness from "./KidWellness";
import KidsAccess from "./KidsAccess";
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
const MORE_VIEWS: View[] = ["more", "onboard", "plan", "library", "gyms", "spark", "achievements", "impact", "reminders", "kidsaccess"];

function Notice({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="wl"><div className="scroll">
      <div className="top"><div className="t">Kaya Wellness<small>WELLNESS</small></div></div>
      <div className="card" style={{ textAlign: "center", marginTop: 16 }}>
        <div style={{ fontSize: 40 }}>{emoji}</div>
        <div style={{ fontWeight: 800, fontSize: 15, marginTop: 8 }}>{title}</div>
        <p style={{ fontSize: 12.5, color: "var(--w-grey)", fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>{body}</p>
      </div>
    </div></div>
  );
}

function AdultApp() {
  const { profile } = useAuth();
  const firstName = (profile?.displayName || "there").split(" ")[0];
  const [view, setView] = useState<View>("home");
  const activeTab: View = view === "weight-settings" ? "weight" : MORE_VIEWS.includes(view) ? "more" : view;

  return (
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
        {view === "kidsaccess" && <KidsAccess go={setView} />}
        <div className="pageend" />
      </div>
      <div className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={`tb${activeTab === t.id ? " on" : ""}`} onClick={() => setView(t.id)}>
            <span className="i">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WellnessInner() {
  const { profile } = useAuth();
  const { children } = useFamily();

  if (profile && profile.role === "kid") {
    const kid =
      children.find((c) => c.id === profile.childId) ||
      children.find((c) => c.id === profile.uid) ||
      null;
    if (!kid) {
      return <Notice emoji="🌱" title="Setting up your wellness…" body="We couldn't find your profile yet. Ask a parent to finish setting up your family — then your Kaya Wellness will appear." />;
    }
    return <KidWellness child={{ id: kid.id, name: kid.name, gender: kid.gender, birthday: kid.birthday }} />;
  }

  if (profile && profile.role === "helper") {
    return <Notice emoji="🌿" title="Kaya Wellness is personal" body="Wellness is just for family members. Helpers don't see this space." />;
  }

  return <AdultApp />;
}

export default function WellnessApp() {
  return (
    <WellnessProvider>
      <WellnessInner />
      <CelebrateHost />
    </WellnessProvider>
  );
}
