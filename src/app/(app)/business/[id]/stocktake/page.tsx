'use client';

// Kaya Business · Daily stock-take (Phase 2 · A1). A 1-minute guided update:
// tap each item's count, jot what changed, and snap a photo (always required).
// Saving applies the count changes (reusing updateBusinessItem → worth
// recomputes) + records the day's stock-take for the streak / weekly effort.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  Business, BusinessItem, StockTake,
  subscribeToBusiness, subscribeToBusinessItems, subscribeToStockTakes,
  updateBusinessItem, saveStockTake, todayKey, stockTakeStreak,
} from '@/lib/business';
import { uploadBusinessPhoto } from '@/lib/businessPhoto';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function StockTakePage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToBusinessItems(familyId, businessId, (it) => {
      setItems(it);
      setQty((prev) => {
        const next = { ...prev };
        it.forEach((i) => { if (next[i.id] === undefined) next[i.id] = i.qty; });
        return next;
      });
    });
    const u3 = subscribeToStockTakes(familyId, businessId, setTakes, 30);
    return () => { u1(); u2(); u3(); };
  }, [familyId, businessId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === business?.ownerId;
  const canAct = isParent || isOwner;

  const today = todayKey();
  const doneToday = takes.some((t) => t.date === today);
  const streak = useMemo(() => stockTakeStreak(takes), [takes]);
  const weekDates = useMemo(() => {
    const out: string[] = [];
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) { out.push(todayKey(d)); d.setDate(d.getDate() + 1); }
    return out;
  }, [today]);
  const doneSet = useMemo(() => new Set(takes.map((t) => t.date)), [takes]);

  const live = items.filter((i) => !i.loss);
  const touched = live.filter((i) => qty[i.id] !== undefined && qty[i.id] !== i.qty).length;

  // Multi-product photo advice: suggest 2 products to feature today, rotating
  // by the day so each product gets its turn over the week.
  const photoFocus = useMemo(() => {
    const ps = items.filter((i) => !i.loss);
    if (ps.length < 2) return [] as BusinessItem[];
    const dayIdx = new Date(`${today}T12:00:00`).getDate();
    return [ps[dayIdx % ps.length], ps[(dayIdx + 1) % ps.length]].filter(Boolean) as BusinessItem[];
  }, [items, today]);

  const step = (id: string, delta: number) =>
    setQty((p) => ({ ...p, [id]: Math.max(0, (p[id] ?? 0) + delta) }));

  const pickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (!photoFile) { setError("Add today's photo first 📷"); return; }
    setError(''); setSaving(true);
    try {
      // Apply count changes.
      let changed = 0;
      for (const it of live) {
        const nq = qty[it.id];
        if (nq !== undefined && nq !== it.qty) {
          await updateBusinessItem(familyId, businessId, it.id, { qty: nq });
          changed++;
        }
      }
      const photoUrl = await uploadBusinessPhoto(familyId, businessId, photoFile);
      await saveStockTake(familyId, businessId, {
        date: today, ownerId: business.ownerId, itemsTouched: changed,
        note: note.trim() || undefined, photoUrl: photoUrl || undefined,
      }, profile.uid);
      router.push(`/business/${businessId}`);
    } catch (e: any) {
      setError(e?.message || 'Could not save the stock-take.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">📋</div>
        <div className="min-w-0">
          <div className="font-nunito font-black text-[16px]">Daily stock-take</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">
            {business?.name || 'Loading…'} · {new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Streak */}
      <div className="rounded-hive p-3.5 mb-3 text-hive-cream" style={{ background: 'linear-gradient(135deg, #1F1A12 0%, #3D3320 100%)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-nunito font-extrabold text-hive-honey-soft">Streak</div>
            <div className="font-nunito font-black text-[22px]">{streak} {streak === 1 ? 'day' : 'days'} {streak > 0 ? '🔥' : ''}</div>
          </div>
          <div className="flex gap-1.5">
            {weekDates.map((d, i) => {
              const on = doneSet.has(d);
              return (
                <div key={d} className={`w-7 h-7 rounded-[8px] flex items-center justify-center text-[12px] font-nunito font-extrabold ${on ? 'bg-hive-honey text-hive-navy' : 'bg-white/10 text-hive-cream/50'}`}>
                  {DOW[i]}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!canAct ? (
        <p className="text-hive-muted text-sm text-center py-8">Only the owner or a parent can do the stock-take.</p>
      ) : (
        <>
          {doneToday && (
            <div className="bg-[#E2F0E2] border border-[#2F7D32]/30 rounded-hive p-3 mb-3 text-[12.5px] text-[#2F7D32] font-nunito font-bold">
              ✓ Already done today — you can update it again if something changed.
            </div>
          )}

          {/* Counts */}
          <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-nunito font-extrabold text-[14px]">Update today&apos;s counts</h3>
              <span className="text-[11px] text-hive-muted">tap +/−</span>
            </div>
            {live.length === 0 ? (
              <p className="text-[12px] text-hive-muted py-3 text-center">No inventory yet — add items first from Inventory.</p>
            ) : live.map((it) => (
              <div key={it.id} className="flex items-center gap-3 py-2 border-b border-dashed border-hive-line last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-nunito font-bold truncate">{it.name}</div>
                  {it.stage && <div className="text-[11px] text-hive-muted">{it.stage}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => step(it.id, -1)} className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px]">−</button>
                  <span className={`w-8 text-center font-nunito font-black ${qty[it.id] !== it.qty ? 'text-hive-honey-dk' : ''}`}>{qty[it.id] ?? it.qty}</span>
                  <button onClick={() => step(it.id, 1)} className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px]">+</button>
                </div>
              </div>
            ))}
          </div>

          {/* Note */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">What changed today? (optional)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Henrietta laid 2 today!"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40 mb-3" />

          {/* Required photo */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">
            Today&apos;s photo · <span className="text-hive-rose">required</span>
          </div>
          {live.length >= 2 && (
            <p className="text-[12px] text-hive-navy/70 mb-2 leading-relaxed">
              📸 You sell <b>{live.length} products</b> — try to snap <b>at least 2</b> today, and rotate which ones each day so all of them get seen
              {photoFocus.length === 2 ? <> · maybe <b>{photoFocus[0].name}</b> &amp; <b>{photoFocus[1].name}</b> today</> : ''}.
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="hidden" />
          {photoPreview ? (
            <button onClick={() => fileRef.current?.click()} className="block w-full rounded-hive overflow-hidden border border-hive-line mb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPreview} alt="Today's stock-take" className="w-full h-44 object-cover" />
            </button>
          ) : (
            <button onClick={() => fileRef.current?.click()}
              className="w-full rounded-hive border-2 border-dashed border-hive-honey bg-[#FFFBEE] p-6 text-center text-[13px] font-nunito font-bold text-[#B25E16] mb-3">
              📷 Tap to add today&apos;s photo
            </button>
          )}

          {error && <p className="text-hive-rose text-[12px] font-bold mb-2">{error}</p>}

          <button onClick={save} disabled={saving || !photoFile}
            className="w-full h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : `Save today's stock-take${touched > 0 ? ` (${touched} updated)` : ''}`}
          </button>
          <p className="text-[11px] text-hive-muted text-center mt-2">Updates your inventory + worth, saves the photo, and keeps your streak going.</p>
        </>
      )}
    </div>
  );
}
