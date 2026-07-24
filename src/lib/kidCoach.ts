// Kaya · 🤖 Coach Kaya + records engine for My Stats (2026-07-29, PR 4).
//
// Deterministic on purpose (like QotD's fallback + Kaya's-read in the
// meeting Highlights): instant, free, no API-key dependency — the same
// warm content the approved mockup showed, computed from the kid's real
// data. An LLM flavour can bolt on later behind the same card.

import type { DailyRating, Award, Routine } from './firestore';

// ── 📜 Daily quote bank (kid-friendly; rotates by day-of-year) ───────
export const KID_QUOTES: Array<{ q: string; by: string }> = [
  { q: 'Little by little, a little becomes a lot.', by: 'African proverb' },
  { q: 'If you want to go fast, go alone. If you want to go far, go together.', by: 'African proverb' },
  { q: 'Smooth seas do not make skillful sailors.', by: 'African proverb' },
  { q: 'However long the night, the dawn will break.', by: 'African proverb' },
  { q: 'Wisdom is like a baobab tree; no one person can embrace it.', by: 'African proverb' },
  { q: 'A small house can hold a hundred friends.', by: 'African proverb' },
  { q: 'Rain does not fall on one roof alone.', by: 'African proverb' },
  { q: 'He who learns, teaches.', by: 'Ethiopian proverb' },
  { q: 'Unity is strength, division is weakness.', by: 'Swahili proverb' },
  { q: 'Haraka haraka haina baraka — hurry hurry has no blessing.', by: 'Swahili proverb' },
  { q: 'Patience attracts happiness; it brings near that which is far.', by: 'Swahili proverb' },
  { q: 'A person is a person because of other people.', by: 'Ubuntu wisdom' },
  { q: 'Do your little bit of good where you are.', by: 'Desmond Tutu' },
  { q: 'Education is the most powerful weapon you can use to change the world.', by: 'Nelson Mandela' },
  { q: 'It always seems impossible until it is done.', by: 'Nelson Mandela' },
  { q: 'Courage is not the absence of fear, but the triumph over it.', by: 'Nelson Mandela' },
  { q: 'Be the change you wish to see in the world.', by: 'wisdom of Gandhi' },
  { q: 'The best way to find yourself is to lose yourself in the service of others.', by: 'wisdom of Gandhi' },
  { q: 'You are never too small to make a difference.', by: 'Greta Thunberg' },
  { q: 'Kind words are short to speak, but their echoes are endless.', by: 'Mother Teresa' },
  { q: 'Not all of us can do great things, but we can do small things with great love.', by: 'Mother Teresa' },
  { q: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
  { q: 'The journey of a thousand miles begins with one step.', by: 'Lao Tzu' },
  { q: 'A kind heart is a fountain of gladness.', by: 'Washington Irving' },
  { q: 'Try to be a rainbow in someone else’s cloud.', by: 'Maya Angelou' },
  { q: 'Do what you can, with what you have, where you are.', by: 'Theodore Roosevelt' },
  { q: 'It is not the mountain we conquer, but ourselves.', by: 'Edmund Hillary' },
  { q: 'Well done is better than well said.', by: 'Benjamin Franklin' },
  { q: 'Lost time is never found again.', by: 'Benjamin Franklin' },
  { q: 'The secret of getting ahead is getting started.', by: 'Mark Twain' },
  { q: 'Kindness is a language the deaf can hear and the blind can see.', by: 'Mark Twain' },
  { q: 'You miss 100% of the shots you don’t take.', by: 'Wayne Gretzky' },
  { q: 'Hard work beats talent when talent doesn’t work hard.', by: 'Tim Notke' },
  { q: 'Champions keep playing until they get it right.', by: 'Billie Jean King' },
  { q: 'It’s not whether you get knocked down, it’s whether you get up.', by: 'Vince Lombardi' },
  { q: 'The more you give away, the happier you become.', by: 'kind wisdom' },
  { q: 'Honesty is the first chapter in the book of wisdom.', by: 'Thomas Jefferson' },
  { q: 'A good name is better than riches.', by: 'Proverbs 22:1' },
  { q: 'Whatever your hand finds to do, do it with all your might.', by: 'Ecclesiastes 9:10' },
  { q: 'Let all that you do be done in love.', by: '1 Corinthians 16:14' },
  { q: 'Be strong and courageous. Do not be afraid.', by: 'Joshua 1:9' },
  { q: 'A cheerful heart is good medicine.', by: 'Proverbs 17:22' },
  { q: 'Train up a child in the way he should go.', by: 'Proverbs 22:6' },
  { q: 'In everything, do to others what you would have them do to you.', by: 'Matthew 7:12' },
  { q: 'The one who is faithful in little is faithful in much.', by: 'Luke 16:10' },
  { q: 'Great things are done by a series of small things brought together.', by: 'Vincent van Gogh' },
  { q: 'Every accomplishment starts with the decision to try.', by: 'John F. Kennedy' },
  { q: 'Practice makes progress, not perfect — and progress is the point.', by: 'Coach Kaya' },
  { q: 'Your habits today are your superpowers tomorrow.', by: 'Coach Kaya' },
  { q: 'Being brave means doing it even when your tummy has butterflies.', by: 'Coach Kaya' },
  { q: 'Helping at home is helping the whole world start better.', by: 'Coach Kaya' },
  { q: 'A tidy bed in the morning is the first goal you score every day.', by: 'Coach Kaya' },
  { q: 'Streaks are built one sunrise at a time.', by: 'Coach Kaya' },
  { q: 'When you don’t feel like it — that’s when it counts double.', by: 'Coach Kaya' },
  { q: 'Say thank you today. Watch what happens.', by: 'Coach Kaya' },
  { q: 'The strongest muscle you can train is keeping your word.', by: 'Coach Kaya' },
  { q: 'Yesterday’s you is the only one to beat.', by: 'Coach Kaya' },
  { q: 'Big dreams love small daily steps.', by: 'Coach Kaya' },
  { q: 'You become what you repeat.', by: 'Coach Kaya' },
  { q: 'Ask for help — that’s what strong people do.', by: 'Coach Kaya' },
];

/** Today's quote — stable within a day, fresh each day. */
export function quoteOfTheDay(): { q: string; by: string } {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  return KID_QUOTES[dayOfYear % KID_QUOTES.length];
}

// ── 🤖 Coach computation ─────────────────────────────────────────────
export interface BehaviourScore {
  id: string; label: string; icon: string;
  rated: number; excellent: number; bad: number; pct: number;
}

export interface CoachRead {
  focus: BehaviourScore | null;
  tips: string[];
  warm: string;
  quote: { q: string; by: string };
}

/** Weekly focus = the weakest sufficiently-rated behaviour; tips are
 *  concrete and tied to the kid's own data; the close always celebrates
 *  their strongest habit (growth voice — never shame). */
export function computeCoach(behaviours: BehaviourScore[], firstName: string, beltToNext: number): CoachRead {
  const rated = behaviours.filter((b) => b.rated >= 3);
  const focus = rated.length ? [...rated].sort((a, b) => a.pct - b.pct)[0] : null;
  const best = rated.length ? [...rated].sort((a, b) => b.pct - a.pct)[0] : null;

  const tips: string[] = [];
  if (focus && best && focus.id !== best.id) {
    tips.push(`Stick ${focus.label.toLowerCase()} right after ${best.label.toLowerCase()} — attach it to the habit you never miss.`);
  }
  if (focus) {
    tips.push(`3 days of Excellent ${focus.label.toLowerCase()} in a row and your ${focus.pct}% starts climbing fast.`);
  }
  if (beltToNext > 0 && beltToNext <= 3) {
    tips.push(`Only ${beltToNext} Excellent day${beltToNext === 1 ? '' : 's'} to your next belt rung — this week can do it.`);
  }
  const warm = best
    ? `${best.icon} Your ${best.label.toLowerCase()} is ${best.pct}% — you already know how to be consistent, ${firstName}. Bring that power to the focus!`
    : `Every big streak starts with day one, ${firstName} — today is a great day one. 🌱`;

  return { focus: focus && focus.pct < 90 ? focus : null, tips: tips.slice(0, 3), warm, quote: quoteOfTheDay() };
}

// ── 🔥 Comeback detection ────────────────────────────────────────────
/** A behaviour that had a Bad day and has been Excellent 5+ rated days
 *  since — redemption made visible. */
export function detectComebacks(ratings: DailyRating[], routines: Routine[]): Array<{ id: string; label: string; icon: string; run: number }> {
  const out: Array<{ id: string; label: string; icon: string; run: number }> = [];
  for (const rt of routines) {
    const days = ratings
      .filter((r) => r.ratings?.[rt.id] && r.ratings[rt.id] !== 'skip')
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => r.ratings[rt.id]);
    if (!days.includes('bad')) continue;
    let run = 0;
    for (let i = days.length - 1; i >= 0 && days[i] === 'excellent'; i--) run += 1;
    const lastBad = days.lastIndexOf('bad');
    if (run >= 5 && lastBad >= 0 && lastBad < days.length - run) {
      out.push({ id: rt.id, label: rt.label, icon: rt.icon, run });
    }
  }
  return out;
}

// ── 🏆 Personal records ──────────────────────────────────────────────
export interface Records {
  bestDay: { date: string; pts: number } | null;
  bestWeek: { weekStart: string; pts: number } | null;
  longestExcellentRun: number;
  mostKudosMonth: { month: string; n: number } | null;
}

export function computeRecords(ratings: DailyRating[], awards: Award[]): Records {
  const byDay = new Map<string, number>();
  ratings.forEach((r) => byDay.set(r.date, (byDay.get(r.date) || 0) + (r.totalPoints || 0)));
  let bestDay: Records['bestDay'] = null;
  byDay.forEach((pts, date) => { if (!bestDay || pts > bestDay.pts) bestDay = { date, pts }; });

  const byWeek = new Map<string, number>();
  byDay.forEach((pts, date) => {
    const d = new Date(`${date}T00:00:00`);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    const wk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    byWeek.set(wk, (byWeek.get(wk) || 0) + pts);
  });
  let bestWeek: Records['bestWeek'] = null;
  byWeek.forEach((pts, weekStart) => { if (!bestWeek || pts > bestWeek.pts) bestWeek = { weekStart, pts }; });

  // Longest all-Excellent (perfect) day run across consecutive RATED days.
  const perfect = new Map<string, boolean>();
  const agg = new Map<string, { rated: number; exc: number }>();
  ratings.forEach((r) => {
    const a = agg.get(r.date) || { rated: 0, exc: 0 };
    Object.values(r.ratings || {}).forEach((v) => {
      if (v === 'skip') return;
      a.rated += 1;
      if (v === 'excellent') a.exc += 1;
    });
    agg.set(r.date, a);
  });
  agg.forEach((a, d) => perfect.set(d, a.rated > 0 && a.exc === a.rated));
  const dates = Array.from(perfect.keys()).sort();
  let longest = 0; let run = 0;
  for (const d of dates) {
    if (perfect.get(d)) { run += 1; if (run > longest) longest = run; }
    else run = 0;
  }

  const kudosByMonth = new Map<string, number>();
  awards.forEach((a) => {
    const k = a.kind || (a.points === 0 ? 'kudos' : 'regular');
    if (k !== 'kudos') return;
    const d = a.createdAt?.toDate?.();
    if (!d) return;
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    kudosByMonth.set(m, (kudosByMonth.get(m) || 0) + 1);
  });
  let mostKudosMonth: Records['mostKudosMonth'] = null;
  kudosByMonth.forEach((n, month) => { if (!mostKudosMonth || n > mostKudosMonth.n) mostKudosMonth = { month, n }; });

  return { bestDay, bestWeek, longestExcellentRun: longest, mostKudosMonth };
}
