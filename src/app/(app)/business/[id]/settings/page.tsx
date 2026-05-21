'use client';

// Kaya Business · per-business settings (Phase 2). Today: the daily stock-take
// reminder time. The local hour the parent picks is converted to a UTC hour so
// the hourly reminder cron needs no per-family timezone. (A3 adds the House-
// Points award mode here next.)

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { Business, subscribeToBusiness, setBusinessReminder } from '@/lib/business';

function labelForHour(h: number): string {
  const d = new Date(); d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function hourToUtc(h: number): number {
  const d = new Date(); d.setHours(h, 0, 0, 0);
  return d.getUTCHours();
}

export default function BusinessSettingsPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(18); // local hour (default 6pm)
  const [init, setInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId || !businessId) return;
    return subscribeToBusiness(familyId, businessId, (b) => {
      setBusiness(b);
      if (b && !init) {
        setEnabled(b.reminder?.enabled ?? false);
        // Best-effort: map stored hourUtc back to a local hour for the picker.
        if (b.reminder) {
          const offset = new Date().getTimezoneOffset() / 60; // UTC = local + offset
          setHour(((b.reminder.hourUtc - offset) % 24 + 24) % 24);
        }
        setInit(true);
      }
    });
  }, [familyId, businessId, init]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canEdit = isParent || isOwner;

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ h, label: labelForHour(h) })), []);

  const save = async () => {
    if (!familyId) return;
    setError(''); setSaving(true); setSaved(false);
    try {
      await setBusinessReminder(familyId, businessId, {
        enabled, hourUtc: hourToUtc(hour), localLabel: labelForHour(hour),
      });
      setSaved(true);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">⚙️</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Settings</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Loading…'}</div>
        </div>
        {business && (
          <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Dashboard →</Link>
        )}
      </div>

      {!canEdit ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can change settings.</p>
      ) : (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-nunito font-extrabold text-[14px]">Daily stock-take reminder</h3>
              <p className="text-[12px] text-hive-muted mt-0.5">A gentle nudge to update counts + snap a photo.</p>
            </div>
            <button
              onClick={() => setEnabled((v) => !v)}
              aria-pressed={enabled}
              className={`w-12 h-7 rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-[#2F7D32]' : 'bg-hive-line'}`}
            >
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {enabled && (
            <div className="mt-3">
              <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Remind at</div>
              <select
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value))}
                className="w-full h-11 px-3 bg-hive-cream rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
              >
                {hours.map((o) => <option key={o.h} value={o.h}>{o.label}</option>)}
              </select>
              <p className="text-[11px] text-hive-muted mt-1.5">Sent to {business?.ownerId ? 'the kid + parents' : 'parents'} each day, unless the stock-take is already done.</p>
            </div>
          )}

          {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}
          {saved && <p className="text-[#2F7D32] text-[12px] font-bold mt-3">✓ Saved</p>}

          <button onClick={save} disabled={saving}
            className="w-full mt-4 h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
            {saving ? 'Saving…' : 'Save reminder'}
          </button>
        </div>
      )}
    </div>
  );
}
