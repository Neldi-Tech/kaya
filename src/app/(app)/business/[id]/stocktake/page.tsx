'use client';

// Kaya Business · Daily stock-take (Phase 2 · A1). A 1-minute guided update:
// tap each item's count, jot what changed, and snap a photo (always required).
// Saving applies the count changes (reusing updateBusinessItem → worth
// recomputes) + records the day's stock-take for the streak / weekly effort.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Business, BusinessItem, StockTake, StockMedia,
  subscribeToBusiness, subscribeToBusinessItems, subscribeToStockTakes,
  updateBusinessItem, saveStockTake, todayKey, stockTakeStreak,
  readBusinessConfig, requestStockTakeHp, flagStockTakeHp,
} from '@/lib/business';
import { uploadBusinessPhoto, uploadBusinessVideo } from '@/lib/businessPhoto';
import { auth } from '@/lib/firebase';
import { toDisplayDate } from '@/lib/dates';
import { useCelebrate } from '@/components/celebrate/CelebrationProvider';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Photos + clips of one stock-take, in display order (photos first). */
function takeMedia(t: StockTake): StockMedia[] {
  if (t.media?.length) return t.media;
  return t.photoUrl ? [{ url: t.photoUrl, kind: 'photo' }] : [];
}

export default function StockTakePage() {
  const params = useParams();
  const router = useRouter();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const familyId = profile?.familyId;

  const [business, setBusiness] = useState<Business | null>(null);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  // When a (non-instant) product's count drops, the kid says why: sold or spoiled.
  const [reason, setReason] = useState<Record<string, 'sold' | 'spoiled'>>({});
  const [note, setNote] = useState('');
  // Up to a few photos + one short clip. Each holds the File + a local preview.
  const [media, setMedia] = useState<Array<{ id: string; file: File; preview: string; kind: 'photo' | 'video' }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const MAX_PHOTOS = 5;
  const hasVideo = media.some((m) => m.kind === 'video');
  const photoCount = media.filter((m) => m.kind === 'photo').length;
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // Clickable history: the day being viewed + a full-screen photo zoom.
  const [openTake, setOpenTake] = useState<StockTake | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const celebrate = useCelebrate();

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

  const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const pickPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMedia((prev) => {
      const room = MAX_PHOTOS - prev.filter((m) => m.kind === 'photo').length;
      const add = files.slice(0, Math.max(0, room)).map((f) => ({ id: rid(), file: f, preview: URL.createObjectURL(f), kind: 'photo' as const }));
      return [...prev, ...add];
    });
    e.target.value = '';
  };
  const pickVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { setError('That clip is too big — keep it short (≤15s).'); return; }
    setError('');
    setMedia((prev) => [...prev.filter((m) => m.kind !== 'video'), { id: rid(), file: f, preview: URL.createObjectURL(f), kind: 'video' as const }]);
  };
  const removeMedia = (id: string) => setMedia((prev) => prev.filter((m) => m.id !== id));

  const save = async () => {
    if (!familyId || !business || !profile?.uid) return;
    if (media.length === 0) { setError("Add at least one photo first 📷"); return; }
    // Spoilage needs an explanation so the AI + parent can learn from it.
    if (Object.values(reason).includes('spoiled') && !note.trim()) {
      setError('Add a quick note about what went bad 🥀');
      return;
    }
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
      // Upload all media (photos downscale; video uploads as-is).
      const uploaded: StockMedia[] = [];
      for (const m of media) {
        try {
          const url = m.kind === 'video'
            ? await uploadBusinessVideo(familyId, businessId, m.file)
            : await uploadBusinessPhoto(familyId, businessId, m.file);
          if (url) uploaded.push({ url, kind: m.kind });
        } catch (e: any) { setError(e?.message || 'Could not upload a clip.'); setSaving(false); return; }
      }
      await saveStockTake(familyId, businessId, {
        date: today, ownerId: business.ownerId, itemsTouched: changed,
        note: note.trim() || undefined, media: uploaded,
      }, profile.uid);

      // Instant-cadence House Points: grant (auto) or ask a parent (review) for
      // today's point — once per day. Best-effort: never block the stock-take.
      let earnedHp = 0; // only counts points actually granted now (auto path)
      const hp = readBusinessConfig(family).hpAward;
      const prior = takes.find((t) => t.date === today);
      if (hp.cadence === 'instant' && hp.perDayHp > 0 && !(prior?.hpGranted || prior?.hpRequested)) {
        const bizRef = { id: businessId, ownerId: business.ownerId, name: business.name, emoji: business.emoji };
        const askParent = async () => {
          await requestStockTakeHp(familyId, bizRef, hp.perDayHp, today, profile!.uid);
          await flagStockTakeHp(familyId, businessId, today, { hpRequested: true });
        };
        try {
          if (hp.mode === 'auto') {
            let granted = false;
            try {
              const tok = await auth.currentUser?.getIdToken();
              if (tok) {
                const r = await fetch('/api/business/stocktake-hp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
                  body: JSON.stringify({ businessId, date: today }),
                });
                const j = await r.json();
                granted = !!j?.ok && !j?.skipped;
              }
            } catch { /* fall through */ }
            if (!granted) await askParent(); // admin path unavailable — don't lose the point
            else earnedHp = hp.perDayHp;
          } else {
            await askParent();
          }
        } catch { /* best-effort */ }
      }

      // 🎉 Celebrate the effort (the kid showed up). Points only shown when
      // actually granted now; the overlay lives in the (app) layout so it
      // persists over the navigation to the dashboard.
      celebrate({ kind: 'stocktake', points: earnedHp || undefined, streak: doneToday ? streak : streak + 1 });

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

      {/* Clickable history — tap a day to see its photos, clips + notes (#2a). */}
      {takes.length > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-nunito font-extrabold text-[14px]">📚 Stock-take history</h3>
            <span className="text-[11px] text-hive-muted">tap a day</span>
          </div>
          <div className="space-y-1">
            {takes.map((t) => {
              const ms = takeMedia(t);
              const cover = ms.find((m) => m.kind === 'photo') || ms[0];
              const photoN = ms.filter((m) => m.kind === 'photo').length;
              const vidN = ms.filter((m) => m.kind === 'video').length;
              return (
                <button key={t.id} type="button" onClick={() => setOpenTake(t)}
                  className="w-full flex items-center gap-3 p-2 rounded-hive hover:bg-hive-cream/70 transition text-left">
                  <div className="w-12 h-12 rounded-hive overflow-hidden border border-hive-line bg-hive-cream shrink-0 flex items-center justify-center">
                    {cover ? (
                      cover.kind === 'video'
                        ? <video src={cover.url} className="w-full h-full object-cover" muted playsInline />
                        : <img src={cover.url} alt="" className="w-full h-full object-cover" />
                    ) : <span className="text-[18px]">📦</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-[13px] text-hive-navy">{toDisplayDate(t.date)}{t.date === today ? ' · today' : ''}</div>
                    <div className="text-[11px] text-hive-muted flex items-center gap-2 flex-wrap mt-0.5">
                      <span>{t.itemsTouched} updated</span>
                      {photoN > 0 && <span>📸 {photoN}</span>}
                      {vidN > 0 && <span>🎬 {vidN}</span>}
                      {t.note && <span>📝</span>}
                      {t.parentNote && <span className="text-hive-honey-dk font-bold">💬 parent</span>}
                    </div>
                  </div>
                  <span className="text-hive-muted text-[18px] shrink-0">›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              <span className="text-[11px] text-hive-muted">tap +/− or type</span>
            </div>
            {live.length === 0 ? (
              <p className="text-[12px] text-hive-muted py-3 text-center">No inventory yet — add items first from Inventory.</p>
            ) : live.map((it) => {
              const cur = qty[it.id] ?? it.qty;
              const delta = cur - it.qty;
              const r = reason[it.id];
              const miniChip = (on: boolean) => `px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border ${on ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-white text-hive-muted border-hive-line'}`;
              return (
                <div key={it.id} className="py-2 border-b border-dashed border-hive-line last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-nunito font-bold truncate">{it.name}{it.instantStock ? ' 🌱' : ''}</div>
                      <div className="text-[11px] text-hive-muted">yesterday: {it.qty}{it.unitLabel ? ` ${it.unitLabel}` : ''}{it.stage ? ` · ${it.stage}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => step(it.id, -1)} className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px]">−</button>
                      <input type="number" inputMode="numeric" value={cur} aria-label={`${it.name} count`}
                        onChange={(e) => setQty((p) => ({ ...p, [it.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className={`w-14 h-8 text-center font-nunito font-black rounded-hive border border-hive-line bg-white text-[14px] ${delta !== 0 ? 'text-hive-honey-dk' : ''}`} />
                      <button onClick={() => step(it.id, 1)} className="w-8 h-8 rounded-hive border border-hive-line bg-white text-[16px]">+</button>
                    </div>
                  </div>
                  {delta > 0 && (
                    <p className="text-[11px] text-[#2F7D32] font-nunito font-bold mt-1">🌱 +{delta} since yesterday — nice {it.instantStock ? 'harvest' : 'gain'}!</p>
                  )}
                  {delta < 0 && !it.instantStock && (
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[#B25E16] font-nunito font-bold">📉 {delta} — what happened?</span>
                      <button onClick={() => setReason((p) => ({ ...p, [it.id]: 'sold' }))} className={miniChip(r === 'sold')}>💵 sold</button>
                      <button onClick={() => setReason((p) => ({ ...p, [it.id]: 'spoiled' }))} className={miniChip(r === 'spoiled')}>🥀 went bad</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Note */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">What changed today? (optional)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Henrietta laid 2 today!"
            className="w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40 mb-3" />

          {/* Required photos + optional clip */}
          <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">
            Today&apos;s photos &amp; clips · <span className="text-hive-rose">1+ required</span>
          </div>
          {live.length >= 2 && (
            <p className="text-[12px] text-hive-navy/70 mb-2 leading-relaxed">
              📸 You sell <b>{live.length} products</b> — try to snap <b>at least 2</b> today, and rotate which ones each day so all of them get seen
              {photoFocus.length === 2 ? <> · maybe <b>{photoFocus[0].name}</b> &amp; <b>{photoFocus[1].name}</b> today</> : ''}.
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={pickPhotos} className="hidden" />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={pickVideo} className="hidden" />
          <div className="flex flex-wrap gap-2 mb-2">
            {media.map((m) => (
              <div key={m.id} className="relative w-[72px] h-[72px] rounded-hive overflow-hidden border border-hive-line bg-hive-cream">
                {m.kind === 'video' ? (
                  <video src={m.preview} className="w-full h-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.preview} alt="" className="w-full h-full object-cover" />
                )}
                {m.kind === 'video' && <span className="absolute bottom-0.5 left-0.5 text-[10px] bg-black/50 text-white px-1 rounded">🎬</span>}
                <button type="button" onClick={() => removeMedia(m.id)} aria-label="Remove"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-hive-rose text-white text-[11px] flex items-center justify-center border-2 border-white">✕</button>
              </div>
            ))}
            {photoCount < MAX_PHOTOS && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-[72px] h-[72px] rounded-hive border-2 border-dashed border-hive-honey bg-[#FFFBEE] text-[#B25E16] text-[22px] font-black flex items-center justify-center">＋</button>
            )}
            {!hasVideo && (
              <button type="button" onClick={() => videoRef.current?.click()}
                className="w-[72px] h-[72px] rounded-hive border-2 border-dashed border-hive-honey bg-[#FFFBEE] text-[#B25E16] text-[11px] font-extrabold flex flex-col items-center justify-center gap-0.5"><span className="text-[18px]">🎬</span>clip</button>
            )}
          </div>
          <p className="text-[11px] text-hive-muted mb-3">Tap ✕ to remove · ＋ photo (up to {MAX_PHOTOS}) · 🎬 one short clip (≤15s).</p>

          {error && <p className="text-hive-rose text-[12px] font-bold mb-2">{error}</p>}

          <button onClick={save} disabled={saving || media.length === 0}
            className="w-full h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
            {saving ? 'Saving…' : `Save today's stock-take${touched > 0 ? ` (${touched} updated)` : ''}`}
          </button>
          <p className="text-[11px] text-hive-muted text-center mt-2">Updates your inventory + worth, saves the photo, and keeps your streak going.</p>
        </>
      )}

      {/* History detail — that day's photos/clips + the kid's note + a parent's note. */}
      {openTake && (
        <div onClick={() => setOpenTake(null)}
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4">
          <div onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-hive-paper rounded-t-hive-lg sm:rounded-hive-lg p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-nunito font-black text-[15px]">{toDisplayDate(openTake.date)}{openTake.date === today ? ' · today' : ''}</h3>
              <button type="button" onClick={() => setOpenTake(null)} className="w-8 h-8 rounded-full bg-hive-cream text-hive-muted font-black">✕</button>
            </div>
            <p className="text-[12px] text-hive-muted mb-3">{openTake.itemsTouched} item{openTake.itemsTouched === 1 ? '' : 's'} updated</p>
            {takeMedia(openTake).length ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {takeMedia(openTake).map((m, i) => (
                  m.kind === 'video'
                    ? <video key={i} src={m.url} controls playsInline className="w-[104px] h-[104px] rounded-hive object-cover bg-black" />
                    : <button key={i} type="button" onClick={() => setZoom(m.url)}
                        className="w-[104px] h-[104px] rounded-hive overflow-hidden border border-hive-line hover:brightness-95 transition">
                        <img src={m.url} alt="Stock-take" className="w-full h-full object-cover" />
                      </button>
                ))}
              </div>
            ) : <p className="text-[12px] text-hive-muted mb-3">No photos for this day.</p>}
            {openTake.note && (
              <div className="bg-hive-cream rounded-hive p-3 mb-2">
                <div className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted mb-0.5">Note</div>
                <p className="text-[13px] text-hive-navy leading-snug">📝 {openTake.note}</p>
              </div>
            )}
            {openTake.parentNote && (
              <div className="bg-hive-honey-soft border border-hive-honey rounded-hive p-3">
                <div className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-honey-dk mb-0.5">From a parent</div>
                <p className="text-[13px] text-hive-navy leading-snug">💬 {openTake.parentNote}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {zoom && (
        <div onClick={() => setZoom(null)}
          className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out">
          <img src={zoom} alt="Stock-take" className="max-w-full max-h-full rounded-hive-lg" />
        </div>
      )}
    </div>
  );
}
