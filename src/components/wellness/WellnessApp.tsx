"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useFamily } from "@/contexts/FamilyContext";
import CelebrateHost from "./CelebrateHost";
import { WellnessProvider } from "./state";
import { NavCtx } from "./nav";
import KidWellness from "./KidWellness";
import KidsAccess from "./KidsAccess";
import {
  View, Home, Weight, WeightSettings, Goals, Program, Circle,
  More, Onboard, Plan, Library, Gyms, Spark, Achievements, Impact, Reminders,
} from "./Screens";
import { PillarSessions, MoodHistory, EditHome, GymLog, Sports, SportSetup, Analytics, Diet } from "./screensV2";

const TABS: { id: View; icon: string; label: string }[] = [
  { id: "home", icon: "☀️", label: "Today" },
  { id: "weight", icon: "⚖️", label: "Weight" },
  { id: "goals", icon: "🎯", label: "Goals" },
  { id: "sports", icon: "🎾", label: "Sports" },
  { id: "program", icon: "📋", label: "Program" },
  { id: "more", icon: "⋯", label: "More" },
];
const TAB_OF: Partial<Record<View, View>> = {
  home: "home", pillar: "home", moodhistory: "home", edithome: "home", spark: "home",
  weight: "weight", "weight-settings": "weight",
  goals: "goals", gymlog: "goals",
  sports: "sports", sportsetup: "sports",
  program: "program",
};

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
  const [history, setHistory] = useState<View[]>([]);
  const [param, setParam] = useState("");

  const go = (v: View) => { setHistory((h) => [...h, view]); setParam(""); setView(v); };
  const goWith = (v: View, p: string) => { setHistory((h) => [...h, view]); setParam(p); setView(v); };
  const back = () => { if (!history.length) return; setView(history[history.length - 1]); setHistory(history.slice(0, -1)); };
  const tab = (v: View) => { setHistory([]); setParam(""); setView(v); };
  const activeTab = TAB_OF[view] ?? "more";

  return (
    <NavCtx.Provider value={{ go, goWith, back, canBack: history.length > 0, param }}>
      <div className="wl">
        <div className="scroll" key={view}>
          {view === "home" && <Home name={firstName} />}
          {view === "weight" && <Weight go={go} />}
          {view === "weight-settings" && <WeightSettings go={go} />}
          {view === "goals" && <Goals name={firstName} />}
          {view === "program" && <Program />}
          {view === "circle" && <Circle />}
          {view === "more" && <More go={go} />}
          {view === "onboard" && <Onboard go={go} />}
          {view === "plan" && <Plan go={go} />}
          {view === "library" && <Library go={go} />}
          {view === "gyms" && <Gyms go={go} />}
          {view === "spark" && <Spark go={go} />}
          {view === "achievements" && <Achievements go={go} />}
          {view === "impact" && <Impact go={go} />}
          {view === "reminders" && <Reminders go={go} />}
          {view === "kidsaccess" && <KidsAccess go={go} />}
          {view === "pillar" && <PillarSessions />}
          {view === "moodhistory" && <MoodHistory />}
          {view === "edithome" && <EditHome />}
          {view === "gymlog" && <GymLog />}
          {view === "sports" && <Sports />}
          {view === "sportsetup" && <SportSetup />}
          {view === "analytics" && <Analytics />}
          {view === "diet" && <Diet />}
          <div className="pageend" />
        </div>
        <div className="tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={`tb${activeTab === t.id ? " on" : ""}`} onClick={() => tab(t.id)}>
              <span className="i">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>
    </NavCtx.Provider>
  );
}

function WellnessInner() {
  const { profile } = useAuth();
  const { children } = useFamily();

  if (profile && profile.role === "kid") {
    const kid = children.find((c) => c.id === profile.childId) || children.find((c) => c.id === profile.uid) || null;
    if (!kid) return <Notice emoji="🌱" title="Setting up your wellness…" body="We couldn't find your profile yet. Ask a parent to finish setting up your family — then your Kaya Wellness will appear." />;
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
