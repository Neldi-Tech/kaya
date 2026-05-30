// Date helpers — Kaya uses DD-MMM-YYYY in the UI to avoid US/UK format
// confusion (e.g. "02-May-2026"), and YYYY-MM-DD as the canonical Firestore
// representation so it sorts correctly.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH_INDEX: Record<string, number> = MONTHS.reduce((acc, m, i) => {
  acc[m.toLowerCase()] = i;
  return acc;
}, {} as Record<string, number>);

// "2026-05-02" → "02-May-2026"
export function toDisplayDate(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const [, y, mm, dd] = m;
  const idx = parseInt(mm, 10) - 1;
  if (idx < 0 || idx > 11) return '';
  return `${dd}-${MONTHS[idx]}-${y}`;
}

// "02-May-2026" → "2026-05-02"; returns null if unparseable.
export function fromDisplayDate(input: string): string | null {
  const m = /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{4})$/.exec(input.trim());
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthRaw = m[2].slice(0, 3).toLowerCase();
  const idx = MONTH_INDEX[monthRaw];
  if (idx === undefined) return null;
  const year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  // Round-trip through Date to validate the day-of-month for that month.
  const d = new Date(Date.UTC(year, idx, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== idx || d.getUTCDate() !== day) return null;
  const mm = String(idx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

// Day of the week the kid was born — "Monday" etc.
export function dayOfWeek(iso: string): string {
  const d = parseIso(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// Age today. Returns null if invalid.
export function ageNow(iso: string): number | null {
  const d = parseIso(iso);
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// Days until the next birthday (not counting today as 0 unless it IS today).
export function daysToNextBirthday(iso: string): number | null {
  const d = parseIso(iso);
  if (!d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  const diffMs = next.getTime() - today.getTime();
  return Math.round(diffMs / 86_400_000);
}

// Age the kid will be at their NEXT birthday.
export function ageAtNextBirthday(iso: string): number | null {
  const a = ageNow(iso);
  if (a === null) return null;
  const days = daysToNextBirthday(iso);
  if (days === null) return null;
  // If today is the birthday, ageNow already incremented; otherwise next birthday brings +1.
  return days === 0 ? a : a + 1;
}

// Parse "MM-DD" out of a YYYY-MM-DD string for the on-this-day API.
export function monthDayOf(iso: string): { month: string; day: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { month: m[2], day: m[3] };
}

/** Friendly relative day for "last entry" lines: "Today" / "Yesterday" /
 *  "3 days ago", falling back to DD-Mmm-YYYY for anything a week or more out
 *  (or future). Compares the YYYY-MM-DD key against the local calendar day. */
export function relativeDayLabel(dayKey: string | undefined | null): string {
  if (!dayKey) return '';
  const d = parseIso(dayKey);
  if (!d) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  return toDisplayDate(dayKey);
}

function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

// "YYYY-MM-DD" for a given instant in a specific IANA timezone. Kaya Pulse
// uses this so the daily task generator (server, UTC) and the Today screen
// (client) agree on which calendar day "today" is, regardless of where the
// server or device sits. en-CA formats as ISO (YYYY-MM-DD).
export function dayKeyInTZ(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
