"use client";
import { useState } from "react";
import { celebrate } from "./fx";
import { useWellness, todayStr, GymEntry, Period, DietApproach } from "./state";
import { useNav } from "./nav";

function Crumb({ label }: { label: string }) {
  const { back, canBack } = useNav();
  if (!canBack) return null;
  return <button className="crumb" onClick={back}>‹ {label}</button>;
}

/* ---- Pillar sessions (fix 4: pillars work) ---- */
const PILLAR_SESSIONS: Record<string, { title: string; sub: string; sessions: { n: string; sub: string; tag: string; lab: string }[] }> = {
  gym: { title: "Gym 🏋️", sub: "CHOOSE A SESSION", sessions: [
    { n: "Full-body strength", sub: "8 exercises · ~25 min", tag: "med", lab: "Med" },
    { n: "Push day", sub: "Chest · shoulders · triceps", tag: "hard", lab: "Hard" },
    { n: "CrossFit WOD", sub: "AMRAP 20 min", tag: "hard", lab: "Hard" },
  ] },
  home: { title: "At-home 🤸", sub: "NO EQUIPMENT", sessions: [
    { n: "Bodyweight flow", sub: "Full body · ~20 min", tag: "med", lab: "Med" },
    { n: "Quick reset", sub: "Mobility · 10 min", tag: "easy", lab: "Easy" },
  ] },
  breathe: { title: "Breathe 🌬️", sub: "CALM & FOCUS", sessions: [
    { n: "4-7-8 breathing", sub: "Wind down · 5 min", tag: "easy", lab: "Easy" },
    { n: "Box breathing", sub: "Focus · 6 min", tag: "easy", lab: "Easy" },
  ] },
  reflect: { title: "Reflect 📓", sub: "JOURNAL & MOOD", sessions: [
    { n: "Evening reflection", sub: "3 prompts · 5 min", tag: "easy", lab: "Easy" },
    { n: "Gratitude note", sub: "One line · 2 min", tag: "easy", lab: "Easy" },
  ] },
};
export function PillarSessions() {
  const { param } = useNav();
  const { bumpRitualStreak } = useWellness();
  const p = PILLAR_SESSIONS[param] ?? PILLAR_SESSIONS.gym;
  return (
    <>
      <Crumb label="Today" />
      <div className="top"><div className="t">{p.title}<small>{p.sub}</small></div></div>
      {p.sessions.map((s) => (
        <div className="card" key={s.n}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 13 }}>{s.n}</b><span className={`tag ${s.tag}`}>{s.lab}</span>
          </div>
          <div className="note" style={{ marginTop: 3 }}>{s.sub}</div>
          <button className="btn btn-teal" style={{ width: "100%", padding: 10, fontSize: 13, marginTop: 9 }}
            onClick={() => { bumpRitualStreak(); celebrate("🔥", "Session done!", "Streak kept alive. Small rituals, real change."); }}>
            Start session
          </button>
        </div>
      ))}
    </>
  );
}

/* ---- Mood history (fix 5: mood saved) ---- */
const MOOD_EMOJI = ["😣", "😕", "🙂", "😄", "🤩"];
const MOOD_LABEL = ["Drained", "Low", "OK", "Good", "Great"];
export function MoodHistory() {
  const { moods } = useWellness();
  return (
    <>
      <Crumb label="Today" />
      <div className="top"><div className="t">Mood history<small>HOW YOU&apos;VE FELT</small></div></div>
      {moods.length === 0 ? (
        <div className="card" style={{ textAlign: "center" }}><div style={{ fontSize: 32 }}>🙂</div><p className="note" style={{ marginTop: 8 }}>No check-ins yet. Tap a mood on Today and it&apos;s saved here.</p></div>
      ) : (
        <div className="card">
          {moods.slice(0, 30).map((m, i) => (
            <div className="rowline" key={i}>
              <div className="ic" style={{ background: "#f3effb", fontSize: 18 }}>{MOOD_EMOJI[m.level]}</div>
              <div className="m"><b>{MOOD_LABEL[m.level]}</b><small>{m.date} · {m.period}</small></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---- Edit home (personalized home) ---- */
export function EditHome() {
  const { homeCards, toggleHomeCard } = useWellness();
  return (
    <>
      <Crumb label="Today" />
      <div className="top"><div className="t">Edit your home<small>SHOW WHAT MATTERS</small></div></div>
      <div className="card">
        {homeCards.map((c) => (
          <div className="trow" key={c.id}>
            <div className="m"><b>{c.label}</b></div>
            <button className={`toggle${c.on ? "" : " off"}`} aria-label="toggle" onClick={() => toggleHomeCard(c.id)} />
          </div>
        ))}
      </div>
      <p className="note" style={{ textAlign: "center", marginTop: 8 }}>Always-on basics stay. Reordering coming soon.</p>
    </>
  );
}

/* ---- Gym log (1, 1a CrossFit, backdate, AM/PM, record days) ---- */
const GYM_TYPES = ["💪 Strength", "🏃 Cardio", "🤸 CrossFit", "🧘 Mobility", "⚽ Sport"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function last7(): { ds: string; lab: string }[] {
  const out: { ds: string; lab: string }[] = [];
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ ds, lab: i === 0 ? "Today" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] });
    d.setDate(d.getDate() - 1);
  }
  return out;
}
export function GymLog() {
  const { logGym, recordDays, setRecordDays } = useWellness();
  const days = last7();
  const [place, setPlace] = useState<"gym" | "home" | "rest">("gym");
  const [type, setType] = useState(0);
  const [period, setPeriod] = useState<Period>("morning");
  const [date, setDate] = useState(todayStr());
  const [details, setDetails] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const toggleRec = (d: string) => setRecordDays(recordDays.includes(d) ? recordDays.filter((x) => x !== d) : [...recordDays, d]);

  const save = () => {
    const e: GymEntry = { date, place, type: GYM_TYPES[type], period, details: details.trim() || undefined };
    logGym(e);
    celebrate("🏋️", "Logged!", place === "rest" ? "Rest logged — recovery counts." : `${GYM_TYPES[type]} · ${date === todayStr() ? "today" : date}.`);
  };

  return (
    <>
      <Crumb label="Goals" />
      <div className="top"><div className="t">Gym log<small>STRAIGHT TO IT</small></div></div>
      <div className="card">
        <div style={{ fontSize: 12, fontWeight: 800 }}>Did you train?</div>
        <div className="seg" style={{ marginTop: 8 }}>
          {(["gym", "home", "rest"] as const).map((pl) => (
            <div key={pl} className={place === pl ? "selt" : ""} onClick={() => setPlace(pl)}>{pl === "gym" ? "✓ Gym" : pl === "home" ? "🏠 Home" : "⏭️ Rest"}</div>
          ))}
        </div>
        {place !== "rest" && (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, marginTop: 11 }}>Type</div>
            <div className="selrow">{GYM_TYPES.map((t, i) => <button key={t} className={`opt${type === i ? " on" : ""}`} onClick={() => setType(i)}>{t}</button>)}</div>
          </>
        )}
        <div style={{ fontSize: 11, fontWeight: 800, marginTop: 11 }}>When</div>
        <div className="seg" style={{ marginTop: 6 }}>
          <div className={period === "morning" ? "selt" : ""} onClick={() => setPeriod("morning")}>🌅 Morning</div>
          <div className={period === "evening" ? "selt" : ""} onClick={() => setPeriod("evening")}>🌙 Evening</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, marginTop: 11 }}>Which day (last 7)</div>
        <div className="selrow">{days.map((d) => <button key={d.ds} className={`opt${date === d.ds ? " on" : ""}`} onClick={() => setDate(d.ds)}>{d.lab}</button>)}</div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>✓ Log it</button>
        {!showDetails ? (
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setShowDetails(true)}>＋ Add details (optional)</button>
        ) : (
          <textarea className="wInput" style={{ marginTop: 8, textAlign: "left", fontSize: 13, fontWeight: 600, minHeight: 60, width: "100%" }}
            placeholder="Sets, weights, how it felt…" value={details} onChange={(e) => setDetails(e.target.value)} />
        )}
      </div>
      <div className="sec"><h3>Remind me on</h3><div className="hint">shows in My Day</div></div>
      <div className="selrow" style={{ padding: "0 2px" }}>{WEEK.map((d) => <button key={d} className={`opt${recordDays.includes(d) ? " on" : ""}`} onClick={() => toggleRec(d)}>{d}</button>)}</div>
      <p className="note" style={{ textAlign: "center", marginTop: 8 }}>On these days your gym log surfaces in My Day so you never forget. 🔔 <i>(My Day wiring ships with persistence.)</i></p>
    </>
  );
}

/* ---- Sports (4) ---- */
const SPORTS = [
  { e: "🎾", n: "Tennis" }, { e: "🏓", n: "Pickleball" }, { e: "⚽", n: "Football" },
  { e: "🏸", n: "Badminton" }, { e: "🎾", n: "Padel" }, { e: "🏊", n: "Swimming" },
  { e: "🏀", n: "Basketball" }, { e: "🏃", n: "Running" }, { e: "🚴", n: "Cycling" },
  { e: "🏐", n: "Volleyball" }, { e: "⛳", n: "Golf" }, { e: "🥊", n: "Boxing" },
];
const SPORTS_NEWS = [
  { e: "🎾", h: "Padel surges across East Africa as new courts open" },
  { e: "⚽", h: "Weekend fixtures & results round-up" },
];
export function Sports() {
  const { goWith } = useNav();
  const { sports, removeSport } = useWellness();
  return (
    <>
      <Crumb label="Today" />
      <div className="top"><div className="t">Sports<small>PICK YOURS</small></div></div>
      <div className="sportgrid">
        {SPORTS.map((s) => (
          <button key={s.n} className="sport" onClick={() => goWith("sportsetup", s.n)}>
            <span className="e">{s.e}</span>{s.n}
          </button>
        ))}
      </div>
      {sports.length > 0 && (
        <>
          <div className="sec"><h3>My sports</h3></div>
          <div className="card">
            {sports.map((s) => (
              <div className="rowline" key={s.id}>
                <div className="ic" style={{ background: "#e8f8f5", fontSize: 18 }}>{s.emoji}</div>
                <div className="m"><b>{s.name}</b><small>{s.venue || "No venue"} · {s.days.join("/")} · {s.time}</small></div>
                <button className="btn btn-ghost" style={{ width: "auto", padding: "6px 10px", fontSize: 11 }} onClick={() => removeSport(s.id)}>Remove</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sec"><h3>Sports news</h3><div className="hint">your favourites</div></div>
      <div className="card">
        {SPORTS_NEWS.map((n, i) => (
          <div className="news" key={i}><div className="th">{n.e}</div><div className="b"><b>{n.h}</b><small>Sport News · Share ↗</small></div></div>
        ))}
      </div>
      <p className="note" style={{ textAlign: "center", marginTop: 8 }}><i>Live news + venue search activate once the keys are set.</i></p>
    </>
  );
}
export function SportSetup() {
  const { param, back } = useNav();
  const { addSport } = useWellness();
  const emoji = SPORTS.find((s) => s.n === param)?.e ?? "🎾";
  const [venue, setVenue] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState("18:00");
  const [myDay, setMyDay] = useState(true);
  const [email, setEmail] = useState(true);
  const toggle = (d: string) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  const save = () => {
    addSport({ id: `${param}-${time}`, name: param, emoji, venue, days, time, myDay, email });
    celebrate("🎾", "Sport saved!", `${param}${days.length ? " · " + days.join("/") : ""} — ${myDay ? "in My Day" : "saved"}.`);
    back();
  };
  return (
    <>
      <Crumb label="Sports" />
      <div className="top"><div className="t">Set up · {param} {emoji}<small>SCHEDULE & REMIND</small></div></div>
      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 800 }}>Where</div>
        <input className="wInput" style={{ textAlign: "left", fontSize: 13, fontWeight: 600, marginTop: 6, width: "100%" }} placeholder="🔎 Search a venue…" value={venue} onChange={(e) => setVenue(e.target.value)} />
        <div className="note" style={{ marginTop: 4 }}>Real venue search activates with the places key — shared with gym &amp; restaurants.</div>
        <div style={{ fontSize: 11, fontWeight: 800, marginTop: 11 }}>Which days</div>
        <div className="selrow">{WEEK.map((d) => <button key={d} className={`opt${days.includes(d) ? " on" : ""}`} onClick={() => toggle(d)}>{d}</button>)}</div>
        <div style={{ fontSize: 11, fontWeight: 800, marginTop: 11 }}>Time</div>
        <input className="wInput" type="time" style={{ textAlign: "left", fontSize: 14, fontWeight: 700, marginTop: 6, width: "100%" }} value={time} onChange={(e) => setTime(e.target.value)} />
        <div className="trow" style={{ marginTop: 8 }}><div className="m"><b>📅 Show in My Day</b></div><button className={`toggle${myDay ? "" : " off"}`} aria-label="myday" onClick={() => setMyDay(!myDay)} /></div>
        <div className="trow" style={{ border: "none" }}><div className="m"><b>📧 Email reminder</b><small>So you never skip</small></div><button className={`toggle${email ? "" : " off"}`} aria-label="email" onClick={() => setEmail(!email)} /></div>
        <button className="btn btn-coral" style={{ width: "100%", padding: 12, marginTop: 10 }} onClick={save}>Save sport</button>
        <p className="note" style={{ textAlign: "center", marginTop: 8 }}><i>Email reminders fire once the email cron is enabled.</i></p>
      </div>
    </>
  );
}

/* ---- Analytics + neutral badges (3) ---- */
export function Analytics() {
  const { activityStreak, gymLogs, moods } = useWellness();
  const sessions = gymLogs.filter((g) => g.place !== "rest").length;
  // simple 8-week bar heights from gym log counts (placeholder distribution)
  const bars = [40, 55, 50, 70, 65, 80, 75, 90];
  const badges = [
    { e: "🌱", n: "First log", got: gymLogs.length > 0 },
    { e: "🔥", n: "3-day", got: activityStreak >= 3 },
    { e: "🎯", n: "7-day", got: activityStreak >= 7 },
    { e: "📈", n: "10 sessions", got: sessions >= 10 },
    { e: "🌅", n: "Early riser", got: gymLogs.some((g) => g.period === "morning") },
    { e: "🙂", n: "Mood week", got: moods.length >= 7 },
    { e: "🏔️", n: "30-day", got: activityStreak >= 30 },
    { e: "⭐", n: "Locked", got: false },
  ];
  return (
    <>
      <Crumb label="More" />
      <div className="top"><div className="t">Your consistency<small>ANALYTICS</small></div></div>
      <div className="focus" style={{ display: "block" }}>
        <div className="meta" style={{ opacity: 1 }}>
          <div className="k" style={{ opacity: .85 }}>🔥 CURRENT STREAK</div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{activityStreak} {activityStreak === 1 ? "day" : "days"}</div>
          <div style={{ fontSize: 11, opacity: .9 }}>Log consistently to grow it 🌱</div>
        </div>
      </div>
      <div className="statgrid" style={{ marginTop: 10 }}>
        <div className="stat"><div className="sl">Sessions</div><div className="sv">{sessions}</div></div>
        <div className="stat"><div className="sl">Mood check-ins</div><div className="sv">{moods.length}</div></div>
      </div>
      <div className="sec"><h3>Last 8 weeks</h3></div>
      <div className="barchart">{bars.map((h, i) => <div key={i} style={{ height: `${h}%` }} />)}</div>
      <div className="sec"><h3>Badges</h3><div className="hint">calm &amp; neutral</div></div>
      <div className="badgewrap">
        {badges.map((b) => <div className={`badge${b.got ? "" : " lock"}`} key={b.n}>{b.e}<small>{b.n}</small></div>)}
      </div>
    </>
  );
}

/* ---- Diet & fasting (PR C) — Food + Movement + Exercise ---- */
const APPROACHES: { key: DietApproach; emoji: string; name: string; desc: string; caution?: boolean }[] = [
  { key: "none", emoji: "🍽️", name: "No fasting", desc: "Just eat well across the day" },
  { key: "if168", emoji: "🕗", name: "Intermittent Fasting · 16:8", desc: "Eat in an 8-hour window, fast 16h — popular & flexible" },
  { key: "windows", emoji: "⏱️", name: "Eating Windows", desc: "Pick your own window — Kaya reminds you to open & close it" },
  { key: "water", emoji: "💧", name: "Water Fasting", desc: "Advanced · short & supervised", caution: true },
];
const DIET_GUIDE = [
  "🥩 Protein every meal (~2 g/kg)",
  "🥗 Veg + measured carbs, timed around training",
  "💧 3–4 L water/day — first glass on waking",
  "🚫 Cut sugary drinks & fried snacks first",
];
const REMINDER_DEFS: { id: string; emoji: string; label: string; sub: string }[] = [
  { id: "weighIn", emoji: "⚖️", label: "Daily weigh-in", sub: "First thing, after waking" },
  { id: "windowOpen", emoji: "🕗", label: "Eating window opens", sub: "Start of your window" },
  { id: "windowClose", emoji: "🌙", label: "Window closes / fast starts", sub: "End of your window" },
  { id: "hydration", emoji: "💧", label: "Hydration nudges", sub: "A few times through the day" },
  { id: "training", emoji: "🏋️", label: "Training reminder", sub: "On your gym days" },
  { id: "weeklyReview", emoji: "📅", label: "Weekly review", sub: "Sun · photo · waist · weight" },
];
export function Diet() {
  const { dietApproach, setDietApproach, eatingWindow, setEatingWindow, reminders, toggleReminder } = useWellness();
  const windowed = dietApproach === "if168" || dietApproach === "windows";
  return (
    <>
      <Crumb label="Weight" />
      <div className="top"><div className="t">Food &amp; fasting<small>FOOD + MOVEMENT + EXERCISE</small></div></div>
      <div className="card" style={{ marginTop: 0, background: "#fff8ec", border: "1px solid #fbe6bd" }}>
        <p className="note" style={{ color: "#8a5e12" }}>⚠️ General wellness guidance — <b style={{ color: "#7a4d00" }}>not medical advice</b>. Talk to a doctor before fasting or a big deficit. Fasting is for adults.</p>
      </div>

      <div className="card" style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
        <div><div style={{ fontSize: 28 }}>🍎</div><div style={{ fontSize: 11, fontWeight: 800 }}>Food</div><div className="note">~70%</div></div>
        <div style={{ alignSelf: "center", color: "#c7bfe0", fontWeight: 800 }}>+</div>
        <div><div style={{ fontSize: 28 }}>🏃</div><div style={{ fontSize: 11, fontWeight: 800 }}>Movement</div><div className="note">daily</div></div>
        <div style={{ alignSelf: "center", color: "#c7bfe0", fontWeight: 800 }}>+</div>
        <div><div style={{ fontSize: 28 }}>💪</div><div style={{ fontSize: 11, fontWeight: 800 }}>Exercise</div><div className="note">shape</div></div>
      </div>

      <div className="sec"><h3>Your guidance</h3><div className="hint">high-level</div></div>
      <div className="card">
        <ul style={{ listStyle: "none", fontSize: 12.5, fontWeight: 600, color: "#5a4660", lineHeight: 2 }}>
          {DIET_GUIDE.map((g) => <li key={g}>{g}</li>)}
        </ul>
        <p className="note" style={{ marginTop: 4 }}>Scales with your pace plan — Aggressive tightens the deficit, Relaxed loosens it.</p>
      </div>

      <div className="sec"><h3>Eating approach</h3><div className="hint">adults · optional</div></div>
      {APPROACHES.map((a) => (
        <div key={a.key} className="card" style={{ marginTop: 8, cursor: "pointer", borderColor: dietApproach === a.key ? "var(--teal)" : undefined, background: dietApproach === a.key ? "#f1fbf9" : undefined }} onClick={() => { setDietApproach(a.key); if (a.key !== "none") celebrate(a.emoji, "Approach set", a.name); }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 19, flex: "none", background: a.caution ? "#ffeef0" : "#e8f1ff" }}>{a.emoji}</div>
            <div style={{ flex: 1 }}><b style={{ fontSize: 12.5 }}>{a.name}</b><div className="note">{a.desc}</div></div>
            {dietApproach === a.key && <span className="tag easy">on</span>}
          </div>
          {a.caution && dietApproach === a.key && <p className="note" style={{ color: "#d4455a", marginTop: 8 }}>⚠️ Check with a doctor first. Keep fasts short and stop if you feel unwell.</p>}
        </div>
      ))}

      {windowed && (
        <div className="card">
          <div style={{ fontSize: 12, fontWeight: 800 }}>Your eating window</div>
          <div className="selrow" style={{ marginTop: 8, alignItems: "center" }}>
            <input className="wInput" type="time" style={{ fontSize: 14, fontWeight: 700, width: "auto", flex: 1 }} value={eatingWindow.start} onChange={(e) => setEatingWindow({ ...eatingWindow, start: e.target.value })} />
            <span style={{ fontWeight: 800, color: "var(--w-grey)" }}>→</span>
            <input className="wInput" type="time" style={{ fontSize: 14, fontWeight: 700, width: "auto", flex: 1 }} value={eatingWindow.end} onChange={(e) => setEatingWindow({ ...eatingWindow, end: e.target.value })} />
          </div>
          <p className="note" style={{ marginTop: 6 }}>Turn on the window reminders below to be nudged to open &amp; close it.</p>
        </div>
      )}

      <div className="sec"><h3>Reminders</h3><div className="hint">in-app + email</div></div>
      <div className="card">
        {REMINDER_DEFS.map((r) => (
          <div className="trow" key={r.id}>
            <div className="ic" style={{ background: "#f3effb" }}>{r.emoji}</div>
            <div className="m"><b>{r.label}</b><small>{r.sub}</small></div>
            <button className={`toggle${reminders[r.id] ? "" : " off"}`} aria-label={r.label} onClick={() => toggleReminder(r.id)} />
          </div>
        ))}
      </div>
      <p className="note" style={{ textAlign: "center", marginTop: 8 }}>Reminders save now; they start firing once the scheduled-reminders service is switched on.</p>
      <div className="pageend" />
    </>
  );
}
