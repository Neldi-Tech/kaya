"use client";
import { useMemo, useState } from "react";
import { celebrate } from "./fx";
import { bmi, bmiBand, bodyFatPct, weeklyPace, weeksToGoal, aiAnalysis, Gender } from "./calc";
import { useWellness, Goal, todayStr } from "./state";
import { useNav } from "./nav";

export type View =
  | "home" | "weight" | "weight-settings" | "goals" | "program" | "circle" | "more"
  | "onboard" | "plan" | "library" | "gyms" | "spark" | "achievements" | "impact" | "reminders" | "juniors"
  | "kidsaccess"
  | "pillar" | "moodhistory" | "edithome" | "gymlog" | "sports" | "sportsetup" | "analytics";

const SPARK_QUOTE = "You don't have to be extreme. Just consistent.";

/* ============ HOME (personalized) ============ */
const PILLARS = [
  { id: "gym", cls: "gym", e: "🏋️", n: "Gym" }, { id: "home", cls: "home", e: "🤸", n: "At-home" },
  { id: "breathe", cls: "breathe", e: "🌬️", n: "Breathe" }, { id: "reflect", cls: "reflect", e: "📓", n: "Reflect" },
];
const MOODS = [
  { e: "😣", t: "Drained" }, { e: "😕", t: "Low" }, { e: "🙂", t: "OK" }, { e: "😄", t: "Good" }, { e: "🤩", t: "Great" },
];
export function Home({ name }: { name: string }) {
  const { ritualStreak, bumpRitualStreak, goals, setGoals, logMood, moods, homeCards, sports, weights } = useWellness();
  const { go, goWith } = useNav();
  const todayMood = moods.find((m) => m.date === todayStr());
  const pct = Math.min(ritualStreak, 30) / 30;
  const dash = 295, offset = dash * (1 - pct);
  const on = (id: string) => homeCards.find((c) => c.id === id)?.on;

  const tickGoal = (i: number) => setGoals((gs) => gs.map((g, j) => {
    if (j !== i || g.todayDone) return g;
    const streak = g.streak + 1;
    celebrate("✅", "Nice!", `${g.wish} — streak ${streak} 🔥`);
    return { ...g, todayDone: true, streak };
  }));
  const saveMood = (level: number) => {
    const period = new Date().getHours() < 17 ? "morning" : "evening";
    logMood(level, period);
    celebrate("🙂", "Saved", "Your check-in is in Mood history.");
  };

  return (
    <>
      <div className="top">
        <div className="t">Good morning, {name}<small>WELLNESS · TODAY</small></div>
        <button className="mscore" onClick={() => go("edithome")}>✏️ Edit</button>
      </div>

      {on("spark") && (
        <div className="sparkcard" onClick={() => go("spark")}>
          <div className="sparkcard-row"><span className="se">✨</span>
            <div><div className="sk">YOUR DAILY SPARK</div><div className="sq">&ldquo;{SPARK_QUOTE}&rdquo;</div></div></div>
        </div>
      )}

      {on("streak") && (
        <div className="focus">
          <div className="stars" />
          <div className="ringrow">
            <div className="wl-ring">
              <svg viewBox="0 0 112 112">
                <circle cx="56" cy="56" r="47" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="9" />
                {ritualStreak > 0 && <circle cx="56" cy="56" r="47" fill="none" stroke="#F9A826" strokeWidth="9" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={offset} transform="rotate(-90 56 56)" />}
              </svg>
              <div className="c"><div className="n">{ritualStreak}</div><div className="d">{ritualStreak === 1 ? "DAY" : "DAYS"} 🔥</div></div>
            </div>
            <div className="meta"><div className="k">⭐ Your momentum</div>
              <div style={{ marginTop: 6 }}>{ritualStreak === 0
                ? <>Begin your streak today 🌱<br />Complete a ritual — Never Zero keeps it alive.</>
                : <>Consistent {ritualStreak} {ritualStreak === 1 ? "day" : "days"} — nice rhythm. 🌱<br />Never Zero: a hard day spends a shield, not your streak.</>}</div>
            </div>
          </div>
        </div>
      )}

      <div className="pillars">
        {PILLARS.map((p) => <button key={p.id} className={`pill ${p.cls}`} onClick={() => goWith("pillar", p.id)}><div className="pe">{p.e}</div><span className="pn">{p.n}</span></button>)}
      </div>

      <div className="moodcard">
        <div className="q" style={{ display: "flex", justifyContent: "space-between" }}>
          How&apos;s your energy today?
          <button onClick={() => go("moodhistory")} style={{ border: "none", background: "none", color: "var(--violet)", fontWeight: 800, fontSize: 11, cursor: "pointer" }}>history ›</button>
        </div>
        <div className="moodbar">
          {MOODS.map((m, i) => (
            <button key={m.t} className={`mood${todayMood?.level === i ? " sel" : ""}`} onClick={() => saveMood(i)}>
              <div className="e">{m.e}</div><div className="t">{m.t}</div>
            </button>
          ))}
        </div>
      </div>

      {on("goals") && (
        <>
          <div className="sec"><h3>Your goals today</h3><div className="hint">tap to tick</div></div>
          <div className="card">
            {goals.map((g, i) => (
              <div className="rowline" key={i}>
                <button className={`gtick${g.todayDone ? " done" : ""}`} onClick={() => tickGoal(i)} aria-label="tick">{g.todayDone ? "✓" : ""}</button>
                <div className="m"><b>{g.wish}</b><small>{g.tiny}{g.streak > 0 ? ` · 🔥 ${g.streak}` : ""}</small></div>
              </div>
            ))}
          </div>
        </>
      )}

      {on("gymlog") && (
        <div className="card" onClick={() => go("gymlog")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
          <div className="ic" style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 19, background: "#ffeef0", flex: "none" }}>🏋️</div>
          <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>Gym log</b><div className="note">Tap to record today — fast</div></div>
          <span className="tag easy">Log</span>
        </div>
      )}

      {on("sports") && sports.length > 0 && (
        <>
          <div className="sec"><h3>Sports today</h3></div>
          <div className="card">
            {sports.slice(0, 3).map((s) => (
              <div className="rowline" key={s.id} onClick={() => go("sports")} style={{ cursor: "pointer" }}>
                <div className="ic" style={{ width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center", fontSize: 17, background: "#e8f8f5", flex: "none" }}>{s.emoji}</div>
                <div className="m"><b>{s.name} · {s.time}</b><small>{s.venue || "Tap to set venue"}</small></div>
                <span className="tag tv">My Day</span>
              </div>
            ))}
          </div>
        </>
      )}

      {on("weight") && weights.length > 0 && (
        <div className="card" onClick={() => go("weight")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
          <div className="ic" style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 19, background: "#e8f8f5", flex: "none" }}>⚖️</div>
          <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{weights[weights.length - 1].toFixed(1)} kg</b><div className="note">Weight snapshot · tap for detail</div></div>
        </div>
      )}

      {on("news") && (
        <div className="card" onClick={() => go("sports")} style={{ cursor: "pointer" }}>
          <div className="note" style={{ fontWeight: 800, color: "var(--violet)" }}>📰 SPORTS NEWS</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>Padel surges across East Africa as new courts open</div>
        </div>
      )}

      <div className="ritual">
        <div className="rt"><div><b>Today&apos;s ritual</b><small>A gentle 10-minute reset to start</small></div><span className="tag easy">Easy · 10 min</span></div>
        <button className="btn btn-teal" style={{ width: "100%", padding: 12, fontSize: 14 }}
          onClick={() => { bumpRitualStreak(); celebrate("🔥", "Ritual done!", "Streak kept alive. Small rituals, real change."); }}>
          Start ritual
        </button>
      </div>
    </>
  );
}

/* ============ WEIGHT ============ */
function WeightSpark({ weights }: { weights: number[] }) {
  const W = 320, H = 60, pad = 5;
  const { d, area, last } = useMemo(() => {
    const mn = Math.min(...weights), mx = Math.max(...weights), rng = mx - mn || 1;
    const pts = weights.map((w, i) => [pad + (i / (weights.length - 1)) * (W - pad * 2), pad + (1 - (w - mn) / rng) * (H - pad * 2)]);
    const dd = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const lp = pts[pts.length - 1];
    return { d: dd, area: `${dd} L ${lp[0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`, last: lp };
  }, [weights]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={50} preserveAspectRatio="none">
      <path d={area} fill="rgba(255,255,255,.18)" />
      <path d={d} fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="#F9A826" stroke="#fff" strokeWidth={2} />
    </svg>
  );
}
const Dash = "—";
export function Weight({ go }: { go: (v: View) => void }) {
  const { weights, logWeight, weightStreak, profile, profileReady } = useWellness();
  const [input, setInput] = useState("");
  const has = weights.length > 0;
  const cur = has ? weights[weights.length - 1] : null;
  const diff = has && weights.length > 1 ? weights[0] - cur! : 0;
  const b = cur && profile.heightCm ? bmi(cur, profile.heightCm) : null;
  const band = b != null ? bmiBand(b) : null;
  const bf = cur ? bodyFatPct(cur, profile) : null;
  const pace = weeklyPace(weights);
  const wks = cur != null ? weeksToGoal(cur, pace, profile.goalKg) : null;

  const step = (delta: number) => setInput((v) => (parseFloat(v || (cur ? String(cur) : "70")) + delta).toFixed(1));
  const log = () => {
    const v = parseFloat(input);
    if (isNaN(v) || v <= 0) return;
    logWeight(v);
    setInput("");
    celebrate("⚖️", "Logged!", `${weightStreak + 1}-day logging streak. What gets measured gets repeated.`);
  };

  return (
    <>
      <div className="top"><div className="t">Weight Management<small>FREE · DAILY TRACKING</small></div>{weightStreak > 0 && <div className="mscore">⚖️ {weightStreak}🔥</div>}</div>

      <div className="wbig">
        <div className="freebadge">FREE</div>
        <div className="lab">Current weight</div>
        {has ? (
          <>
            <div className="wt">{cur!.toFixed(1)}<span> kg</span></div>
            {weights.length > 1
              ? <div className="delta">{diff >= 0 ? "▼" : "▲"} {Math.abs(diff).toFixed(1)} kg · trending {diff >= 0 ? "down" : "up"}</div>
              : <div className="delta">First entry logged — log again tomorrow to see your trend.</div>}
            {weights.length > 1 && <div style={{ marginTop: 10 }}><WeightSpark weights={weights} /></div>}
          </>
        ) : (
          <>
            <div className="wt" style={{ opacity: .8 }}>{Dash}<span> kg</span></div>
            <div className="delta">No weight logged yet. Add today&apos;s below to begin your trend.</div>
          </>
        )}
      </div>

      {!profileReady && (
        <button className="setupcard" onClick={() => go("onboard")}>
          <span style={{ fontSize: 22 }}>🪄</span>
          <div><b>Set up your profile</b><small>Add your height, age &amp; gender so Kaya can show BMI, body fat &amp; pace — tuned to you.</small></div>
          <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--violet)" }}>→</span>
        </button>
      )}

      <div className="grouphdr ai">🤖 Kaya calculates (auto)</div>
      <div className="statgrid">
        <div className="stat"><span className="autotag">AUTO</span><div className="sl">BMI</div><div className="sv">{b != null ? b.toFixed(1) : Dash}</div>{band ? <span className={`bmichip ${band.cls}`}>{band.label}</span> : <span className="bmichip normal">needs height</span>}</div>
        <div className="stat"><span className="autotag">AUTO</span><div className="sl">Body fat</div><div className="sv">{bf != null ? <>{bf.toFixed(1)}<small>%</small></> : Dash}</div><span className="bmichip normal">{bf != null ? "est. from BMI + age" : "needs age + gender"}</span></div>
      </div>
      <div className="statgrid" style={{ marginTop: 10 }}>
        <div className="stat"><span className="autotag">AUTO</span><div className="sl">Weekly pace</div><div className="sv">{weights.length > 1 ? <>{Math.abs(pace).toFixed(1)}<small> kg/wk</small></> : Dash}</div></div>
        <div className="stat"><span className="autotag">AUTO</span><div className="sl">Goal date</div><div className="sv">{!profile.goalKg ? Dash : cur != null && cur <= profile.goalKg ? "reached 🎉" : wks == null ? Dash : `~${wks} wk`}</div></div>
      </div>

      <div className="grouphdr you">📝 You log</div>
      <div className="logcard">
        <h4>Today&apos;s weight</h4>
        <div className="logrow">
          <button className="stepbtn" onClick={() => step(-0.1)}>−</button>
          <input className="wInput" type="number" step="0.1" inputMode="decimal" placeholder="kg" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="stepbtn" onClick={() => step(0.1)}>+</button>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={log}>✓ Log weight</button>
      </div>

      <div className="ai">
        <div className="ah"><span className="pulse" />KAYA AI · HIGH-LEVEL ANALYSIS</div>
        <p>{aiAnalysis(weights, weightStreak, profile)}</p>
        {has && <div className="sugg"><div className="s">💧 Front-load water</div><div className="s">🍳 Protein at breakfast</div><div className="s">😴 Protect 7h sleep</div></div>}
      </div>

      <div style={{ padding: "14px 0 0" }}>
        <button className="btn btn-ghost" onClick={() => go("weight-settings")}>⚙️ Tracking settings &amp; import old data →</button>
      </div>
    </>
  );
}

/* ============ WEIGHT SETTINGS ============ */
const FREQ = ["Weekly", "2× / month", "3× / month", "Monthly"];
const WEIGH = ["Daily", "Every other day", "Weekly"];
export function WeightSettings({ go }: { go: (v: View) => void }) {
  const [freq, setFreq] = useState(1);
  const [weigh, setWeigh] = useState(0);
  const [parsed, setParsed] = useState(false);
  return (
    <>
      <div className="top"><div className="t">Tracking settings<small>WEIGHT MANAGEMENT</small></div><button className="mscore" onClick={() => go("weight")}>← Back</button></div>
      <div className="freqcard">
        <h4>Full body measurements</h4>
        <p>How often should Kaya ask you to measure waist, chest, arms, etc.?</p>
        <div className="selrow">{FREQ.map((f, i) => <button key={f} className={`opt${freq === i ? " on" : ""}`} onClick={() => setFreq(i)}>{f}</button>)}</div>
      </div>
      <div className="freqcard">
        <h4>Weigh-in reminder</h4>
        <p>Daily weigh-in nudge — first thing, after waking.</p>
        <div className="selrow">{WEIGH.map((f, i) => <button key={f} className={`opt${weigh === i ? " on" : ""}`} onClick={() => setWeigh(i)}>{f}</button>)}</div>
      </div>
      <div className="sec"><h3>Import old data</h3><div className="hint">backfill</div></div>
      <div className="uploadzone">
        <div className="e">📄</div><div className="ut">Upload an Excel / CSV</div>
        <div className="us">Drag your old weight log here — Kaya AI reads it and fills in the past for you.</div>
        <button className="btn btn-ghost" style={{ marginTop: 12, width: "auto", padding: "10px 18px" }} onClick={() => setParsed(true)}>Choose file</button>
      </div>
      {parsed && (
        <>
          <div className="parsed">
            <div className="ph"><span>🤖 KAYA AI PARSED · weights.xlsx</span><span>34 rows</span></div>
            <div className="prow"><span>01–14 May · 14 entries</span><span className="ok">✓ clean</span></div>
            <div className="prow"><span>15–28 May · 14 entries</span><span className="ok">✓ clean</span></div>
            <div className="prow"><span>29–31 May · 3 entries</span><span className="warn">⚠ units? (lb→kg)</span></div>
            <div className="prow"><span>03 Jun · duplicate</span><span className="warn">⚠ skip</span></div>
          </div>
          <p style={{ fontSize: 11, color: "var(--w-grey)", fontWeight: 600, margin: "10px 0 0", textAlign: "center" }}>Review the flags, then approve — nothing is saved until you confirm.</p>
          <div style={{ padding: "10px 0 0" }}>
            <button className="btn btn-primary" onClick={() => celebrate("📈", "Imported!", "Your past entries are added — history complete.")}>✓ Approve &amp; import</button>
          </div>
        </>
      )}
    </>
  );
}

/* ============ GOALS ============ */
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
function Chain({ streak, todayDone }: { streak: number; todayDone: boolean }) {
  return (
    <div className="chain">
      {DAYS.map((d, i) => {
        const isToday = i === 6;
        const on = isToday ? todayDone : streak > 0 && i >= 7 - 1 - Math.min(streak, 6);
        return <div key={i} className={`d${on ? " on" : ""}${isToday ? " today" : ""}`}>{on ? "✓" : d}</div>;
      })}
      <span className="lab">{streak}🔥</span>
    </div>
  );
}
const WELLNESS_PRESETS: { wish: string; tiny: string; pill: string; pcol: string }[] = [
  { wish: "Read", tiny: "20 minutes today", pill: "📖", pcol: "#6C4AB6" },
  { wish: "10k steps", tiny: "Move through the day", pill: "🚶", pcol: "#1FB6A6" },
  { wish: "Meditate", tiny: "5 quiet minutes", pill: "🧘", pcol: "#FF6B6B" },
  { wish: "Sleep by 10", tiny: "Lights out on time", pill: "😴", pcol: "#F9A826" },
];
export function Goals({ name }: { name: string }) {
  const { goals, setGoals, addGoal } = useWellness();
  const { go } = useNav();
  const initial = (name || "Y").charAt(0).toUpperCase();
  const addPreset = (p: typeof WELLNESS_PRESETS[number]) => {
    addGoal({ ...p, streak: 0, todayDone: false, cheers: 0, target: 7 });
    celebrate("🎯", "Goal added!", `${p.wish} is now a daily wellness goal.`);
  };
  const markDone = (i: number) =>
    setGoals((gs) => gs.map((g, j) => {
      if (j !== i) return g;
      if (g.todayDone) return { ...g, todayDone: false, streak: Math.max(0, g.streak - 1) };
      const streak = g.streak + 1;
      if (streak === g.target) celebrate("🏅", `${g.target}-day badge!`, `${g.wish} milestone unlocked. 🎉`);
      else if ([3, 7, 14, 30].includes(streak)) celebrate("🔥", `${streak}-day streak!`, "On fire — keep it going!");
      else celebrate("✅", "Done today!", `${g.wish} — streak now ${streak} 🔥`);
      return { ...g, todayDone: true, streak };
    }));
  const cheer = (i: number) => setGoals((gs) => gs.map((g, j) => (j === i ? { ...g, cheers: g.cheers + 1 } : g)));
  return (
    <>
      <div className="top"><div className="t">My goals<small>TINY &amp; DOABLE</small></div></div>
      <div className="nz"><div className="em">🛡️</div><p><b>Never Zero:</b> a hard day spends a shield, not your streak. Do 10 minutes — it still counts.</p></div>
      <div className="sec"><h3>Pick a goal &amp; tap done daily</h3><div className="hint">start small</div></div>
      <div className="goals">
        {goals.map((g, i) => {
          const toB = g.target - g.streak;
          return (
            <div className="gcard" key={i}>
              <div className="accent" style={{ background: g.pcol }} />
              <div className="ghead">
                <div className="fa" style={{ background: "#6C4AB6" }}>{initial}</div>
                <div className="gn"><b>{g.wish}</b><small>You</small></div>
                <div className="pillico" style={{ background: g.pcol + "22" }}>{g.pill}</div>
              </div>
              <div className="gtiny"><span>🤏</span> {g.tiny}</div>
              <Chain streak={g.streak} todayDone={g.todayDone} />
              <div className="gactions">
                <button className={`btn-done${g.todayDone ? " checked" : ""}`} onClick={() => markDone(i)}>{g.todayDone ? "✓ Done today" : "Mark today done"}</button>
                <button className="btn-cheer" onClick={() => cheer(i)}>👏 <span>{g.cheers}</span></button>
              </div>
              <div className="milestone">🏅 {g.streak >= g.target ? <b>{g.target}-day badge!</b> : g.streak === 0 ? <span>Start today — {g.target}-day badge awaits</span> : <span><b>{toB}</b> day{toB === 1 ? "" : "s"} to the {g.target}-day badge</span>}</div>
            </div>
          );
        })}
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 2 }} onClick={() => go("gymlog")}>🏋️ Log a gym session →</button>
      <div className="sec"><h3>Add a wellness goal</h3><div className="hint">not just gym</div></div>
      <div className="selrow" style={{ padding: "0 2px" }}>
        {WELLNESS_PRESETS.map((p) => <button key={p.wish} className="opt" onClick={() => addPreset(p)}>{p.pill} {p.wish}</button>)}
      </div>
    </>
  );
}

/* ============ PROGRAM ============ */
const PHASES = [
  { n: 1, color: "#6C4AB6", title: "Foundation · Wk 1–4", desc: "Rebuild base strength, lock the habit, dial in diet" },
  { n: 2, color: "#1FB6A6", title: "Build & Burn · Wk 5–8", desc: "Peak intensity · Wk 8 deload" },
  { n: 3, color: "#FF6B6B", title: "Cut & Reveal · Wk 9–12", desc: "Strip fat, keep muscle, bring out the abs" },
];
const PDAYS = [
  { d: "Mon · Push", s: "AM cardio+abs · PM chest/shoulders/triceps", tag: "hard", lab: "Hard" },
  { d: "Wed · Legs", s: "AM Zone-2 · PM lower body", tag: "hard", lab: "Hard" },
  { d: "Fri · Lower + conditioning", s: "No AM — school run · PM only", tag: "med", lab: "Medium" },
  { d: "Sun · Rest + review", s: "Photo · waist · weight · one PR", tag: "easy", lab: "Rest" },
];
export function Program() {
  const { programStarted, startProgram } = useWellness();
  return (
    <>
      <div className="top"><div className="t">My program<small>STRUCTURED PLAN</small></div>{programStarted && <div className="mscore">📋 Day 1</div>}</div>
      <div className="phero"><div className="stars" /><div className="in">
        <div className="k">90-Day Program</div><h2>The Restoration</h2>
        <div className="desc">Body recomposition · two-a-day · goal: shape + visible abs</div>
        {programStarted
          ? <><div className="pbar"><i style={{ width: "1%" }} /></div><div className="pf2"><span>Day 1 of 90</span><span>Phase 1 · Foundation</span></div></>
          : <div className="pf2" style={{ marginTop: 10 }}><span>90 days · 3 phases</span><span>Not started</span></div>}
      </div></div>
      <div className="sec"><h3>The 3 waves</h3><div className="hint">periodized</div></div>
      <div>{PHASES.map((p, idx) => (
        <div key={p.n} className={`phase${programStarted && idx === 0 ? " cur" : ""}`}><div className="pnum" style={{ background: p.color }}>{p.n}</div><div className="pt"><b>{p.title}</b><small>{p.desc}</small></div></div>
      ))}</div>
      <div className="sec"><h3>A typical week</h3><div className="hint">AM cardio · PM weights</div></div>
      <div>{PDAYS.map((d) => (
        <div key={d.d} className="day"><div className="dl"><b>{d.d}</b><small>{d.s}</small></div><span className={`tag ${d.tag}`}>{d.lab}</span></div>
      ))}</div>
      <div className="nz" style={{ marginTop: 14 }}><div className="em">🛡️</div><p><b>Never Zero:</b> on any day life wins, do 10 min or one exercise. Streak &amp; program stay alive.</p></div>
      <div style={{ padding: "14px 0 0" }}>
        {programStarted
          ? <button className="btn btn-primary">Start today&apos;s session →</button>
          : <button className="btn btn-primary" onClick={() => { startProgram(); celebrate("📋", "Program started!", "Day 1 of 90. The Restoration begins."); }}>Start the 90-day program</button>}
      </div>
    </>
  );
}

/* ============ CIRCLE ============ */
const CLUBS = [
  { ico: "🏃", bg: "#FF6B6B", n: "Weekend Runners", s: "1.2k · 3 runs/week" },
  { ico: "🧘", bg: "#F9A826", n: "Calm After Work", s: "540 · evening unwind" },
  { ico: "💪", bg: "#6C4AB6", n: "Strength Starters", s: "890 · beginner-friendly" },
];
export function Circle() {
  const [share, setShare] = useState(0);
  return (
    <>
      <div className="top"><div className="t">Wellness community<small>CHALLENGES · CLUBS · SHARING</small></div></div>
      <div className="sec"><h3>Live challenges</h3></div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><b style={{ fontSize: 14 }}>June Movement</b><span className="tag easy">Join in</span></div>
        <div style={{ fontSize: 12, color: "var(--w-grey)", fontWeight: 600, marginTop: 8 }}>🌍 8,402 people moving together this month</div>
        <button className="btn btn-teal" style={{ width: "100%", padding: 10, fontSize: 13, marginTop: 10 }} onClick={() => celebrate("🌍", "You're in!", "June Movement — moving with 8,402 others.")}>I&apos;m in</button>
      </div>
      <div className="sec"><h3>Discover clubs</h3></div>
      {CLUBS.map((c) => (
        <div className="listitem" key={c.n}><div className="ico" style={{ background: c.bg }}>{c.ico}</div><div className="m"><b>{c.n}</b><small>{c.s}</small></div><button className="btn btn-teal" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => celebrate("👥", "Joined!", `Welcome to ${c.n}.`)}>Join</button></div>
      ))}
      <div className="sec"><h3>Shared schedules</h3><div className="hint">anon or revealed</div></div>
      <div className="card" style={{ background: "#f7f4fd", border: "none", marginBottom: 10 }}>
        <b style={{ fontSize: 13 }}>Share my schedule</b>
        <div className="selrow" style={{ marginTop: 10 }}>
          <button className={`opt${share === 0 ? " on" : ""}`} onClick={() => setShare(0)}>🕶️ Anonymous</button>
          <button className={`opt${share === 1 ? " on" : ""}`} onClick={() => setShare(1)}>😊 Show me</button>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 11, padding: 10, fontSize: 13 }} onClick={() => celebrate("📢", "Posted!", share === 0 ? "Shared anonymously to the wall." : "Shared with your name.")}>Post to wall</button>
      </div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between" }}><small style={{ color: "var(--w-grey)", fontWeight: 700 }}>🕶️ Anonymous · 30–44</small><span className="tag med">Medium</span></div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>Mon Breathe · Tue Gym · Thu Run · Sat Home</div>
        <div className="selrow" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" style={{ width: "auto", padding: "7px 12px", fontSize: 12 }}>👏 184</button>
          <button className="btn btn-teal" style={{ padding: "7px 12px", fontSize: 12 }}>Adopt</button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--w-grey)", fontWeight: 600, textAlign: "center", marginTop: 6 }}>Adopting auto-rescales to your age &amp; intensity.</p>
    </>
  );
}

/* ============ MORE + secondary ============ */
function Head({ title, sub, go }: { title: string; sub: string; go: (v: View) => void }) {
  return <div className="top"><div className="t">{title}<small>{sub}</small></div><button className="mscore" onClick={() => go("more")}>← More</button></div>;
}
const MORE_ITEMS: { v: View; e: string; n: string }[] = [
  { v: "onboard", e: "🪄", n: "My profile" }, { v: "plan", e: "🗓️", n: "Suggested plan" },
  { v: "library", e: "📚", n: "Exercise library" }, { v: "gyms", e: "🏋️", n: "My gyms" },
  { v: "spark", e: "✨", n: "Daily spark" }, { v: "analytics", e: "📊", n: "Analytics & badges" },
  { v: "achievements", e: "🏅", n: "Achievements" }, { v: "impact", e: "🌍", n: "Move for good" },
  { v: "reminders", e: "🔔", n: "Reminders" }, { v: "circle", e: "👥", n: "Community" },
  { v: "kidsaccess", e: "🧒", n: "Kids' access" },
];
export function More({ go }: { go: (v: View) => void }) {
  return (
    <>
      <div className="top"><div className="t">More<small>EVERYTHING ELSE</small></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, paddingTop: 12 }}>
        {MORE_ITEMS.map((it) => (
          <button key={it.v} className="card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => go(it.v)}>
            <div style={{ fontSize: 28 }}>{it.e}</div>
            <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{it.n}</div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ---- My profile (real inputs → drives the calcs) ---- */
const AGES: { label: string; mid: number }[] = [
  { label: "18–29", mid: 24 }, { label: "30–44", mid: 37 }, { label: "45–59", mid: 52 }, { label: "60+", mid: 65 },
];
const GENDERS: { label: string; v: Gender }[] = [
  { label: "Woman", v: "woman" }, { label: "Man", v: "man" }, { label: "Non-binary", v: "nb" },
];
const GOALS = ["Shape + abs", "Less stress", "More energy", "Sleep better", "Stay active"];
export function Onboard({ go }: { go: (v: View) => void }) {
  const { profile, setProfile } = useWellness();
  const [ageIdx, setAgeIdx] = useState<number | null>(profile.age ? AGES.findIndex((a) => a.mid === profile.age) : null);
  const [gender, setGender] = useState<Gender | null>(profile.gender ?? null);
  const [height, setHeight] = useState(profile.heightCm ? String(profile.heightCm) : "");
  const [goalKg, setGoalKg] = useState(profile.goalKg ? String(profile.goalKg) : "");
  const [goalSel, setGoalSel] = useState(0);
  const save = () => {
    setProfile({
      ...profile,
      age: ageIdx != null ? AGES[ageIdx].mid : undefined,
      gender: gender ?? undefined,
      heightCm: height ? parseFloat(height) : undefined,
      goalKg: goalKg ? parseFloat(goalKg) : undefined,
    });
    celebrate("🪄", "Profile saved!", "Kaya will now tune BMI, body fat & pace to you.");
    go("weight");
  };
  return (
    <>
      <Head title="My profile" sub="TUNES YOUR NUMBERS" go={go} />
      <p style={{ fontSize: 12.5, color: "var(--w-grey)", fontWeight: 600, lineHeight: 1.5, margin: "6px 0 14px" }}>
        Your details stay private and only tune your stats — they never gate any feature.
      </p>
      <div className="grouphdr you" style={{ paddingLeft: 0 }}>Your details</div>
      <div className="sec" style={{ padding: "4px 0 2px" }}><h3 style={{ fontSize: 13 }}>Age range</h3></div>
      <div className="selrow">{AGES.map((a, i) => <button key={a.label} className={`opt${ageIdx === i ? " on" : ""}`} onClick={() => setAgeIdx(i)}>{a.label}</button>)}</div>
      <div className="sec" style={{ padding: "12px 0 2px" }}><h3 style={{ fontSize: 13 }}>Gender</h3></div>
      <div className="selrow">{GENDERS.map((g) => <button key={g.v} className={`opt${gender === g.v ? " on" : ""}`} onClick={() => setGender(g.v)}>{g.label}</button>)}</div>
      <div className="sec" style={{ padding: "12px 0 6px" }}><h3 style={{ fontSize: 13 }}>Height (cm)</h3></div>
      <input className="wInput" type="number" inputMode="decimal" placeholder="e.g. 178" value={height} onChange={(e) => setHeight(e.target.value)} />
      <div className="sec" style={{ padding: "12px 0 6px" }}><h3 style={{ fontSize: 13 }}>Goal weight (kg, optional)</h3></div>
      <input className="wInput" type="number" inputMode="decimal" placeholder="e.g. 76" value={goalKg} onChange={(e) => setGoalKg(e.target.value)} />
      <div className="grouphdr" style={{ paddingLeft: 0, color: "var(--violet)" }}>What do you want to achieve?</div>
      <div className="selrow">{GOALS.map((g, i) => <button key={g} className={`opt${goalSel === i ? " on" : ""}`} onClick={() => setGoalSel(i)}>{g}</button>)}</div>
      <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={save}>Save profile</button>
    </>
  );
}

export function Plan({ go }: { go: (v: View) => void }) {
  const [intensity, setIntensity] = useState(1);
  const I = ["Easy", "Medium", "Hard"];
  return (
    <>
      <Head title="Suggested week" sub="BUILT FOR YOU" go={go} />
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>Pick your overall intensity</div>
        <div className="selrow" style={{ marginTop: 10 }}>{I.map((x, i) => <button key={x} className={`opt${intensity === i ? " on" : ""}`} onClick={() => setIntensity(i)}>{x}</button>)}</div>
        <p style={{ fontSize: 11, color: "var(--w-grey)", fontWeight: 600, marginTop: 8 }}>Scales every suggested session — tweak each one too.</p>
      </div>
      <div className="sec"><h3>Mon</h3></div>
      <div className="day"><div className="dl"><b>Breathe · 4-7-8</b><small>7:00 AM</small></div><span className="tag easy">Easy</span></div>
      <div className="day"><div className="dl"><b>Strength · Gym</b><small>6:30 PM</small></div><span className="tag med">Medium</span></div>
      <div className="sec"><h3>Wed</h3></div>
      <div className="day"><div className="dl"><b>Home workout</b><small>6:30 PM</small></div><span className="tag med">Medium</span></div>
      <div style={{ padding: "14px 0 0" }}>
        <button className="btn btn-primary" onClick={() => celebrate("🗓️", "Plan adopted!", "Your week is set. Reminders follow these times.")}>Adopt this plan</button>
        <button className="btn btn-ghost" style={{ marginTop: 9 }} onClick={() => go("library")}>Build my own</button>
      </div>
    </>
  );
}
const EX = [
  { ico: "🏋️", bg: "#ffeef0", n: "Full-body strength", tiers: ["Easy 15m", "Med 25m", "Hard 40m"] },
  { ico: "🤸", bg: "#fff5e0", n: "Bodyweight flow", tiers: ["Easy 10m", "Med 20m", "Hard 35m"] },
  { ico: "🌬️", bg: "#e8f8f5", n: "Box breathing", tiers: ["Easy 5m", "Med 10m"] },
  { ico: "📓", bg: "#f3effb", n: "Evening reflection", tiers: ["Easy 5m"] },
];
const tierCls = (t: string) => (t.startsWith("Easy") ? "easy" : t.startsWith("Med") ? "med" : "hard");
export function Library({ go }: { go: (v: View) => void }) {
  const [filter, setFilter] = useState(0);
  const cats = ["All", "Gym", "Home", "Breathe", "Reflect"];
  return (
    <>
      <Head title="Exercise library" sub="BUILD EXERCISE-WISE" go={go} />
      <div style={{ paddingTop: 10 }}><div className="selrow">{cats.map((c, i) => <button key={c} className={`opt${filter === i ? " on" : ""}`} onClick={() => setFilter(i)}>{c}</button>)}</div></div>
      <div className="card" style={{ marginTop: 12 }}>
        {EX.map((e) => (
          <div className="exrow" key={e.n}>
            <div className="exico" style={{ background: e.bg }}>{e.ico}</div>
            <div><b style={{ fontSize: 13 }}>{e.n}</b><div className="selrow" style={{ marginTop: 5 }}>{e.tiers.map((t) => <span key={t} className={`tag ${tierCls(t)}`}>{t}</span>)}</div></div>
            <button className="exadd" onClick={() => celebrate("➕", "Added!", `${e.n} added to your week.`)}>+</button>
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 0 0" }}><button className="btn btn-teal" style={{ width: "100%", padding: 13, fontSize: 14 }} onClick={() => go("plan")}>Back to my week →</button></div>
    </>
  );
}
type GymVenue = { id: string; name: string; type: string; emoji: string; primary: boolean; visits: number };
const GYM_TYPES2 = [{ t: "Gym", e: "🏋️" }, { t: "Pool", e: "🏊" }, { t: "Studio", e: "🧘" }, { t: "Other", e: "🥊" }];
export function Gyms({ go }: { go: (v: View) => void }) {
  const [gyms, setGyms] = useState<GymVenue[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState(0);
  const [primary, setPrimary] = useState(true);

  const save = () => {
    const nm = name.trim();
    if (!nm) return;
    const t = GYM_TYPES2[type];
    setGyms((prev) => {
      const next = primary ? prev.map((g) => ({ ...g, primary: false })) : [...prev];
      return [...next, { id: `${nm}-${next.length}`, name: nm, type: t.t, emoji: t.e, primary: primary || prev.length === 0, visits: 0 }];
    });
    celebrate("🏋️", "Gym registered!", `${nm} added — now tracking your visits.`);
    setName(""); setType(0); setPrimary(true); setAdding(false);
  };
  const remove = (id: string) => setGyms((prev) => prev.filter((g) => g.id !== id));

  return (
    <>
      <Head title="My gyms" sub="KEEP TRACK OF VISITS" go={go} />
      <p style={{ fontSize: 12.5, color: "var(--w-grey)", fontWeight: 600, paddingTop: 6 }}>Register where you train so Kaya can track your visits.</p>

      <div className="sec"><h3>Registered</h3></div>
      {gyms.length === 0 && !adding && (
        <div className="card" style={{ textAlign: "center", color: "var(--w-grey)", fontWeight: 600, fontSize: 12.5 }}>No gyms yet — add the place you train.</div>
      )}
      {gyms.map((g) => (
        <div className="listitem" key={g.id}>
          <div className="ico" style={{ background: "rgba(216,90,48,.14)" }}>{g.emoji}</div>
          <div className="m"><b>{g.name}</b><small>{g.type} · 🔥 {g.visits} visits</small></div>
          {g.primary && <span className="tag easy" style={{ marginRight: 6 }}>Primary</span>}
          <button className="btn btn-ghost" style={{ width: "auto", padding: "6px 10px", fontSize: 11 }} onClick={() => remove(g.id)}>Remove</button>
        </div>
      ))}

      {adding ? (
        <div className="card">
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>Register a gym</div>
          <div className="selrow" style={{ marginTop: 9 }}>
            <button className="opt" onClick={() => celebrate("📸", "Coming soon", "Brochure scan activates once the AI key is set.")}>📸 Scan brochure</button>
            <button className="opt" onClick={() => celebrate("🔎", "Coming soon", "Online venue search activates once the places key is set.")}>🔎 Search online</button>
          </div>
          <input className="wInput" style={{ textAlign: "left", fontSize: 13, fontWeight: 600, marginTop: 9, width: "100%" }} placeholder="Gym name (e.g. FitZone Masaki)" value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 10 }}>Type</div>
          <div className="selrow">{GYM_TYPES2.map((g, i) => <button key={g.t} className={`opt${type === i ? " on" : ""}`} onClick={() => setType(i)}>{g.e} {g.t}</button>)}</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            <button type="button" className={`gtick${primary ? " done" : ""}`} style={{ width: 22, height: 22, fontSize: 12 }} onClick={() => setPrimary(!primary)} aria-label="primary">{primary ? "✓" : ""}</button>
            Set as my primary gym
          </label>
          <button className="btn btn-coral" style={{ width: "100%", padding: 12, marginTop: 11, opacity: name.trim() ? 1 : 0.5 }} onClick={save}>Save gym</button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
        </div>
      ) : (
        <div style={{ padding: "12px 0 0" }}>
          <button className="btn btn-coral" style={{ width: "100%", padding: 13, fontSize: 14 }} onClick={() => setAdding(true)}>+ Register a gym</button>
        </div>
      )}
    </>
  );
}
export function Spark({ go }: { go: (v: View) => void }) {
  return (
    <div className="spark-bg">
      <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 700 }}>YOUR DAILY SPARK</div>
      <div style={{ fontSize: 42 }}>✨</div>
      <div className="spark-q">&ldquo;{SPARK_QUOTE}&rdquo;</div>
      <div className="spark-why">A fresh line of motivation, every morning.</div>
      <button className="btn" style={{ background: "rgba(255,255,255,.2)", color: "#fff", padding: "13px 22px", marginTop: 26 }} onClick={() => go("home")}>Start today&apos;s ritual</button>
      <button className="btn" style={{ background: "transparent", border: "1.5px solid rgba(255,255,255,.45)", color: "#fff", padding: "12px 22px", marginTop: 10 }} onClick={() => celebrate("✨", "Shared!", "Your spark card is on its way.")}>Share this card</button>
    </div>
  );
}
const BADGES = [{ e: "🌱", n: "first ritual" }];
const LOCKED = [{ e: "🔥", n: "7-day" }, { e: "🌅", n: "early bird" }, { e: "📓", n: "reflector" }, { e: "🏔️", n: "30-day" }, { e: "💪", n: "50 moves" }, { e: "🌳", n: "tree" }, { e: "⭐", n: "locked" }];
export function Achievements({ go }: { go: (v: View) => void }) {
  return (
    <>
      <Head title="Achievements" sub="LEVEL & BADGES" go={go} />
      <div className="lvl"><div className="ln">Level 1 · Seedling</div><div className="lx">0 / 200 XP to Sprout</div><div className="xpbar"><i style={{ width: "2%" }} /></div></div>
      <div className="sec"><h3>Your badges</h3></div>
      <div className="badges">
        {BADGES.map((b) => <div className="badge lock" key={b.n}>{b.e}<small>{b.n}</small></div>)}
        {LOCKED.map((b) => <div className="badge lock" key={b.n}>{b.e}<small>{b.n}</small></div>)}
      </div>
      <div className="sec"><h3>Grow your Kaya</h3></div>
      <div className="plant"><div className="em">🌱</div><div className="st">Seed</div><p>Show up daily and it grows — sprout → sapling → tree.</p></div>
    </>
  );
}
export function Impact({ go }: { go: (v: View) => void }) {
  return (
    <>
      <Head title="Move for good" sub="REAL-WORLD IMPACT" go={go} />
      <div className="impact">
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>YOUR MINUTES THIS SEASON</div>
        <div className="big">0 min</div>
        <div className="pbar"><i style={{ width: "0%" }} /></div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 8, fontWeight: 600 }}>Move to unlock your first milestone — plant a tree 🌳</div>
      </div>
      <div className="sec"><h3>Milestones</h3></div>
      <div className="listitem" style={{ opacity: 0.7 }}><div className="ico" style={{ background: "#cdbef0" }}>⬜</div><div className="m"><b>500 min — plant a tree 🌳</b><small>500 min to go</small></div></div>
      <div className="listitem" style={{ opacity: 0.7 }}><div className="ico" style={{ background: "#cdbef0" }}>⬜</div><div className="m"><b>1,000 min — clean water day 💧</b><small>1,000 min to go</small></div></div>
      <div className="listitem" style={{ opacity: 0.7 }}><div className="ico" style={{ background: "#cdbef0" }}>⬜</div><div className="m"><b>2,500 min — a child&apos;s sports kit ⚽</b><small>2,500 min to go</small></div></div>
    </>
  );
}
function Toggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  return <button className={`toggle${on ? "" : " off"}`} onClick={() => setOn(!on)} aria-label="toggle" />;
}
export function Reminders({ go }: { go: (v: View) => void }) {
  return (
    <>
      <Head title="Reminders" sub="FROM YOUR PLAN" go={go} />
      <div className="card" style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><b style={{ fontSize: 13 }}>Sync to schedule</b><small style={{ display: "block", color: "var(--w-grey)", fontSize: 11, fontWeight: 600 }}>Reminders follow your plan times</small></div>
        <Toggle on={true} />
      </div>
      <div className="sec"><h3>Morning</h3></div>
      <div className="remrow"><div className="rl"><b>Weigh-in · 5:30 AM</b><small>First thing, after waking</small></div><Toggle on={true} /></div>
      <div className="remrow"><div className="rl"><b>Cardio + abs · 5:45 AM</b><small>Zone-2 walk</small></div><Toggle on={true} /></div>
      <div className="sec"><h3>Evening</h3></div>
      <div className="remrow"><div className="rl"><b>Strength · 6:30 PM</b><small>Gym session</small></div><Toggle on={true} /></div>
      <div className="remrow"><div className="rl"><b>Wind down · 9:30 PM</b><small>3 breaths before bed</small></div><Toggle on={false} /></div>
      <p style={{ fontSize: 11, color: "var(--w-grey)", fontWeight: 600, textAlign: "center", marginTop: 12 }}>Busy day? Kaya offers to move the nudge — never marks a failure.</p>
    </>
  );
}
