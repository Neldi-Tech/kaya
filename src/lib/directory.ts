// Yellow Pages — the family's service directory ("The Roster").
//
// Architecture: this builds on the existing families/{f}/suppliers
// collection rather than forking a new one. pantry.ts already framed
// suppliers as "one source of truth, two views" — Pantry shows the
// `soko`-tagged subset, the Yellow Pages shows everything. A
// directory entry carries a fine-grained `directoryCategory` (the
// 20 Tanzania service types below); a Soko grocery vendor can carry
// both `categories: ['soko']` and a directoryCategory, so it shows
// up in both places without duplication.
//
// This module owns:
//   - the DIRECTORY_CATEGORIES catalog (Tanzania-first)
//   - phone normalisation (TZ 0xxx → 255xxx for wa.me)
//   - vCard generation (save-to-phone) + a universal importer that
//     auto-detects vCard / Google CSV / pasted text

import type { Supplier } from './pantry';

// ── Service categories (Tanzania-first) ──────────────────────────

export type DirectoryCategory =
  | 'supermarket' | 'butcher' | 'fishmonger' | 'bakery'
  | 'pharmacy' | 'clinic' | 'school' | 'childcare'
  | 'cleaner' | 'restaurant' | 'hardware' | 'plumber'
  | 'electrician' | 'fundi' | 'transport' | 'taxi'
  | 'mechanic' | 'tailor' | 'salon' | 'mobilemoney'
  // ── Universal service types ──
  // Location-agnostic categories available to every family,
  // regardless of country. The Tanzania-first list above stays.
  | 'groceries' | 'rides' | 'delivery';

export const DIRECTORY_CATEGORIES: { id: DirectoryCategory; emoji: string; label: string; hint: string }[] = [
  // ── Universal service types ──
  { id: 'groceries',   emoji: '🛍️', label: 'Groceries',             hint: 'Grocery shops & delivery' },
  { id: 'rides',       emoji: '🚗', label: 'Rides',                 hint: 'Taxi, Bolt, Uber, boda' },
  { id: 'delivery',    emoji: '📦', label: 'Delivery',              hint: 'Couriers, parcel & food delivery' },
  // ── Tanzania-first service types ──
  { id: 'supermarket', emoji: '🛒', label: 'Supermarkets / dukas',  hint: 'Groceries, household basics' },
  { id: 'butcher',     emoji: '🥩', label: 'Butchers',              hint: 'Meat, poultry' },
  { id: 'fishmonger',  emoji: '🐟', label: 'Fishmongers',           hint: 'Fresh fish, seafood' },
  { id: 'bakery',      emoji: '🥖', label: 'Bakeries',              hint: 'Bread, cakes, mandazi' },
  { id: 'pharmacy',    emoji: '💊', label: 'Pharmacies',            hint: 'Medicine, first aid' },
  { id: 'clinic',      emoji: '🏥', label: 'Clinics & doctors',     hint: 'GP, paediatrician, dentist' },
  { id: 'school',      emoji: '🎓', label: 'Schools / tutors',      hint: 'School office, tuition' },
  { id: 'childcare',   emoji: '👶', label: 'Childcare / nannies',   hint: 'Day-care, ayah' },
  { id: 'cleaner',     emoji: '🧹', label: 'Mama wa kazi',          hint: 'Cleaners, house help' },
  { id: 'restaurant',  emoji: '🍽️', label: 'Restaurants / takeout', hint: 'Food delivery, dining out' },
  { id: 'hardware',    emoji: '🧰', label: 'Hardware',              hint: 'Tools, building supplies' },
  { id: 'plumber',     emoji: '🪠', label: 'Plumbers',              hint: 'Pipes, taps, drainage' },
  { id: 'electrician', emoji: '⚡', label: 'Electricians',          hint: 'Wiring, sockets, repairs' },
  { id: 'fundi',       emoji: '🛠️', label: 'Fundi (handyman)',      hint: 'General repairs, odd jobs' },
  { id: 'transport',   emoji: '🚐', label: 'Daladala / Bajaji',     hint: 'Local transport' },
  { id: 'taxi',        emoji: '🚕', label: 'Taxi / Bolt / Uber',    hint: 'Ride drivers' },
  { id: 'mechanic',    emoji: '🔧', label: 'Mechanics',             hint: 'Car service, repairs' },
  { id: 'tailor',      emoji: '👗', label: 'Tailors',               hint: 'Clothing, alterations' },
  { id: 'salon',       emoji: '💇', label: 'Salons / barbers',      hint: 'Hair, grooming' },
  { id: 'mobilemoney', emoji: '💸', label: 'Mobile money agents',   hint: 'M-Pesa, Tigo, Airtel' },
];

export function findDirectoryCategory(id: string | undefined): typeof DIRECTORY_CATEGORIES[number] | undefined {
  if (!id) return undefined;
  return DIRECTORY_CATEGORIES.find((c) => c.id === id);
}

// ── Phone normalisation ──────────────────────────────────────────
// Tanzania mobile numbers are typically written 07XX XXX XXX
// locally. wa.me needs the full international form without the +.
// We normalise on save AND when building links so a pasted "0712…"
// still produces a working WhatsApp deep link.

const TZ_CC = '255';

/** Normalise a phone string to international digits-only form.
 *  - strips spaces / dashes / parens / leading +
 *  - a leading 0 on a 10-digit local number becomes the TZ code
 *  - already-international numbers pass through untouched
 *  Returns '' when there's nothing usable. */
export function normalizePhone(raw: string | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  // 0712345678  → 255712345678
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = TZ_CC + digits.slice(1);
  }
  // 712345678 (9 digits, no leading 0) → assume TZ mobile
  else if (digits.length === 9 && digits.startsWith('7')) {
    digits = TZ_CC + digits;
  }
  return digits;
}

/** Pretty local display: 255712345678 → +255 712 345 678. Falls
 *  back to the raw string when it doesn't look like a TZ number. */
export function displayPhone(raw: string | undefined): string {
  const d = normalizePhone(raw);
  if (d.startsWith(TZ_CC) && d.length === 12) {
    return `+${TZ_CC} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  }
  if (!d) return raw || '';
  return `+${d}`;
}

/** wa.me deep link for a directory contact. Optional prefilled
 *  message. Returns null when there's no usable number. */
export function whatsappContactLink(phone: string | undefined, message?: string): string | null {
  const digits = normalizePhone(phone);
  if (digits.length < 9) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

// ── vCard generation (save-to-phone) ─────────────────────────────

function vcardEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** One vCard 3.0 block for a supplier/contact. */
export function contactToVCard(c: Pick<Supplier, 'name' | 'contactName' | 'phone' | 'notes'> & { directoryCategory?: string }): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`FN:${vcardEscape(c.name)}`);
  // N (structured name) — vCard requires it; we only have a display
  // name so the family name slot stays empty.
  lines.push(`N:;${vcardEscape(c.name)};;;`);
  const phone = normalizePhone(c.phone);
  if (phone) lines.push(`TEL;TYPE=CELL:+${phone}`);
  if (c.contactName) lines.push(`NOTE:${vcardEscape(`Contact: ${c.contactName}${c.notes ? ` — ${c.notes}` : ''}`)}`);
  else if (c.notes) lines.push(`NOTE:${vcardEscape(c.notes)}`);
  const cat = findDirectoryCategory(c.directoryCategory);
  if (cat) lines.push(`CATEGORIES:${vcardEscape(cat.label)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** Bundle many contacts into one .vcf file body. */
export function contactsToVCardFile(contacts: Parameters<typeof contactToVCard>[0][]): string {
  return contacts.map(contactToVCard).join('\r\n');
}

/** Trigger a browser download of a .vcf file. */
export function downloadVCard(filename: string, body: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([body], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.vcf') ? filename : `${filename}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Universal importer ───────────────────────────────────────────
// One entry point, three formats, auto-detected:
//   - vCard (.vcf, also how WhatsApp shares contacts)
//   - Google Contacts CSV export
//   - free-text paste ("Name, +255…": one per line)

export interface ParsedContact {
  name: string;
  phone: string;
  notes?: string;
  /** Best-guess category from CATEGORIES / labels; user confirms in UI. */
  guessedCategory?: DirectoryCategory;
}

export type ImportFormat = 'vcard' | 'csv' | 'text';

/** Sniff the format from the raw text so the user doesn't pick. */
export function detectFormat(raw: string): ImportFormat {
  const t = raw.trim();
  if (/BEGIN:VCARD/i.test(t)) return 'vcard';
  // Google CSV export always has a header row containing "Name" and
  // at least one "Phone" column.
  const firstLine = t.split(/\r?\n/, 1)[0] || '';
  if (firstLine.includes(',') && /name/i.test(firstLine) && /phone/i.test(firstLine)) {
    return 'csv';
  }
  return 'text';
}

// Map common category words → our DirectoryCategory ids, so a
// vCard CATEGORIES line or a CSV label can pre-fill the picker.
const CATEGORY_KEYWORDS: { re: RegExp; id: DirectoryCategory }[] = [
  { re: /super|duka|grocer/i,            id: 'supermarket' },
  { re: /butcher|meat|nyama/i,           id: 'butcher' },
  { re: /fish|samaki/i,                  id: 'fishmonger' },
  { re: /baker|bread|mkate/i,            id: 'bakery' },
  { re: /pharmac|chemist|dawa/i,         id: 'pharmacy' },
  { re: /clinic|doctor|hospital|daktari/i, id: 'clinic' },
  { re: /school|tutor|teacher|shule/i,   id: 'school' },
  { re: /nanny|ayah|childcare|day.?care/i, id: 'childcare' },
  { re: /clean|mama wa kazi|house help|dada/i, id: 'cleaner' },
  { re: /restaurant|takeaway|takeout|hotel|food/i, id: 'restaurant' },
  { re: /hardware|tools|building/i,      id: 'hardware' },
  { re: /plumb|pipe|maji/i,              id: 'plumber' },
  { re: /electric|wiring|umeme/i,        id: 'electrician' },
  { re: /fundi|handy|repair/i,           id: 'fundi' },
  { re: /daladala|bajaji|bus|transport/i, id: 'transport' },
  { re: /taxi|bolt|uber|driver|dereva/i, id: 'taxi' },
  { re: /mechanic|garage|gari/i,         id: 'mechanic' },
  { re: /tailor|fundi cherehani|cloth/i, id: 'tailor' },
  { re: /salon|barber|hair|kinyozi/i,    id: 'salon' },
  { re: /m-?pesa|tigo|airtel|mobile money|wakala/i, id: 'mobilemoney' },
];

function guessCategory(...hints: (string | undefined)[]): DirectoryCategory | undefined {
  const hay = hints.filter(Boolean).join(' ');
  if (!hay) return undefined;
  for (const { re, id } of CATEGORY_KEYWORDS) {
    if (re.test(hay)) return id;
  }
  return undefined;
}

// — vCard parser —
function parseVCardText(raw: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  // Unfold folded lines (vCard wraps long lines with a leading space).
  const unfolded = raw.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VCARD/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VCARD/i)[0] || '';
    const lines = body.split(/\r?\n/);
    let fn = '';
    let n = '';
    let phone = '';
    let note = '';
    let categories = '';
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(':');
      if (!rest.length) continue;
      const value = rest.join(':').trim();
      const key = rawKey.split(';')[0].toUpperCase();
      if (key === 'FN') fn = value;
      else if (key === 'N' && !fn) n = value.replace(/;/g, ' ').trim();
      else if (key === 'TEL' && !phone) phone = value;
      else if (key === 'NOTE') note = value.replace(/\\n/g, ' ').replace(/\\,/g, ',');
      else if (key === 'CATEGORIES') categories = value;
    }
    const name = (fn || n).trim();
    if (!name && !phone) continue;
    out.push({
      name: name || 'Unnamed contact',
      phone: normalizePhone(phone),
      notes: note || undefined,
      guessedCategory: guessCategory(categories, note, name),
    });
  }
  return out;
}

// — minimal CSV reader (handles quoted fields + embedded commas) —
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// — Google Contacts CSV parser —
function parseCsvText(raw: string): ParsedContact[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  // Google's export uses "Name" + "Phone 1 - Value"; some exports
  // use "First Name"/"Last Name". We grab whatever matches.
  const nameIdx = header.findIndex((h) => h === 'name');
  const firstIdx = header.findIndex((h) => h.includes('first name'));
  const lastIdx = header.findIndex((h) => h.includes('last name'));
  const orgIdx = header.findIndex((h) => h.includes('organization name') || h === 'organization');
  const phoneIdx = header.findIndex((h) => h.includes('phone') && h.includes('value'));
  const phoneFallbackIdx = header.findIndex((h) => h.includes('phone'));
  const notesIdx = header.findIndex((h) => h === 'notes' || h.includes('note'));
  const labelsIdx = header.findIndex((h) => h.includes('label') || h.includes('group'));
  const out: ParsedContact[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (idx: number) => (idx >= 0 ? (cells[idx] || '').trim() : '');
    let name = get(nameIdx);
    if (!name) name = [get(firstIdx), get(lastIdx)].filter(Boolean).join(' ').trim();
    if (!name) name = get(orgIdx);
    const phone = normalizePhone(get(phoneIdx) || get(phoneFallbackIdx));
    const notes = get(notesIdx);
    if (!name && !phone) continue;
    out.push({
      name: name || 'Unnamed contact',
      phone,
      notes: notes || undefined,
      guessedCategory: guessCategory(get(labelsIdx), get(orgIdx), notes, name),
    });
  }
  return out;
}

// — free-text paste parser —
// One contact per line. Tolerant of:
//   John Plumber, +255712345678
//   John Plumber  0712 345 678
//   +255712345678  John Plumber
function parseTextLines(raw: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Pull the first phone-looking run of digits (with optional + and
    // spaces/dashes) out of the line; whatever's left is the name.
    const phoneMatch = trimmed.match(/\+?[\d][\d\s\-()]{6,}\d/);
    const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : '';
    let name = trimmed;
    if (phoneMatch) name = trimmed.replace(phoneMatch[0], '');
    name = name.replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name && !phone) continue;
    out.push({
      name: name || 'Unnamed contact',
      phone,
      guessedCategory: guessCategory(name),
    });
  }
  return out;
}

/** Universal entry point — sniff the format, parse accordingly. */
export function parseContacts(raw: string): { format: ImportFormat; contacts: ParsedContact[] } {
  const format = detectFormat(raw);
  const contacts =
    format === 'vcard' ? parseVCardText(raw)
    : format === 'csv' ? parseCsvText(raw)
    : parseTextLines(raw);
  return { format, contacts };
}
