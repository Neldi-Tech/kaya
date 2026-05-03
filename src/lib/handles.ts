// Handle validation, suggestions, and display formatting.
//
// Storage: handle is stored with case preserved (e.g. "Timotheo").
//          handleLower is also stored for case-insensitive uniqueness checks.
// URLs:    always lowercase — /u/timotheo
// Display: always with leading "@" and case preserved — "@Timotheo"
//          Family display adds "'s Family" suffix — "@Timotheo's Family"
//          People display has no suffix — "@Daniella"

const HANDLE_REGEX = /^[A-Z][A-Za-z0-9]{2,23}$/;

// What the user typed → canonical form. Returns null if invalid.
// Strips leading "@" if present, ensures first char uppercase.
export function normalizeHandle(input: string): string | null {
  if (!input) return null;
  const stripped = input.replace(/^@+/, '').trim();
  if (!stripped) return null;
  // Force first char uppercase, leave the rest as the user typed it.
  const candidate = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return HANDLE_REGEX.test(candidate) ? candidate : null;
}

export function isValidHandle(input: string): boolean {
  return normalizeHandle(input) !== null;
}

export function handleErrorMessage(input: string): string {
  if (!input) return 'Pick a handle.';
  const stripped = input.replace(/^@+/, '').trim();
  if (stripped.length < 3) return 'At least 3 characters.';
  if (stripped.length > 24) return 'At most 24 characters.';
  if (!/^[A-Za-z]/.test(stripped)) return 'Must start with a letter.';
  if (!/^[A-Za-z0-9]+$/.test(stripped)) return 'Letters and numbers only.';
  return '';
}

// "The Timotheo Family" → ["Timotheo", "Timotheofam", "Thetimotheos"]
export function suggestFamilyHandles(familyName: string): string[] {
  if (!familyName) return [];
  // Strip leading "the", trailing "family"/"household".
  const cleaned = familyName
    .replace(/^the\s+/i, '')
    .replace(/\s+(family|household)$/i, '')
    .trim();
  const firstWord = (cleaned.split(/\s+/)[0] || '').replace(/[^A-Za-z0-9]/g, '');
  if (!firstWord) return [];
  const cap = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
  const out = new Set<string>();
  if (HANDLE_REGEX.test(cap)) out.add(cap);
  const fam = cap + 'fam';
  if (HANDLE_REGEX.test(fam)) out.add(fam);
  const the = 'The' + cap + 's';
  if (HANDLE_REGEX.test(the)) out.add(the);
  return Array.from(out).slice(0, 3);
}

// "Daniella Timotheo" → "Daniella"
export function suggestPersonHandle(name: string): string | null {
  if (!name) return null;
  const firstWord = (name.trim().split(/\s+/)[0] || '').replace(/[^A-Za-z0-9]/g, '');
  if (!firstWord) return null;
  const cap = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
  return HANDLE_REGEX.test(cap) ? cap : null;
}

// "Timotheo" → "@Timotheo's Family"
export function formatFamilyHandle(handle: string | undefined): string {
  if (!handle) return '';
  return `@${handle}'s Family`;
}

// "Daniella" → "@Daniella"
export function formatPersonHandle(handle: string | undefined): string {
  if (!handle) return '';
  return `@${handle}`;
}

// "Timotheo" → "timotheo" (used in URL)
export function handleToSlug(handle: string): string {
  return handle.toLowerCase();
}
