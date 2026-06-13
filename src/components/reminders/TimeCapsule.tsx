'use client';

// 📮 Time Capsule (Kaya Reminders R3) — schedule a message (+ photo) to
// auto-deliver on a future date: a birthday wish, "open on your 18th", a note
// that resurfaces next anniversary. Anyone can create one. The daily reminders
// cron delivers it — 'family' to the family chat, 'self'/'member' privately
// (in-app + email). Voice notes are a planned fast-follow (the model carries a
// voiceUrl seam). Reuses the messaging photo-upload pipeline for the image.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { uploadMessagePhoto } from '@/lib/messagingUpload';
import { toDisplayDate } from '@/lib/dates';
import {
  fetchTimeCapsules, saveTimeCapsule, deleteTimeCapsule, capsuleStatus, todayKey, addDaysKey,
  type TimeCapsule, type CapsuleAudience,
} from '@/lib/reminders';
import type { UserProfile } from '@/lib/firestore';

const CAP = '#3FAF9E';
const CAP_DK = '#2E7D71';

export default function TimeCapsule({ members, ownUid, familyId }: { members: UserProfile[]; ownUid: string; familyId: string }) {
  const { user } = useAuth();
  const [capsules, setCapsules] = useState<TimeCapsule[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      setCapsules(await fetchTimeCapsules(token));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null;

  const pending = capsules.filter((c) => !c.delivered).sort((a, b) => (a.deliverOn < b.deliverOn ? -1 : 1));
  const delivered = capsules.filter((c) => c.delivered).sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));

  return (
    <div className="mb-5">
      <div className="rounded-kaya p-4 text-white" style={{ background: `linear-gradient(135deg,#10142E,${CAP} 160%)` }}>
        <div className="flex items-center justify-between">
          <div className="font-display font-extrabold flex items-center gap-2">📮 Time Capsule</div>
          <button onClick={() => setComposeOpen(true)} className="text-[11px] font-extrabold rounded-full px-3 py-1.5 bg-white/15 hover:bg-white/25">
            + New capsule
          </button>
        </div>
        <div className="text-[12px] opacity-90 mt-1.5">
          Seal a message or photo to open on a future date — a birthday wish, a note for years from now.
        </div>

        {pending.length > 0 && (
          <div className="space-y-1.5 mt-3">
            {pending.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-kaya-sm bg-white/12 px-3 py-2">
                <span>{c.photoUrl ? '🖼️' : '✉️'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold truncate">{c.message || 'A photo'}</div>
                  <div className="text-[10.5px] opacity-90">to {audienceLabel(c, ownUid)}</div>
                </div>
                <span className="text-[10.5px] font-extrabold shrink-0" style={{ color: '#BFEEE5' }}>{capsuleStatus(c)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {delivered.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand px-1">Opened capsules</div>
          {delivered.slice(0, 5).map((c) => (
            <div key={c.id} className="bg-white rounded-kaya border border-kaya-warm-dark px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span>📮</span>
                <span className="text-[12px] font-extrabold text-kaya-chocolate">From {c.createdByUid === ownUid ? 'you' : c.createdByName || 'family'}</span>
                <span className="ml-auto text-[10px] text-kaya-sand">{toDisplayDate(c.deliverOn)}</span>
              </div>
              {c.message && <div className="text-[12.5px] text-kaya-chocolate mt-1.5 whitespace-pre-wrap">{c.message}</div>}
              {c.photoUrl && <img src={c.photoUrl} alt="" className="rounded-kaya-sm mt-2 max-h-48 w-auto" />}
            </div>
          ))}
        </div>
      )}

      {composeOpen && (
        <Composer
          members={members}
          ownUid={ownUid}
          familyId={familyId}
          onClose={() => setComposeOpen(false)}
          onSaved={async () => { setComposeOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

function audienceLabel(c: TimeCapsule, ownUid: string): string {
  if (c.audience === 'family') return 'the whole family';
  if (c.audience === 'self' || c.toUid === ownUid) return 'future you';
  return c.toName || 'a family member';
}

function Composer({
  members, ownUid, familyId, onClose, onSaved,
}: {
  members: UserProfile[];
  ownUid: string;
  familyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [audience, setAudience] = useState<CapsuleAudience>('self');
  const [toUid, setToUid] = useState<string>(members.find((m) => m.uid !== ownUid)?.uid || '');
  const [deliverOn, setDeliverOn] = useState<string>(addDaysKey(todayKey(), 365)); // default a year out
  const [message, setMessage] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickPhoto(file: File) {
    setUploading(true); setError('');
    try {
      const att = await uploadMessagePhoto(familyId, 'group', file);
      setPhotoUrl(att.url);
    } catch {
      setError('Could not upload that image.');
    } finally { setUploading(false); }
  }

  async function send() {
    if (!user) return;
    if (!message.trim() && !photoUrl) { setError('Write a message or add a photo'); return; }
    if (deliverOn <= todayKey()) { setError('Pick a future date'); return; }
    if (audience === 'member' && !toUid) { setError('Choose who it’s for'); return; }
    setSaving(true); setError('');
    try {
      const token = await user.getIdToken();
      const toName = audience === 'member' ? members.find((m) => m.uid === toUid)?.displayName : undefined;
      await saveTimeCapsule(token, { audience, toUid: audience === 'member' ? toUid : undefined, toName, deliverOn, message: message.trim(), photoUrl: photoUrl || undefined });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not seal the capsule');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-kaya-cream w-full sm:max-w-md rounded-t-kaya-lg sm:rounded-kaya-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-kaya-cream border-b border-kaya-warm-dark px-4 py-3 flex items-center justify-between">
          <div className="font-display font-extrabold text-kaya-chocolate">📮 Seal a time capsule</div>
          <button onClick={onClose} className="text-kaya-sand text-xl leading-none px-2">✕</button>
        </div>
        <div className="p-4 space-y-4">
          {/* Audience */}
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-2">Who opens it?</div>
            <div className="flex flex-wrap gap-2">
              <CapChip on={audience === 'self'} onClick={() => setAudience('self')}>🙂 Future me</CapChip>
              <CapChip on={audience === 'member'} onClick={() => setAudience('member')}>🧒 A family member</CapChip>
              <CapChip on={audience === 'family'} onClick={() => setAudience('family')}>👨‍👩‍👧 Whole family</CapChip>
            </div>
            {audience === 'member' && (
              <select value={toUid} onChange={(e) => setToUid(e.target.value)} className="mt-2 w-full rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-2 text-sm font-bold text-kaya-chocolate">
                <option value="">Choose…</option>
                {members.filter((m) => m.uid !== ownUid).map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
              </select>
            )}
          </div>

          {/* Deliver date */}
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-2">Open on</div>
            <input type="date" value={deliverOn} min={addDaysKey(todayKey(), 1)} onChange={(e) => setDeliverOn(e.target.value)}
              className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
            {deliverOn && <div className="text-[11px] text-kaya-sand mt-1">{toDisplayDate(deliverOn)}</div>}
          </div>

          {/* Message */}
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-2">Your message</div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder="Dear future you…" className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm text-kaya-chocolate resize-none" />
          </div>

          {/* Photo */}
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-2">Add a photo (optional)</div>
            {photoUrl ? (
              <div className="relative inline-block">
                <img src={photoUrl} alt="" className="rounded-kaya-sm max-h-40" />
                <button onClick={() => setPhotoUrl('')} className="absolute -top-2 -right-2 bg-white rounded-full w-6 h-6 border border-kaya-warm-dark text-sm">✕</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={uploading}
                className="rounded-kaya border border-dashed border-kaya-warm-dark px-4 py-3 text-sm font-bold text-kaya-sand w-full">
                {uploading ? 'Uploading…' : '📷 Attach a photo'}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickPhoto(f); }} />
          </div>

          {error && <div className="text-sm text-red-600 font-medium">{error}</div>}

          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1" />
            <button onClick={onClose} className="rounded-kaya px-4 py-2.5 text-sm font-bold text-kaya-sand bg-white border border-kaya-warm-dark">Cancel</button>
            <button onClick={send} disabled={saving || uploading} className="rounded-kaya px-6 py-2.5 text-sm font-extrabold text-white disabled:opacity-60" style={{ background: CAP_DK }}>
              {saving ? 'Sealing…' : '📮 Seal it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-xs font-bold rounded-kaya-sm px-3 py-2 border transition"
      style={on ? { background: '#E0F5F1', borderColor: CAP, color: CAP_DK } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
      {children}
    </button>
  );
}
