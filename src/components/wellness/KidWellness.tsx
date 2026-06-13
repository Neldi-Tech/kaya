"use client";
import { useState } from "react";
import { celebrate } from "./fx";
import { useWellness } from "./state";
import {
  SECTIONS, Section, ageFromBirthday, tierForAge, tierLabel, genderTrack,
  resolveAccess, isMinor, GenderTrack, Tier,
} from "./gating";

interface KidInfo { id: string; name: string; gender?: string; birthday?: string }

/* Gender-tuned body-changes copy. Gender TUNES; never gates. */
function bodyCopy(track: GenderTrack) {
  if (track === "girls") return "Age-appropriate, parent-allowed lessons on the changes girls go through — calm, factual, kind.";
  if (track === "boys") return "Age-appropriate, parent-allowed lessons on the changes boys go through — calm, factual, kind.";
  return "An inclusive, neutral guide to growing up — same lessons, no assumptions.";
}

function SectionRow({ s, bg, onText }: { s: Section; bg: string; onText: string }) {
  return (
    <div className="rowline">
      <div className="ic" style={{ background: bg }}>{s.emoji}</div>
      <div className="m"><b>{s.label}</b><small>{onText}</small></div>
      <span className="tag easy">open</span>
    </div>
  );
}
function LockedRow({ s, reason }: { s: Section; reason: string }) {
  return (
    <div className="rowline locked">
      <div className="ic" style={{ background: "#eef0f4" }}>{s.emoji}</div>
      <div className="m"><b>{s.label}</b><small>{reason}</small></div>
      <span className="tag med">🔒</span>
    </div>
  );
}

export default function KidWellness({ child }: { child: KidInfo }) {
  const { gatesFor } = useWellness();
  const gates = gatesFor(child.id);
  const age = ageFromBirthday(child.birthday);
  const tier: Tier = tierForAge(age);
  const track = genderTrack(child.gender);
  const first = (child.name || "there").split(" ")[0];
  const [mood, setMood] = useState<number | null>(null);
  const [ritual, setRitual] = useState(0);

  const basics = SECTIONS.filter((s) => s.alwaysOn);
  const gated = SECTIONS.filter((s) => !s.alwaysOn);
  const resolved = gated.map((s) => ({ s, a: resolveAccess(s, tier, age, gates[s.id], track) }));
  const openSecs = resolved.filter((r) => r.a.state === "on");
  const lockedSecs = resolved.filter((r) => r.a.state === "locked");
  const bodyOpen = openSecs.some((r) => r.s.id === "body");
  const weightOpen = openSecs.some((r) => r.s.id === "weight");

  return (
    <div className="wl">
      <div className="scroll">
        <div className="top">
          <div className="t">Hi {first}! 👋<small>WELLNESS · {tierLabel(tier).toUpperCase()}</small></div>
          {ritual > 0 && <div className="mscore">🌱 {ritual}</div>}
        </div>

        {/* Junior gets a quest hero; teens get a gentle ritual */}
        {tier === "junior" ? (
          <div className="quest" style={{ background: "linear-gradient(135deg,#F9A826,#FF6B6B)", color: "#fff", borderRadius: 18, padding: 18, textAlign: "center", marginTop: 8 }}>
            <div style={{ fontSize: 44 }}>🦁</div>
            <div style={{ fontWeight: 800, fontSize: 16, marginTop: 4 }}>Move like an animal</div>
            <div style={{ fontSize: 12, opacity: .95 }}>Hop, stomp &amp; roar — 8 minutes</div>
            <button className="btn" style={{ background: "#fff", color: "var(--coral)", width: "100%", padding: 12, marginTop: 12 }}
              onClick={() => { setRitual((r) => r + 1); celebrate("⭐", "Quest done!", "Amazing moving! Come back tomorrow."); }}>
              Start quest
            </button>
          </div>
        ) : (
          <div className="ritual" style={{ marginTop: 10 }}>
            <div className="rt"><div><b>Today&apos;s ritual</b><small>A gentle 10-minute reset</small></div><span className="tag easy">Easy · 10 min</span></div>
            <button className="btn btn-teal" style={{ width: "100%", padding: 12, fontSize: 14 }}
              onClick={() => { setRitual((r) => r + 1); celebrate("🔥", "Nice!", "Streak kept alive. Small rituals, real change."); }}>
              Start ritual
            </button>
          </div>
        )}

        {/* Always-on basics */}
        <div className="sec"><h3>Every day</h3></div>
        <div className="card">
          {basics.map((s, i) => (
            <SectionRow key={s.id} s={s} bg={["#e8f8f5", "#fff5e0", "#ffeef0", "#eaf2ff", "#e8f8f5"][i % 5]} onText="Tap to check in" />
          ))}
        </div>

        {/* Mood quick row */}
        <div className="moodcard">
          <div className="q">How&apos;s your energy today?</div>
          <div className="moodbar">
            {[["😣", "Drained"], ["😕", "Low"], ["🙂", "OK"], ["😄", "Good"], ["🤩", "Great"]].map(([e, t], i) => (
              <button key={t} className={`mood${mood === i ? " sel" : ""}`} onClick={() => setMood(i)}><div className="e">{e}</div><div className="t">{t}</div></button>
            ))}
          </div>
        </div>

        {/* Gender-tuned Body & you (only if parent allowed) */}
        {bodyOpen && (
          <>
            <div className="sec"><h3>Body &amp; you</h3><div className="hint">{track === "girls" ? "girls" : track === "boys" ? "boys" : "inclusive"}</div></div>
            <div className="card">
              <span className="gendertag" style={{ background: track === "girls" ? "#fdeef4" : track === "boys" ? "#e8f1ff" : "#eef9f6", color: track === "girls" ? "#c2367a" : track === "boys" ? "#2f63c9" : "#138f81" }}>
                {track === "girls" ? "girls track" : track === "boys" ? "boys track" : "inclusive"}
              </span>
              <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>Growing &amp; changing</div>
              <div className="note" style={{ marginTop: 4 }}>{bodyCopy(track)}</div>
            </div>
          </>
        )}

        {/* Teen-safe weight (15+ + parent opt-in) — NO body-fat %, NO over/under labels */}
        {weightOpen && (
          <>
            <div className="sec"><h3>Weight check-ins</h3><div className="hint">teen-safe</div></div>
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 13 }}>🌿 Looking healthy</div>
              <div className="note" style={{ marginTop: 4 }}>
                {isMinor(age)
                  ? "Kaya tracks the trend gently — focused on energy, sleep & strength. No body-fat numbers, no judgement."
                  : "Track your trend over time."}
              </div>
              <button className="btn btn-teal" style={{ width: "100%", padding: 11, fontSize: 13, marginTop: 10 }}
                onClick={() => celebrate("🌿", "Logged!", "Nice — consistency is what counts.")}>
                Log a check-in
              </button>
            </div>
          </>
        )}

        {/* Other open sections (strength / cycle / community) */}
        {openSecs.filter((r) => !["body", "weight"].includes(r.s.id)).length > 0 && (
          <>
            <div className="sec"><h3>More for you</h3></div>
            <div className="card">
              {openSecs.filter((r) => !["body", "weight"].includes(r.s.id)).map((r) => (
                <SectionRow key={r.s.id} s={r.s} bg="#f3effb" onText={r.s.id === "community" ? "Family-only & moderated" : "Open"} />
              ))}
            </div>
          </>
        )}

        {/* Locked — friendly, never a blank wall */}
        {lockedSecs.length > 0 && (
          <>
            <div className="sec"><h3>Unlocks later</h3><div className="hint">ask a parent</div></div>
            <div className="card">
              {lockedSecs.map((r) => <LockedRow key={r.s.id} s={r.s} reason={r.a.state === "locked" ? r.a.reason : ""} />)}
            </div>
            <p className="note" style={{ textAlign: "center", marginTop: 8 }}>These open when you&apos;re older or when a parent turns them on. 💜</p>
          </>
        )}

        <div className="pageend" />
      </div>
    </div>
  );
}
