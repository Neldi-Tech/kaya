// 👑 Leader of the Week — shared types, defaults + trait math (LW PR-L1).
//
// Pure module: NO firebase imports, so it can be used by the Admin gateway
// (/api/leader), the cron, and client components alike.
//
// Model (approved logic 23-Aug-2026, Kaya-Leader-of-the-Week_LogicTest+Design_v1):
//   • `family.houseLeader`           — who wears the crown NOW (kid-only role).
//   • `families/{f}/leaderTerms/{id}` — one doc per term (history + sealed traits).
//   • `families/{f}/leaderNotes/{id}` — 📒 Leader's Notebook entries
//                                        (⭐ shout-out / 📝 heads-up) → parent decides.
// The meeting's leader pick FEEDS the crown (kid pick → auto-crown at FINISH;
// adult pick → parent appoints). It never replaces it.

// ── Config ────────────────────────────────────────────────────────

export interface LeaderConfig {
  /** Master switch. Default ON. */
  enabled: boolean;
  /** Kids younger than this wear the crown but don't get the Notebook. */
  notebookMinAge: number;
  /** Notes a leader may send per local day. */
  dailyNoteCap: number;
  /** Self shout-outs / heads-ups allowed (max 1 self shout-out per day). */
  allowSelfNotes: boolean;
  /** HP granted to the leader when a term closes (0 = off). */
  termBonusPoints: number;
  /** How an approved heads-up is attributed to the target kid. */
  headsUpAttribution: 'role' | 'name';
  /** Kid sees their own trait radar in /stats/me. */
  kidSeesTraits: boolean;
  /** Up to 3 family-specific duties shown in the guide. */
  customDuties: string[];
  /** 🎯 Mission Card per term (idea A). */
  missionsOn: boolean;
  /** 👀 Fairness-coach whispers on the leader's Notebook tile (idea C). */
  coachNudgesOn: boolean;
}

export const DEFAULT_LEADER_CONFIG: LeaderConfig = {
  enabled: true,
  notebookMinAge: 6,
  dailyNoteCap: 5,
  allowSelfNotes: true,
  termBonusPoints: 2,
  headsUpAttribution: 'role',
  kidSeesTraits: true,
  customDuties: [],
  missionsOn: true,
  coachNudgesOn: true,
};

export function readLeaderConfig(family: { leaderConfig?: Partial<LeaderConfig> } | null | undefined): LeaderConfig {
  const s = family?.leaderConfig || {};
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_LEADER_CONFIG.enabled,
    notebookMinAge: num(s.notebookMinAge, DEFAULT_LEADER_CONFIG.notebookMinAge, 0, 18),
    dailyNoteCap: num(s.dailyNoteCap, DEFAULT_LEADER_CONFIG.dailyNoteCap, 1, 20),
    allowSelfNotes: typeof s.allowSelfNotes === 'boolean' ? s.allowSelfNotes : DEFAULT_LEADER_CONFIG.allowSelfNotes,
    termBonusPoints: num(s.termBonusPoints, DEFAULT_LEADER_CONFIG.termBonusPoints, 0, 3),
    headsUpAttribution: s.headsUpAttribution === 'name' ? 'name' : 'role',
    kidSeesTraits: typeof s.kidSeesTraits === 'boolean' ? s.kidSeesTraits : DEFAULT_LEADER_CONFIG.kidSeesTraits,
    customDuties: Array.isArray(s.customDuties) ? s.customDuties.filter((d) => typeof d === 'string' && d.trim()).slice(0, 3) : [],
    missionsOn: typeof s.missionsOn === 'boolean' ? s.missionsOn : DEFAULT_LEADER_CONFIG.missionsOn,
    coachNudgesOn: typeof s.coachNudgesOn === 'boolean' ? s.coachNudgesOn : DEFAULT_LEADER_CONFIG.coachNudgesOn,
  };
}

// ── The crown ────────────────────────────────────────────────────

export interface HouseLeader {
  childId: string;
  name: string;
  emoji: string;
  termId: string;
  startAt: number;               // epoch ms
  source: 'meeting' | 'appointed';
  setBy: string;                 // uid
}

export type LeaderTraitKey = 'inspiring' | 'firm' | 'fair' | 'consistent' | 'host';

export interface LeaderTraits {
  inspiring: number;
  firm: number;
  fair: number;
  consistent: number;
  /** null = an adult led the meeting that week → excluded from averages. */
  host: number | null;
}

export interface LeaderTermCounts {
  shoutOuts: number;       // approved/adjusted shout-outs about OTHERS
  headsUps: number;        // approved/adjusted heads-ups about OTHERS
  self: number;            // notes about self (any status)
  sent: number;            // all notes sent
  approved: number;        // approved as proposed
  adjusted: number;
  declined: number;
  expired: number;
  activeDays: number;      // distinct local days with ≥1 note
  termDays: number;        // term length in days (min 1)
  siblingsNoticed: number; // distinct OTHER kids with ≥1 approved/adjusted note
  siblings: number;        // other kids in the family at seal time
}

export interface LeaderTerm {
  id: string;
  childId: string;
  name: string;
  emoji: string;
  startAt: number;
  endAt: number | null;
  source: 'meeting' | 'appointed';
  setBy: string;
  /** Sunday-meeting facts for the 🎤 Host trait (stamped at handover). */
  ledMeeting?: boolean;
  openingWordDone?: boolean;
  themeSet?: boolean;
  rolesDealt?: boolean;
  /** Leader's own 🔴 days during the term (daily ratings) — 0 → +1 Consistent. */
  badDays?: number;
  // Sealed at close:
  sealedAt?: number;
  counts?: LeaderTermCounts;
  traits?: LeaderTraits;
  style?: string;
  honest?: boolean;
  mission?: { id: string; label: string; done: boolean; progress: number; target: number };
  /** 🔑 idea B — the outgoing leader's one line for the next leader. */
  advice?: string;
  report?: string;
  bonusPoints?: number;
  bonusAwardId?: string;
  endedBy?: string;
  endReason?: 'meeting' | 'parent' | 'replaced';
}

// ── 📒 Notes ─────────────────────────────────────────────────────

export type LeaderNoteKind = 'shoutout' | 'headsup';
export type LeaderNoteStatus = 'pending' | 'resolving' | 'approved' | 'adjusted' | 'declined' | 'expired';

export interface LeaderNote {
  id: string;
  termId: string;
  leaderChildId: string;
  leaderName: string;
  targetChildId: string;
  targetName: string;
  targetEmoji?: string;
  kind: LeaderNoteKind;
  /** Proposed points: +1..+3 for shout-outs, −1..−max for heads-ups, 0 = note only. */
  proposedPoints: number;
  category: string;
  reason: string;
  photoPath?: string;
  status: LeaderNoteStatus;
  /** YYYY-MM-DD (local, family TZ) — for the daily cap. */
  day: string;
  createdAt: number;
  createdBy: string;           // leader's login uid
  // Resolution:
  finalPoints?: number;
  awardId?: string;
  parentNote?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: number;
  /** true when the leader has seen the outcome (clears the kid-side dot). */
  seenByLeader?: boolean;
}

export const NOTE_CATEGORIES: ReadonlyArray<{ id: string; icon: string; label: string }> = [
  { id: 'helping', icon: '🤝', label: 'Helping' },
  { id: 'kindness', icon: '💖', label: 'Kindness' },
  { id: 'responsibility', icon: '🎯', label: 'Responsibility' },
  { id: 'teamwork', icon: '⭐', label: 'Teamwork' },
  { id: 'learning', icon: '📚', label: 'Learning' },
  { id: 'bravery', icon: '🦁', label: 'Bravery' },
  { id: 'creativity', icon: '🎨', label: 'Creativity' },
  { id: 'other', icon: '✨', label: 'Other' },
];

// ── Trait math (R13 table) ───────────────────────────────────────

function bucket(n: number, steps: number[]): number {
  // steps = thresholds for 1..5; e.g. [1,2,4,6,9] → 0→0, 1→1, 2–3→2, 4–5→3, 6–8→4, 9+→5
  let score = 0;
  for (let i = 0; i < steps.length; i += 1) if (n >= steps[i]) score = i + 1;
  return Math.min(5, score);
}

export function computeTraits(term: Pick<LeaderTerm, 'ledMeeting' | 'openingWordDone' | 'themeSet' | 'rolesDealt' | 'badDays'>, c: LeaderTermCounts, hostApplicable: boolean): LeaderTraits {
  const inspiring = bucket(c.shoutOuts, [1, 2, 4, 6, 9]);
  // Firm: 0→0 · 1→2 · 2→3 · 3+→4 · +1 if none declined (max 5)
  let firm = c.headsUps === 0 ? 0 : c.headsUps === 1 ? 2 : c.headsUps === 2 ? 3 : 4;
  if (firm > 0 && c.declined === 0) firm = Math.min(5, firm + 1);
  // Fair: coverage × approval rate
  const decided = c.approved + c.adjusted + c.declined;
  const rate = decided > 0 ? (c.approved + c.adjusted) / decided : (c.sent > 0 ? 1 : 0);
  const coverage = c.siblings > 0 ? c.siblingsNoticed / c.siblings : rate;
  const fair = c.sent === 0 ? 0 : Math.round(5 * coverage * rate);
  // Consistent: active-day share → 0–4, +1 if no 🔴 day
  const share = c.termDays > 0 ? c.activeDays / Math.min(c.termDays, 7) : 0;
  let consistent = share <= 0 ? 0 : share < 0.3 ? 1 : share < 0.5 ? 2 : share < 0.75 ? 3 : 4;
  if (consistent > 0 && (term.badDays || 0) === 0) consistent = Math.min(5, consistent + 1);
  // Host
  let host: number | null = null;
  if (hostApplicable) {
    host = term.ledMeeting ? 3 : 0;
    if (term.ledMeeting && term.openingWordDone) host += 1;
    if (term.ledMeeting && (term.themeSet || term.rolesDealt)) host += 1;
    host = Math.min(5, host);
  }
  return { inspiring, firm, fair, consistent, host };
}

export const TRAIT_META: Record<LeaderTraitKey, { emoji: string; label: string; style: string; explain: string }> = {
  inspiring: { emoji: '✨', label: 'Inspiring', style: 'Inspiring Captain', explain: 'Shout-outs about others that parents approved.' },
  firm: { emoji: '🧭', label: 'Firm', style: 'Firm Coach', explain: 'Heads-ups that helped (approved by parents) — capped at 3.' },
  fair: { emoji: '⚖️', label: 'Fair', style: 'Fair Guide', explain: 'Did every sibling get noticed, and did parents agree with the notes?' },
  consistent: { emoji: '🔥', label: 'Consistent', style: 'Steady Hand', explain: 'Days with a note, plus leading by example (no red days).' },
  host: { emoji: '🎤', label: 'Host', style: 'Great Host', explain: 'Led the Sunday meeting to the end, opening word, theme or roles.' },
};

export const TRAIT_ORDER: LeaderTraitKey[] = ['inspiring', 'firm', 'fair', 'consistent', 'host'];

export function styleFor(traits: LeaderTraits | undefined | null): string {
  if (!traits) return 'New Leader';
  let best: LeaderTraitKey = 'inspiring';
  let bestV = -1;
  for (const k of TRAIT_ORDER) {
    const v = traits[k];
    if (v === null || v === undefined) continue;
    if (v > bestV) { bestV = v; best = k; }
  }
  if (bestV <= 0) return 'New Leader';
  return TRAIT_META[best].style;
}

/** One-line, kid-readable reason per trait (R14 "tap a trait"). */
export function explainTrait(key: LeaderTraitKey, term: Pick<LeaderTerm, 'ledMeeting' | 'openingWordDone' | 'themeSet' | 'rolesDealt' | 'badDays' | 'counts' | 'traits'>): string {
  const c = term.counts;
  const t = term.traits;
  if (!c || !t) return TRAIT_META[key].explain;
  switch (key) {
    case 'inspiring': return `Inspiring ${t.inspiring} — ${c.shoutOuts} shout-out${c.shoutOuts === 1 ? '' : 's'} about others were approved.`;
    case 'firm': return `Firm ${t.firm} — ${c.headsUps} heads-up${c.headsUps === 1 ? '' : 's'} helped${c.declined === 0 && c.headsUps > 0 ? ' and none were declined' : ''}.`;
    case 'fair': return `Fair ${t.fair} — noticed ${c.siblingsNoticed} of ${c.siblings} sibling${c.siblings === 1 ? '' : 's'}; ${c.declined} note${c.declined === 1 ? '' : 's'} declined.`;
    case 'consistent': return `Consistent ${t.consistent} — notes on ${c.activeDays} of ${Math.min(c.termDays, 7)} days${(term.badDays || 0) === 0 ? ', no red days' : `, ${term.badDays} red day${term.badDays === 1 ? '' : 's'}`}.`;
    case 'host': return t.host === null ? 'Host — a parent led the meeting this week.' : `Host ${t.host} — ${term.ledMeeting ? 'led the Sunday meeting' : 'did not lead the meeting to the end'}${term.ledMeeting && term.openingWordDone ? ' · opening word ✓' : ''}${term.ledMeeting && (term.themeSet || term.rolesDealt) ? ' · theme/roles ✓' : ''}.`;
  }
}

/** Average of sealed terms (latest N) → lifetime radar. */
export function averageTraits(terms: LeaderTerm[], lastN = 6): LeaderTraits | null {
  const sealed = terms.filter((t) => t.traits).slice(0, lastN);
  if (!sealed.length) return null;
  const sum = { inspiring: 0, firm: 0, fair: 0, consistent: 0, host: 0 };
  let hostN = 0;
  for (const t of sealed) {
    sum.inspiring += t.traits!.inspiring; sum.firm += t.traits!.firm; sum.fair += t.traits!.fair; sum.consistent += t.traits!.consistent;
    if (t.traits!.host !== null && t.traits!.host !== undefined) { sum.host += t.traits!.host; hostN += 1; }
  }
  const n = sealed.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    inspiring: r1(sum.inspiring / n), firm: r1(sum.firm / n), fair: r1(sum.fair / n), consistent: r1(sum.consistent / n),
    host: hostN ? r1(sum.host / hostN) : null,
  };
}

// ── 🎯 Missions (idea A) ─────────────────────────────────────────

export interface LeaderMission {
  id: string;
  label: string;
  emoji: string;
  /** How progress is measured from the term's notes/meeting facts. */
  metric: 'coverage' | 'shoutouts' | 'kindness' | 'headsup_help' | 'opening_word' | 'active_days' | 'self_honest' | 'quiet_one';
  target: number;
  /** Which trait this mission strengthens — picks the mission for the
   *  leader's weakest trait. */
  trait: LeaderTraitKey;
}

export const LEADER_MISSIONS: LeaderMission[] = [
  { id: 'everyone-one', label: 'Make sure everyone gets one shout-out', emoji: '🌍', metric: 'coverage', target: 1, trait: 'fair' },
  { id: 'three-kind', label: 'Catch 3 kind moments', emoji: '💛', metric: 'kindness', target: 3, trait: 'inspiring' },
  { id: 'five-shoutouts', label: 'Send 5 shout-outs this week', emoji: '⭐', metric: 'shoutouts', target: 5, trait: 'inspiring' },
  { id: 'help-not-hurt', label: 'Write one heads-up that helps, not hurts', emoji: '🧭', metric: 'headsup_help', target: 1, trait: 'firm' },
  { id: 'quiet-one', label: 'Notice the quiet one', emoji: '👀', metric: 'quiet_one', target: 1, trait: 'fair' },
  { id: 'open-heart', label: 'Open the meeting with a word from the heart', emoji: '🙏', metric: 'opening_word', target: 1, trait: 'host' },
  { id: 'four-days', label: 'Take a note on 4 different days', emoji: '📅', metric: 'active_days', target: 4, trait: 'consistent' },
  { id: 'honest-me', label: 'Write one honest note about yourself', emoji: '🪞', metric: 'self_honest', target: 1, trait: 'consistent' },
  { id: 'two-siblings', label: 'Notice two different siblings', emoji: '👫', metric: 'coverage', target: 2, trait: 'fair' },
  { id: 'three-days', label: 'Keep your eyes open 3 days in a row', emoji: '🔥', metric: 'active_days', target: 3, trait: 'consistent' },
  { id: 'one-each-kind', label: 'One shout-out AND one helpful heads-up', emoji: '⚖️', metric: 'headsup_help', target: 1, trait: 'firm' },
  { id: 'seven-stars', label: 'Send 7 shout-outs — a star a day', emoji: '🌟', metric: 'shoutouts', target: 7, trait: 'inspiring' },
];

/** Pick a mission for a new term: weakest lifetime trait first, then rotate
 *  deterministically by term count so the same kid doesn't repeat. */
export function pickMission(avg: LeaderTraits | null, termIndex: number, siblings: number): LeaderMission {
  let pool = LEADER_MISSIONS;
  if (avg) {
    let weakest: LeaderTraitKey = 'inspiring';
    let lo = 99;
    for (const k of TRAIT_ORDER) {
      const v = avg[k];
      if (v === null || v === undefined) continue;
      if (v < lo) { lo = v; weakest = k; }
    }
    const sub = LEADER_MISSIONS.filter((m) => m.trait === weakest);
    if (sub.length) pool = sub;
  }
  // 1-kid families: coverage missions make no sense.
  if (siblings === 0) pool = pool.filter((m) => m.metric !== 'coverage' && m.metric !== 'quiet_one');
  if (!pool.length) pool = LEADER_MISSIONS.filter((m) => m.metric !== 'coverage' && m.metric !== 'quiet_one');
  return pool[termIndex % pool.length];
}

// ── 👀 Coach whispers (idea C) — rules over live counters ────────

export function coachWhisper(input: {
  notesByTarget: Record<string, number>;   // approved+pending counts per OTHER kid
  shoutOuts: number; headsUps: number;      // sent (any status), about others
  lastNoteAt: number | null; startAt: number; now: number;
  siblingNames: Record<string, string>;     // childId → first name
}): string | null {
  const others = Object.keys(input.siblingNames);
  const dayMs = 86400000;
  const elapsedDays = Math.floor((input.now - input.startAt) / dayMs);
  if (others.length >= 2) {
    const counts = others.map((id) => ({ id, n: input.notesByTarget[id] || 0 }));
    const max = counts.reduce((a, b) => (b.n > a.n ? b : a), counts[0]);
    const zero = counts.filter((c) => c.n === 0);
    if (max.n >= 3 && zero.length) {
      return `You've noticed ${input.siblingNames[max.id]} ${max.n}× — ${input.siblingNames[zero[0].id]} is doing their best too 👀`;
    }
  }
  if (input.headsUps >= 3 && input.shoutOuts === 0) return 'Three heads-ups, no shout-outs yet — what went well this week? ⭐';
  if (elapsedDays >= 2 && (input.lastNoteAt === null || input.now - input.lastNoteAt > 2 * dayMs)) {
    return 'Nothing noted for a couple of days — leaders keep their eyes open 👀';
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────

export function localDayKey(ts: number, tz = 'Africa/Dar_es_Salaam'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
    const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

export function termDayNumber(startAt: number, now = Date.now()): number {
  return Math.max(1, Math.floor((now - startAt) / 86400000) + 1);
}

export function termWeekNumber(startAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil(termDayNumber(startAt, now) / 7));
}

/** Points bounds for a note given the family's point system. */
export function noteBounds(kind: LeaderNoteKind, pointSystem: { reducing: { enabled: boolean; max: number }; diamondMinPoints?: number }): number[] {
  if (kind === 'shoutout') {
    const maxRegular = Math.max(1, Math.min(3, (pointSystem.diamondMinPoints || 4) - 1));
    return Array.from({ length: maxRegular }, (_, i) => i + 1);
  }
  if (!pointSystem.reducing.enabled) return [0];
  const max = Math.max(1, Math.min(10, pointSystem.reducing.max || 1));
  const vals = Array.from({ length: Math.min(max, 3) }, (_, i) => -(i + 1));
  return [...vals, 0];
}

/** Kid-voice guide text (R5). */
export function guideBlocks(opts: { isLeader: boolean; leaderName: string; customDuties: string[]; siblings: number }): Array<{ title: string; lines: string[] }> {
  const job = opts.siblings > 0
    ? ['🎤 Lead Sunday family night', '🌟 Set the example all week', '👀 Notice the good things your brothers and sisters do', '🤝 Help someone who is stuck']
    : ['🎤 Lead Sunday family night', '🌟 Set the example all week', '👀 Notice the good things that happen at home', '🤝 Help when someone is stuck'];
  const help = [
    `🙌 Cheer ${opts.leaderName} on — leading is hard work`,
    '👀 Show your best — the leader is watching for good things',
    '🤝 Help when the leader asks',
    '⏳ Your turn comes — the wheel spins every Sunday',
  ];
  const blocks = [
    { title: opts.isLeader ? 'Your job' : 'How to help your leader', lines: opts.isLeader ? job : help },
    { title: 'Your tools', lines: ['📒 Leader\'s Notebook — shout-outs and heads-ups', '🎤 The Sunday meeting', '📖 Theme of the week'] },
    { title: 'The rules', lines: ['🧑‍⚖️ You don\'t give points — Mum and Dad decide', '⚖️ Be fair to everyone', '🔒 Notes are private until a parent looks', '🪞 Honesty counts — even about yourself'] },
  ];
  if (opts.customDuties.length) blocks.push({ title: 'Our family adds', lines: opts.customDuties.map((d) => `• ${d}`) });
  return blocks;
}
