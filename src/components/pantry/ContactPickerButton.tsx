'use client';

// Phone-contact picker button. Uses the W3C Contact Picker API
// (`navigator.contacts.select`) when available — works on Android
// Chrome / Edge / Samsung Internet, and PWA-installed Kaya on those.
// On iOS Safari and desktop browsers it isn't supported, so we render
// a disabled button with a clear hint instead of hiding the affordance
// (parents on iOS still know the feature exists).
//
// Returned contact: `{ name, phone }`. The supplier form uses these to
// pre-fill its fields. The user can edit before saving.

import { useEffect, useState } from 'react';

export interface PickedContact {
  name: string;
  phone: string;
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<Array<{
    name?: string[];
    tel?: string[];
  }>>;
  getProperties?(): Promise<string[]>;
}

declare global {
  interface Navigator {
    contacts?: ContactsManager;
  }
}

export default function ContactPickerButton({
  onPicked,
}: {
  onPicked: (contact: PickedContact) => void;
}) {
  const [supported, setSupported] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof navigator === 'undefined') return setSupported('no');
    const ok = !!navigator.contacts && typeof navigator.contacts.select === 'function';
    setSupported(ok ? 'yes' : 'no');
  }, []);

  const pick = async () => {
    if (!navigator.contacts) return;
    setError('');
    setBusy(true);
    try {
      const results = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (!results || results.length === 0) {
        setBusy(false);
        return;
      }
      const c = results[0];
      onPicked({
        name: (c.name && c.name[0]) || '',
        phone: (c.tel && c.tel[0]) || '',
      });
    } catch (e: any) {
      // User cancelled the picker → no error message. Other failures
      // (permission denied, etc.) we surface inline.
      if (e?.name !== 'AbortError') {
        setError(e?.message || 'Could not read contacts.');
      }
    }
    setBusy(false);
  };

  if (supported === 'no') {
    return (
      <div className="rounded-hive border border-dashed border-hive-line bg-hive-cream/60 px-3 py-2 text-[11px] text-hive-muted">
        📱 Contact-picker isn&apos;t supported in this browser. On a phone,
        try Chrome or open Kaya as an installed app.
      </div>
    );
  }
  if (supported === 'unknown') return null;

  return (
    <div>
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        className="w-full h-10 rounded-hive-pill bg-pantry-leaf-soft text-pantry-leaf-dk font-nunito font-extrabold text-[12px] hover:brightness-95 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
      >
        <span>📱</span>
        {busy ? 'Opening…' : 'Pick from phone contacts'}
      </button>
      {error && <p className="text-hive-rose text-[11px] font-bold mt-1">{error}</p>}
    </div>
  );
}
