"use client";
import { useState } from "react";
import { useFamily } from "@/contexts/FamilyContext";
import { useWellness } from "./state";
import { PARENT_GATEABLE, ageFromBirthday, tierForAge, tierLabel, genderTrack, minGateAge, Section, GateConfig } from "./gating";
import type { View } from "./Screens";

function GateControl({ section, childId, childAge }: { section: Section; childId: string; childAge: number | null }) {
  const { gatesFor, setGate } = useWellness();
  const cfg: GateConfig = gatesFor(childId)[section.id] ?? { mode: "off" };
  const floor = section.hardFloorAge;
  const belowFloor = floor != null && (childAge == null || childAge < floor);
  const minAge = minGateAge(section);
  const atAge = cfg.age ?? minAge;

  return (
    <div className="card" style={{ marginTop: 0, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 12.5 }}>{section.emoji} {section.label}</b>
        {section.gendered && <span className="gendertag" style={{ background: "#fdeef4", color: "#c2367a" }}>gendered</span>}
      </div>
      <div className="selrow" style={{ marginTop: 8, flexWrap: "nowrap" }}>
        <button className={`opt${cfg.mode === "off" ? " on" : ""}`} style={{ flex: 1 }} onClick={() => setGate(childId, section.id, { mode: "off" })}>Off</button>
        <button className={`opt${cfg.mode === "now" ? " on" : ""}`} style={{ flex: 1, opacity: belowFloor ? .4 : 1 }}
          onClick={() => !belowFloor && setGate(childId, section.id, { mode: "now" })}>Allow now</button>
        <button className={`opt${cfg.mode === "age" ? " on" : ""}`} style={{ flex: 1 }}
          onClick={() => setGate(childId, section.id, { mode: "age", age: Math.max(atAge, minAge) })}>At age</button>
      </div>
      {cfg.mode === "age" && (
        <div className="selrow" style={{ marginTop: 8, alignItems: "center" }}>
          <button className="stepbtn" style={{ width: 38, height: 38 }} onClick={() => setGate(childId, section.id, { mode: "age", age: Math.max(minAge, atAge - 1) })}>−</button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 14 }}>Unlocks at {atAge}</div>
          <button className="stepbtn" style={{ width: 38, height: 38 }} onClick={() => setGate(childId, section.id, { mode: "age", age: Math.min(17, atAge + 1) })}>+</button>
        </div>
      )}
      {belowFloor && <div className="hardfloor">⛔ Hard floor: unlocks at {floor}. No body metrics for younger kids — for their safety.</div>}
    </div>
  );
}

export default function KidsAccess({ go }: { go: (v: View) => void }) {
  const { children } = useFamily();
  const [idx, setIdx] = useState(0);
  const kid = children[idx];

  return (
    <div className="wl">
      <div className="scroll">
        <div className="top">
          <div className="t">Kids&apos; access<small>WELLNESS · PARENT CONTROLS</small></div>
          <button className="mscore" onClick={() => go("more")}>← More</button>
        </div>

        {children.length === 0 ? (
          <div className="card" style={{ textAlign: "center", marginTop: 16 }}>
            <div style={{ fontSize: 36 }}>🧒</div>
            <div style={{ fontWeight: 800, fontSize: 14, marginTop: 8 }}>No kids on this family yet</div>
            <p className="note" style={{ marginTop: 4 }}>Add a child in your family settings, then come back to set their wellness access.</p>
          </div>
        ) : (
          <>
            {children.length > 1 && (
              <div className="selrow" style={{ marginTop: 10 }}>
                {children.map((c, i) => <button key={c.id} className={`opt${idx === i ? " on" : ""}`} onClick={() => setIdx(i)}>{(c.name || "Kid").split(" ")[0]}</button>)}
              </div>
            )}
            {(() => {
              const age = ageFromBirthday(kid.birthday);
              const track = genderTrack(kid.gender);
              return (
                <>
                  <div className="card" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="ic" style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 20, background: "#f3effb" }}>{kid.avatarEmoji || "🧒"}</div>
                    <div>
                      <b style={{ fontSize: 13 }}>{(kid.name || "Kid").split(" ")[0]}</b>
                      <small style={{ display: "block", color: "var(--w-grey)", fontWeight: 600, fontSize: 11 }}>
                        {age != null ? `Age ${age} · ` : ""}{tierLabel(tierForAge(age))} · {track === "girls" ? "girls" : track === "boys" ? "boys" : "inclusive"} track
                      </small>
                    </div>
                  </div>
                  <p className="note" style={{ margin: "10px 0 4px" }}>Choose what {(kid.name || "Kid").split(" ")[0]} can access — turn on now, or schedule it to unlock at an age.</p>
                  {PARENT_GATEABLE
                    .filter((s) => !s.girlsOnly || track === "girls")
                    .map((s) => <GateControl key={s.id} section={s} childId={kid.id} childAge={age} />)}
                  <p className="note" style={{ textAlign: "center", marginTop: 4 }}>Always-on basics (move · sleep · mood · hydrate · breathe) can&apos;t be turned off.</p>
                </>
              );
            })()}
          </>
        )}
        <div className="pageend" />
      </div>
    </div>
  );
}
