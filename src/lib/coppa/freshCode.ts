// Kaya · COPPA + Login — one-time plaintext handoff (add-child → codes screen).
//
// The freshly issued Kaya Code plaintext is shown to the parent exactly once.
// It is NEVER persisted server-side (only its hash is) and NEVER put in the URL
// (which would leak it into history). We pass it across the client navigation
// via sessionStorage, read it exactly once, then clear it. It also self-expires
// so a stale background tab can't resurface an old code.

const KEY = (childId: string) => `kaya.freshCode.${childId}`;

export interface FreshCode {
  code: string;
  expiresAt?: string;
  name?: string;
}

export function stashFreshCode(childId: string, data: FreshCode): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(KEY(childId), JSON.stringify({ ...data, at: Date.now() }));
  } catch {
    /* sessionStorage unavailable — parent can still regenerate to view */
  }
}

export function takeFreshCode(childId: string): FreshCode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY(childId));
    if (!raw) return null;
    sessionStorage.removeItem(KEY(childId)); // read exactly once
    const parsed = JSON.parse(raw) as FreshCode & { at?: number };
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) return null; // stale
    return { code: parsed.code, expiresAt: parsed.expiresAt, name: parsed.name };
  } catch {
    return null;
  }
}
