import type { CSSProperties } from "react";

export type ModuleTag = "kid" | "parent" | "both" | "soon";

export interface UniverseModule {
  key: string;
  num: number;
  name: string;
  icon: string;
  color: string;
  bg: string;
  tags: ModuleTag[];
  /** Public website surface (short pitch + why-it-matters). */
  webPitch: string;
  webWhy: string;
  /** In-app walk-through surface (pitch + features + try-this-first tip). */
  pitch: string;
  features: string[];
  tip: string;
  /** Live in-app route for the "Open {Module}" deep link. Omitted for Soon modules. */
  route?: string;
}

/**
 * The 13 Kaya modules in storyline order. Copy is verbatim from the approved
 * mockups (Kaya_Universe_Website / _InApp 2026-05-28) and the 2026-05-29 build
 * prompt. NOTE: Buzz (#10) had no website-style blurb in the 05-28 website draft
 * (it predated Buzz) — webPitch/webWhy for Buzz are drafted from the approved
 * in-app copy, pending Elia's tweak.
 */
export const MODULES: UniverseModule[] = [
  {
    key: "points", num: 1, name: "Kaya Points", icon: "🏆", color: "#FF6B6B", bg: "#FFE3E3",
    tags: ["both"],
    webPitch: "The heartbeat of the app. <b>Daily routines, ratings, and house points</b> that turn a chaotic morning into a winning streak.",
    webWhy: "Small daily wins add up. Parents stop nagging — kids start celebrating.",
    pitch: "This is where the magic starts. <b>Make your bed. Brush your teeth. Be kind.</b> Tiny daily wins turn into BIG points for your house.",
    features: ["Daily routines with emoji ratings", "House points (1, 2, 3, 5 + Diamond Bonus)", "Streaks and weekly awards"],
    tip: "Rate your morning routine first — it's the fastest way to feel the points roll in.",
  },
  {
    key: "sparks", num: 2, name: "Kaya Sparks", icon: "✨", color: "#FFC93C", bg: "#FFF3CD",
    tags: ["both"],
    webPitch: "Where <b>school projects, achievements, and PTM follow-ups</b> stop getting lost. Every spark of brilliance, captured.",
    webWhy: "Creativity and academic wins finally have a home that doesn't end up on a forgotten shelf.",
    pitch: "Did you build something awesome? Win a medal? Ace a test? <b>Sparks remembers everything</b> — forever.",
    features: ["School + home projects with photo proof", "Achievements wall (certificates, awards)", "Term results, PTM follow-ups, sports schedules"],
    tip: "Snap a photo of your latest project — Sparks puts it on your wall instantly.",
  },
  {
    key: "hive", num: 3, name: "The Hive", icon: "🍯", color: "#8C5BFF", bg: "#E8DEFF",
    tags: ["kid", "parent"],
    webPitch: "Three layers of money kids can feel. <b>Points → Honey Coins → Real cash</b>, earned and parent-approved.",
    webWhy: "Kids learn money is something you earn, save, then spend — not magic that appears.",
    pitch: "Points become coins. Coins become <b>real money</b>. Save like a bee, spend like a boss — parent-approved every step.",
    features: ["3 layers: House Points → Honey Coins → Cash", "Parent-set exchange rates", "Approval flow on every cash request"],
    tip: "Try converting 100 House Points to Honey Coins — see how it feels to save.",
  },
  {
    key: "business", num: 4, name: "Kaya Business", icon: "🌱", color: "#3DCC91", bg: "#D7F5EA",
    tags: ["kid"],
    webPitch: "<b>Real micro-enterprises</b> — passion fruit, chickens, mangoes. Track sales, costs, weekly reports.",
    webWhy: "Not pretend money. Real revenue routes to a real wallet. Childhood entrepreneurship, properly built.",
    pitch: "Run a real micro-enterprise — passion fruit, chickens, mangoes. <b>You're the boss</b>.",
    features: ["Asset Library (pick chickens, fruit, etc.)", "Track sales, costs, weekly reports", "Revenue routes into your Hive wallet"],
    tip: "Set up your first business in 60 seconds — pick a template from the library.",
  },
  {
    key: "moments", num: 5, name: "Moments", icon: "📸", color: "#7BE0C8", bg: "#D5EEFF",
    tags: ["both"],
    webPitch: "The family feed — <b>but private</b>. Photos, milestones, little wins. The home album that never fills up your camera roll.",
    webWhy: "The good stuff lives in one safe place — just for the people who love each other.",
    pitch: "The family's private photo wall. Snap the good stuff. <b>Only your family sees it.</b>",
    features: ["Photo + milestone capture", "Family-only — no strangers, no likes", "Live stream of small daily wins"],
    tip: "Drop one photo today — your family will see it instantly.",
  },
  {
    key: "dreams", num: 6, name: "Kaya Dreams", icon: "🌟", color: "#FFC93C", bg: "#FFE9C4",
    tags: ["kid"],
    webPitch: "\"Learn to swim.\" \"Summit Kili.\" \"Read 50 books.\" <b>Big aspirations</b>, broken into stepping stones, witnessed by family.",
    webWhy: "Dreams stop being vague wishes — they become dated, doable, supported by everyone.",
    pitch: "\"Learn to swim.\" \"Climb Kili.\" \"Read 50 books.\" <b>Big dreams. Tiny steps.</b> Your family cheers you on.",
    features: ["AI breaks each dream into 5–10 stepping stones", "Milestone witnesses — family confirms each step", "Dream Fund — family contributes Honey Coins"],
    tip: "Tell Kaya your biggest dream — watch it become a real plan.",
  },
  {
    key: "household", num: 7, name: "Household", icon: "🏡", color: "#5BC0EB", bg: "#C8E8FF",
    tags: ["parent"],
    webPitch: "<b>Pantry. Utilities. Helpers. Bills. Visitor list. Emergency info.</b> The brain of the house — never frantic again.",
    webWhy: "Running a home is a full-time job. Kaya makes it a five-minute one.",
    pitch: "The brain of the house. <b>Pantry, utilities, helpers, bills, visitors, emergencies</b> — all tidy, all together.",
    features: ["Pantry + shopping list", "Utility tracking (water, electric, internet, gas)", "Helper schedules + recurring maintenance"],
    tip: "Add this month's utility readings — Kaya tracks the rest.",
  },
  {
    key: "pages", num: 8, name: "Pages", icon: "📒", color: "#FFB385", bg: "#FFE6B0",
    tags: ["parent"],
    webPitch: "The family's <b>smart address book</b>. Suppliers, school contacts, doctors. Every important person is a Page you can trust.",
    webWhy: "The right contact, the right context, the right time — without scrolling through 2,000 numbers.",
    pitch: "Every important person is a <b>Page</b>. Doctor. Plumber. School teacher. Vegetable guy. Find them fast.",
    features: ["Smart address book with photos + notes", "Reliability ratings on every contact", "Linked to past transactions"],
    tip: "Add your top 5 trusted contacts now — they'll be one tap away forever.",
  },
  {
    key: "fun", num: 9, name: "Fun", icon: "🎉", color: "#FF9CC1", bg: "#FFD1E0",
    tags: ["both"],
    webPitch: "<b>No points. No ratings. Just joy.</b> Trivia, surprises, bucket lists, mini-games. A free zone in the app, on purpose.",
    webWhy: "Not everything in childhood should be earned. Some things should just be fun.",
    pitch: "<b>NO points. NO ratings. JUST FUN.</b> Trivia. Surprises. Mini-games. Bucket lists.",
    features: ["Trivia + mini-games (points-free)", "Family bucket list", "Date night + surprise ideas"],
    tip: "Spin the surprise wheel — see what Kaya picks for your family today.",
  },
  {
    key: "buzz", num: 10, name: "Kaya Buzz", icon: "🐝", color: "#FF8C42", bg: "#FFE9D6",
    tags: ["both"],
    webPitch: "Got an idea? Spotted a bug? Want a fix? <b>Drop a Buzz</b> — anyone in the family can. Ideas, bugs, and fix-its get seen, triaged, and shipped.",
    webWhy: "The best ideas stop getting lost. Everyone has a voice — and the good ones actually get built.",
    pitch: "Got an idea? Spot a bug? Want a fix? <b>Drop a Buzz</b> — anyone in the family can. Buzz Admins triage them and ship.",
    features: ["Drop Ideas, Bugs, Fix-its, Questions, Wishes", "Track your Buzz from 'New' to 'Shipped'", "Vote on family ideas", "Buzz Admin dashboard + per-category team access"],
    tip: "Drop your first idea — watch it travel from your screen to 'shipped'.",
  },
  {
    key: "wealth", num: 11, name: "Kaya Wealth", icon: "💎", color: "#8C5BFF", bg: "#F4EEFF",
    tags: ["parent", "soon"],
    webPitch: "The <b>family wealth registry</b>. Properties, assets, investments. One private place to see what you've built — and what you're building for them.",
    webWhy: "Generational wealth isn't a secret to keep. It's a plan to share.",
    pitch: "The family treasure map. <b>Houses, land, investments</b> — everything the family is building, in one private place.",
    features: ["Property + asset registry", "Investment portfolio", "Parent-controlled access (single or dual)"],
    tip: "Coming soon — be the first to know when it lights up.",
  },
  {
    key: "wellness", num: 12, name: "Kaya Wellness", icon: "🌿", color: "#3DCC91", bg: "#E5F8E5",
    tags: ["both", "soon"],
    webPitch: "<b>Sleep. Screen time. Mindfulness. Health.</b> The quiet engine behind every happy day.",
    webWhy: "Habits build kids. Kaya watches the ones that matter — without watching the ones that don't.",
    pitch: "Sleep well 😴. Screen less. Move more. Breathe deep. <b>The quiet engine</b> behind every happy day.",
    features: ["Sleep + screen time tracking", "Mindfulness prompts", "Health check-in reminders"],
    tip: "Coming soon — we're designing this now.",
  },
  {
    key: "chef", num: 13, name: "Kaya Chef", icon: "🍳", color: "#FFC93C", bg: "#FFF1D8",
    tags: ["both", "soon"],
    webPitch: "<b>Family recipes that don't get lost.</b> Meal planning that talks to the pantry. Cook-along moments worth keeping.",
    webWhy: "The kitchen is where family memory lives. Kaya helps you cook it down.",
    pitch: "Grandma's recipe. Mum's secret stew. <b>Cook together, save the recipes</b>, plan tomorrow's meals.",
    features: ["Family recipe vault", "Meal planner → talks to your Pantry", "Cook-along moments"],
    tip: "Coming soon — recipes you'll never lose again.",
  },
];

export const TAG_LABELS: Record<"kid" | "parent" | "both", { label: string; cls: "forKid" | "forParent" | "forBoth" }> = {
  kid: { label: "Kids Love", cls: "forKid" },
  parent: { label: "For Parents", cls: "forParent" },
  both: { label: "For Everyone", cls: "forBoth" },
};

export const isSoon = (m: UniverseModule) => m.tags.includes("soon");

/** Visual layout of the galaxy. Positions are relative to each orbit ring,
 * matching the approved in-app mockup (4 inner + 7 outer planets). */
export interface PlanetLayout {
  key: string;
  ring: 1 | 2;
  ico: string;
  label: string;
  small?: string;
  style: CSSProperties;
}

export const GALAXY_PLANETS: PlanetLayout[] = [
  // Inner ring
  { key: "points", ring: 1, ico: "🏆", label: "Kaya", small: "Points", style: { width: 96, height: 96, top: -48, left: "50%", marginLeft: -48, background: "var(--coral)" } },
  { key: "sparks", ring: 1, ico: "✨", label: "Sparks", small: "Learning", style: { width: 86, height: 86, top: "50%", right: -43, marginTop: -43, background: "var(--sun)", color: "var(--ink)" } },
  { key: "hive", ring: 1, ico: "🍯", label: "Hive", small: "Money", style: { width: 90, height: 90, bottom: -45, left: "50%", marginLeft: -45, background: "var(--purple)" } },
  { key: "business", ring: 1, ico: "🌱", label: "Business", small: "Earn", style: { width: 84, height: 84, top: "50%", left: -42, marginTop: -42, background: "var(--grass)" } },
  // Outer ring
  { key: "moments", ring: 2, ico: "📸", label: "Moments", style: { width: 72, height: 72, top: -36, left: "50%", marginLeft: -36, background: "var(--mint)", color: "var(--ink)" } },
  { key: "household", ring: 2, ico: "🏡", label: "Household", style: { width: 70, height: 70, top: "14%", right: -35, background: "var(--sky)" } },
  { key: "buzz", ring: 2, ico: "🐝", label: "Buzz", small: "Ideas", style: { width: 70, height: 70, top: "50%", right: -35, marginTop: -35, background: "#FF8C42" } },
  { key: "pages", ring: 2, ico: "📒", label: "Pages", style: { width: 68, height: 68, bottom: "14%", right: -34, background: "#FFB385", color: "var(--ink)" } },
  { key: "fun", ring: 2, ico: "🎉", label: "Fun", style: { width: 66, height: 66, bottom: -33, left: "50%", marginLeft: -33, background: "#FF9CC1" } },
  { key: "dreams", ring: 2, ico: "🌟", label: "Dreams", style: { width: 66, height: 66, bottom: "14%", left: -33, background: "#FFD66B", color: "var(--ink)" } },
  { key: "wealth", ring: 2, ico: "💎", label: "Wealth", small: "Soon", style: { width: 64, height: 64, top: "14%", left: -32, background: "#E8DEFF", color: "var(--ink)" } },
];
