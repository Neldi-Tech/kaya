'use client';

// Kaya Sparks · Treasures 2.0 — 📷 Scan to add (C2 · D28 · D29 · D30 · N1).
//
// "Names never get written wrong." Tiers (D30′, Elia 22-Aug — cover first):
//   1 · 📖 the cover — snap the front of the book (or the game box):
//       Kaya AI reads title + author (games: title + the printed
//       "Ages 8+ · 2–6 players · 30 min"), the title is looked up to
//       canonicalise it and fetch cover · pages · "what it's about" (D43).
//   2 · ▌▌ barcode — live viewfinder, getUserMedia + zxing-wasm decoding
//       frames on the phone (native BarcodeDetector as an accelerator).
//       No live camera? a photo of the barcode runs INSIDE this tab —
//       same decoder, same result (the old third option, folded in).
//   3 · ⌨ manual ⚠ — only after both miss; stays flagged for a parent.
// ONE confirm card for every tier.
//
// Shelf-fill (N1): the camera stays open; every beep drops into a tray;
// confirm all at once. Offline: the code still decodes on the phone, the
// lookup comes back {found:false} and the item waits in the tray.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addCupboardItem, cupboardLookup, normaliseTitle,
  type CupboardShelf, type CupboardKind, type NewCupboardItemInput, type LookupResult,
} from '@/lib/sparks/cupboard';
import { GAME_KINDS, type GameKind, type NameSource, type OwnerScope } from '@/lib/sparks/treasures';
import { Field, ChoiceChips, inputCls, WOOD, WOOD_DK, WOOD_BG, JADE } from './CupboardShell';

interface Props {
  familyId: string;
  shelf: CupboardShelf;
  defaultKind?: CupboardKind;
  onClose: () => void;
  /** Called once the tray is fully added (or one item was). */
  onAdded: (ids: string[]) => void;
  /** Tier 4 — hand the user to the typed card. */
  onTypeInstead: () => void;
}

type Tier = 'front' | 'live';

interface TrayItem {
  key: string;
  code?: string;
  kind: CupboardKind;
  status: 'looking' | 'ready' | 'nomatch' | 'dup' | 'added' | 'error';
  name?: string;
  nameSource?: NameSource;
  book?: LookupResult['book'];
  game?: LookupResult['game'];
  coverUrl?: string;
  dupOf?: { id: string; name: string; ownerName: string };
  addedId?: string;
  allowDuplicate?: boolean;
  error?: string;
}

const BARCODE_FORMATS = ['EAN13', 'UPCA', 'UPCE', 'EAN8'] as const;
const SEEN_COOLDOWN_MS = 5000;

// ── decoder (lazy) ─────────────────────────────────────────────────

type Decoder = (input: Blob | ImageData) => Promise<string | null>;
let decoderPromise: Promise<Decoder> | null = null;

/** Loads zxing-wasm once; the .wasm is bundled as a Next static asset
 *  (no CDN, so it works offline once cached). Falls back to the
 *  library's default (jsDelivr) if the asset URL cannot be resolved. */
function getDecoder(): Promise<Decoder> {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      const mod = await import('zxing-wasm/reader');
      try {
        const wasmUrl = new URL('zxing-wasm/reader/zxing_reader.wasm', import.meta.url).toString();
        mod.prepareZXingModule({
          overrides: {
            locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
          },
        });
      } catch { /* default serve path */ }
      return async (input: Blob | ImageData) => {
        const results = await mod.readBarcodes(input, {
          formats: [...BARCODE_FORMATS], tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1,
        });
        const r = results.find((x) => x.isValid && x.text);
        return r ? r.text : null;
      };
    })();
  }
  return decoderPromise;
}

function normaliseCode(raw: string): string {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  return [8, 10, 12, 13].includes(s.length) ? s : '';
}

function beep() {
  try {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 1200; g.gain.value = 0.07;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.09);
    setTimeout(() => ctx.close().catch(() => {}), 300);
  } catch { /* silent */ }
  try { navigator.vibrate?.(40); } catch { /* noop */ }
}

/** Downscale a photo to ≤1280px JPEG and return base64 (no prefix). */
async function fileToBase64(file: File, max = 1280): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale); const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1] || '', mediaType: 'image/jpeg' };
}

// ── component ───────────────────────────────────────────────────────

export default function CupboardScanSheet({ familyId, shelf, defaultKind = 'book', onClose, onAdded, onTypeInstead }: Props) {
  const me = shelf.me;
  const isParent = me.role === 'parent';
  const isHelper = me.role === 'helper';

  const [tier, setTier] = useState<Tier>('front');
  const [camMsg, setCamMsg] = useState('Starting the camera…');
  /** D30′ · no live camera → the photo paths show inside each tab. */
  const [camFailed, setCamFailed] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [confirm, setConfirm] = useState<TrayItem | null>(null);
  const [frontBusy, setFrontBusy] = useState(false);
  const [frontKind, setFrontKind] = useState<CupboardKind | 'any'>(defaultKind);
  const [frontErr, setFrontErr] = useState('');
  const [pendingCode, setPendingCode] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Whose + where — shared defaults for "Confirm all" (the card can change them).
  const [scope, setScope] = useState<OwnerScope>('family');
  const [kidId, setKidId] = useState<string>(me.childId || shelf.kids[0]?.id || '');
  const [whereKept, setWhereKept] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const seenRef = useRef<Map<string, number>>(new Map());
  const busyFrameRef = useRef(false);

  const whoOptions: Array<{ id: string; label: string }> = [{ id: 'family', label: '🗄 The family' }];
  if (!isHelper) {
    if (isParent) for (const k of shelf.kids) whoOptions.push({ id: `kid:${k.id}`, label: `💎 ${k.name}'s` });
    else if (me.childId) whoOptions.push({ id: `kid:${me.childId}`, label: '💎 Mine' });
  }
  const whoValue = scope === 'family' ? 'family' : `kid:${kidId}`;

  // ── a decoded code → tray ──
  const onCode = useCallback(async (raw: string) => {
    const code = normaliseCode(raw);
    if (!code) return;
    const now = Date.now();
    const last = seenRef.current.get(code) || 0;
    if (now - last < SEEN_COOLDOWN_MS) return;
    seenRef.current.set(code, now);
    beep();
    const key = `${code}-${now}`;
    setTray((t) => {
      if (t.some((x) => x.code === code && x.status !== 'added')) return t; // already in the tray
      return [{ key, code, kind: 'book', status: 'looking' }, ...t];
    });
    const r = await cupboardLookup('code', { code }).catch(() => ({ found: false } as LookupResult));
    setTray((t) => t.map((x) => {
      if (x.key !== key) return x;
      if (r.found && r.kind === 'book' && r.book) {
        return { ...x, status: 'ready', kind: 'book', name: r.book.name, nameSource: 'lookup', book: r.book, coverUrl: r.book.coverUrl };
      }
      if (r.found && r.kind === 'game' && r.name) {
        return { ...x, status: 'ready', kind: 'game', name: r.name, nameSource: 'lookup', game: { name: r.name } };
      }
      return { ...x, status: 'nomatch', kind: (r.kind as CupboardKind) || 'book' };
    }));
  }, []);

  // ── the camera (both tabs) — decode loop only on the barcode tab ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamFailed(true); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
        setCamFailed(false);
        setCamMsg(tier === 'live' ? 'Point at the barcode — hold steady' : 'Hold the front of the book in the frame · tap Snap');
      } catch {
        setCamFailed(true);
        return;
      }
      if (tier !== 'live') return;
      // Decoder: native BarcodeDetector when present, else zxing.
      type BD = { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
      const NativeBD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BD }).BarcodeDetector;
      let native: BD | null = null;
      if (NativeBD) { try { native = new NativeBD({ formats: ['ean_13', 'upc_a', 'upc_e', 'ean_8'] }); } catch { native = null; } }
      const zx = native ? null : await getDecoder().catch(() => null);
      if (!native && !zx) { setCamMsg('Could not start the barcode reader — try a photo instead'); return; }
      const canvas = document.createElement('canvas');
      const tick = async () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && !busyFrameRef.current) {
          busyFrameRef.current = true;
          try {
            if (native) {
              const res = await native.detect(v);
              if (res[0]?.rawValue) await onCode(res[0].rawValue);
            } else if (zx) {
              const scale = Math.min(1, 800 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
              const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const text = await zx(img);
              if (text) await onCode(text);
            }
          } catch { /* next frame */ }
          busyFrameRef.current = false;
        }
        loopRef.current = window.setTimeout(tick, 320);
      };
      tick();
    })();
    return () => {
      cancelled = true;
      if (loopRef.current) window.clearTimeout(loopRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [tier, onCode]);

  // ── tier 2 · still photo ──
  async function decodeStill(file: File) {
    setCamMsg('Reading the photo…');
    try {
      const zx = await getDecoder();
      const text = await zx(file);
      if (text) { await onCode(text); setCamMsg('Got it — scan another, or confirm below'); }
      else setCamMsg('No barcode in that photo — try 📖 the cover instead');
    } catch { setCamMsg('Could not read that — try 📖 the cover instead'); }
  }

  /** 📖 Snap the cover from the live camera → Kaya reads it. */
  async function snapCover() {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || snapping) return;
    setSnapping(true);
    try {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      const blob: Blob | null = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) return;
      await readFront(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
    } finally { setSnapping(false); }
  }

  // ── tier 1 · the cover (Kaya AI) ──
  async function readFront(file: File) {
    setFrontBusy(true); setFrontErr('');
    try {
      const { base64, mediaType } = await fileToBase64(file);
      const r = await cupboardLookup('vision', { imageBase64: base64, mediaType, kind: frontKind === 'any' ? '' : frontKind });
      if (!r.found) {
        setFrontErr(r.reason === 'vision-unavailable'
          ? 'Kaya’s reader isn’t available right now — type it and a parent will confirm.'
          : 'Kaya couldn’t read that cover — try again closer and flatter, or type it.');
        return;
      }
      const item: TrayItem = {
        key: `front-${Date.now()}`, code: pendingCode, status: 'ready',
        kind: r.kind === 'game' ? 'game' : 'book',
        name: r.kind === 'game' ? r.game?.name : r.book?.name,
        nameSource: r.nameSource || 'vision',
        book: r.book, game: r.game, coverUrl: r.book?.coverUrl,
      };
      setPendingCode(undefined);
      setConfirm(item);
    } finally { setFrontBusy(false); }
  }

  // ── add ──
  async function addOne(item: TrayItem, overrides: Partial<TrayItem> & { scope?: OwnerScope; kidId?: string; whereKept?: string } = {}): Promise<TrayItem> {
    const it = { ...item, ...overrides };
    const input: NewCupboardItemInput = {
      kind: it.kind,
      name: (it.name || '').trim(),
      ownerScope: overrides.scope ?? scope,
      kidId: (overrides.scope ?? scope) === 'kid' ? (overrides.kidId ?? kidId) : undefined,
      whereKept: (overrides.whereKept ?? whereKept).trim() || undefined,
      barcode: it.code,
      nameSource: it.nameSource || 'manual',
      allowDuplicate: it.allowDuplicate === true,
    };
    if (it.kind === 'book' && it.book) {
      input.book = { author: it.book.author, pages: it.book.pages, year: it.book.year, publisher: it.book.publisher, coverUrl: it.book.coverUrl, isbn: it.book.isbn || (it.code && it.code.length === 13 ? it.code : undefined), ageMin: it.book.ageMin, summary: it.book.summary, summarySource: it.book.summarySource };
    }
    if (it.kind === 'game' && it.game) {
      input.game = { ageMin: it.game.ageMin, playersMin: it.game.playersMin, playersMax: it.game.playersMax, minutes: it.game.minutes, gameKind: it.game.gameKind };
    }
    if (!input.name) return { ...it, status: 'error', error: 'needs a name' };
    try {
      const r = await addCupboardItem(familyId, input);
      if (r.duplicateOf) return { ...it, status: 'dup', dupOf: r.duplicateOf };
      if (r.id) return { ...it, status: 'added', addedId: r.id };
      return { ...it, status: 'error', error: 'could not add' };
    } catch (e) {
      return { ...it, status: 'error', error: e instanceof Error ? e.message : 'could not add' };
    }
  }

  async function confirmAll() {
    if (busy) return;
    setBusy(true);
    const next: TrayItem[] = [];
    for (const item of tray) {
      if (item.status === 'ready') next.push(await addOne(item));
      else next.push(item);
    }
    setTray(next);
    setBusy(false);
    const added = next.filter((x) => x.status === 'added').map((x) => x.addedId!);
    const remaining = next.filter((x) => x.status !== 'added');
    if (added.length && remaining.length === 0) onAdded(added);
  }

  async function addSecondCopy(key: string) {
    const item = tray.find((x) => x.key === key);
    if (!item) return;
    setBusy(true);
    const r = await addOne({ ...item, allowDuplicate: true });
    setTray((t) => t.map((x) => (x.key === key ? r : x)));
    setBusy(false);
  }

  const ready = tray.filter((x) => x.status === 'ready').length;
  const added = tray.filter((x) => x.status === 'added');

  function close() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (added.length) onAdded(added.map((x) => x.addedId!));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={close}>
      <div className="w-full sm:max-w-md lg:max-w-lg bg-[#FFFBF5] rounded-t-[22px] sm:rounded-[22px] max-h-[94vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 text-white rounded-t-[22px]" style={{ background: 'linear-gradient(135deg,#6E4624 0%,#8B5E34 100%)' }}>
          <div className="text-[10.5px] font-extrabold opacity-85">🗄 The Family Cupboard</div>
          <div className="font-display text-[18px] font-extrabold mt-0.5">📷 Scan to add</div>
          <div className="text-[11px] opacity-90 mt-0.5">Snap the cover — Kaya reads the name and author. Barcode if you prefer. Names come from the scan, never from typing.</div>
        </div>

        <div className="p-4">
          {confirm ? (
            <ConfirmCard
              item={confirm} shelf={shelf} whoOptions={whoOptions} whoValue={whoValue}
              scope={scope} kidId={kidId} whereKept={whereKept}
              onWho={(v) => { if (v === 'family') setScope('family'); else { setScope('kid'); setKidId(v.slice(4)); } }}
              onWhere={setWhereKept}
              busy={busy}
              onCancel={() => setConfirm(null)}
              onAdd={async (edited) => {
                setBusy(true);
                const r = await addOne(edited);
                setBusy(false);
                if (r.status === 'added') { setConfirm(null); onAdded([r.addedId!]); return; }
                if (r.status === 'dup') { setTray((t) => [r, ...t]); setConfirm(null); return; }
                setConfirm({ ...edited, status: 'error', error: r.error });
              }}
            />
          ) : (
            <>
              {/* tier switch — 📖 cover first (D30′), ▌▌ barcode second, ⌨ type last */}
              <div className="flex gap-1.5 mb-2.5">
                {([['front', '📖 Scan the cover'], ['live', '▌▌ Barcode']] as Array<[Tier, string]>).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setTier(id)}
                    className="text-[10.5px] font-extrabold px-2.5 py-1.5 rounded-full border border-[#E8E0CF]"
                    style={tier === id ? { background: WOOD, color: '#fff', borderColor: WOOD } : { background: '#fff', color: '#5B6B8C' }}>
                    {label}
                  </button>
                ))}
                <button type="button" onClick={onTypeInstead} className="text-[10.5px] font-extrabold px-2.5 py-1.5 rounded-full border border-[#E8E0CF] bg-white text-[#5B6B8C]">⌨ Type it</button>
              </div>

              {/* one viewfinder, two frames */}
              {!camFailed && (
                <div className="relative rounded-[14px] overflow-hidden bg-[#0f1420]" style={{ height: 230 }}>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                  <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    {tier === 'front' ? (
                      <div className="w-[128px] h-[172px] border-2 rounded-[8px]" style={{ borderColor: '#3FA38F', boxShadow: '0 0 18px rgba(63,163,143,.45)' }} />
                    ) : (
                      <div className="w-[220px] h-[96px] border-2 rounded-[8px] relative" style={{ borderColor: '#3FA38F' }}>
                        <div className="absolute left-2 right-2 top-1/2 h-[2px]" style={{ background: '#FF5C5C', boxShadow: '0 0 10px #FF5C5C' }} />
                      </div>
                    )}
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 text-center text-[10.5px] font-extrabold text-white/90 py-1.5 bg-black/30">
                    {tier === 'front' ? (frontBusy ? '🧠 Kaya is reading the cover…' : 'Hold the front of the book in the frame · tap Snap') : camMsg}
                  </div>
                </div>
              )}

              {tier === 'front' && (
                <div className="rounded-[14px] border border-[#D9CCFA] bg-[#EFE8FF] p-3 mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {!camFailed && (
                      <button type="button" disabled={frontBusy || snapping} onClick={snapCover} className="px-4 py-2 rounded-full font-extrabold text-[12.5px] text-white disabled:opacity-50" style={{ background: '#5A3CB8' }}>
                        {frontBusy || snapping ? '🧠 Reading…' : '📖 Snap the cover'}
                      </button>
                    )}
                    <label className="text-[10.5px] font-extrabold px-2.5 py-1.5 rounded-full border border-[#D9CCFA] bg-white cursor-pointer" style={{ color: '#5A3CB8' }}>
                      🖼 {camFailed ? 'Take a photo of the cover' : 'or choose a photo'}
                      <input type="file" accept="image/*" capture="environment" disabled={frontBusy} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFront(f); e.target.value = ''; }} />
                    </label>
                    <div className="ml-auto"><ChoiceChips value={frontKind} onChange={setFrontKind} options={[{ id: 'book', label: '📚 Book' }, { id: 'game', label: '🎲 Game' }, { id: 'any', label: '🤷' }]} tone="jade" /></div>
                  </div>
                  <p className="text-[10.8px] font-bold text-[#5A4A8A] mt-1.5 mb-0 leading-snug">
                    Kaya reads the <b>title + author</b> from the cover (games: title + ages · players · minutes from the box), then looks it up for the cover, pages and <b>what it&rsquo;s about</b>.{pendingCode ? ` Barcode ${pendingCode} will be kept as its identity.` : ''}
                  </p>
                  {frontErr && (
                    <div className="mt-2">
                      <p className="text-[11px] font-bold text-[#C0392B] m-0">{frontErr}</p>
                      <div className="flex gap-2 mt-1.5">
                        <button type="button" onClick={() => setTier('live')} className="text-[11px] font-extrabold" style={{ color: WOOD_DK }}>▌▌ Try the barcode</button>
                        <button type="button" onClick={onTypeInstead} className="text-[11px] font-extrabold" style={{ color: WOOD_DK }}>⌨ Type it (a parent confirms)</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {tier === 'live' && (
                <div className="rounded-[14px] border border-[#E8E0CF] bg-white p-3 mt-2">
                  {camFailed ? (
                    <>
                      <p className="text-[12px] font-extrabold text-[#0F1F44] m-0">🖼 Take a photo of the barcode</p>
                      <p className="text-[10.8px] font-bold text-[#8A8471] mt-0.5 mb-2 leading-snug">{camMsg === 'Starting the camera…' ? 'The live camera isn’t available here — a still photo works the same.' : camMsg}</p>
                      <input type="file" accept="image/*" capture="environment" className="text-[12px]" onChange={(e) => { const f = e.target.files?.[0]; if (f) decodeStill(f); e.target.value = ''; }} />
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[10.8px] font-bold text-[#8A8471] m-0 leading-snug flex-1">Every beep drops into the tray — keep going, confirm all at once.</p>
                      <label className="text-[10.5px] font-extrabold px-2.5 py-1.5 rounded-full border border-[#E8E0CF] bg-white cursor-pointer" style={{ color: WOOD_DK }}>
                        🖼 photo of barcode
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) decodeStill(f); e.target.value = ''; }} />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* the tray (N1) */}
              {tray.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <div className="font-display font-extrabold text-[11px] tracking-[1.2px] text-[#5A6488] uppercase">In the tray · {tray.length}</div>
                    {ready > 0 && <span className="text-[10.5px] font-extrabold text-[#5B6B8C]">{ready} ready</span>}
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {tray.map((it) => <TrayRow key={it.key} it={it} busy={busy}
                      onSame={() => setTray((t) => t.filter((x) => x.key !== it.key))}
                      onSecond={() => addSecondCopy(it.key)}
                      onFront={() => { setPendingCode(it.code); setFrontKind(it.kind); setTier('front'); setTray((t) => t.filter((x) => x.key !== it.key)); }}
                      onType={() => setConfirm({ ...it, status: 'ready', name: '', nameSource: 'manual' })}
                      onEdit={() => setConfirm(it)}
                    />)}
                  </div>
                </div>
              )}

              {/* whose + where — once for the whole tray */}
              {ready > 0 && (
                <div className="mt-3 rounded-[12px] border border-[#E8E0CF] bg-white p-2.5">
                  <Field label="Whose are they?"><ChoiceChips value={whoValue} onChange={(v) => { if (v === 'family') setScope('family'); else { setScope('kid'); setKidId(v.slice(4)); } }} options={whoOptions} /></Field>
                  <Field label="📍 Where they live"><input className={inputCls} value={whereKept} onChange={(e) => setWhereKept(e.target.value)} placeholder="living-room cupboard, top shelf" maxLength={120} /></Field>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                {ready > 0 && (
                  <button type="button" disabled={busy} onClick={confirmAll} className="flex-1 px-4 py-2.5 rounded-full font-extrabold text-[13px] text-white disabled:opacity-50" style={{ background: WOOD }}>
                    {busy ? 'Adding…' : `✓ Confirm all (${ready})`}
                  </button>
                )}
                <button type="button" onClick={close} className="px-3.5 py-2.5 rounded-full font-extrabold text-[12px] bg-[#EEF0F4] text-[#5B6B8C]">{added.length ? 'Done' : 'Close'}</button>
              </div>
              {added.length > 0 && (
                <p className="text-[11px] font-extrabold text-[#2E7D4F] mt-2 m-0">✓ {added.length} added to the Cupboard{added.length === 1 ? ` · ` : ' '}{added.length === 1 && <Link href={`/sparks/treasures/cupboard/${added[0].addedId}`} className="text-[#0E6B5E]">open it →</Link>}</p>
              )}
              <p className="text-[10.5px] text-[#8A8471] italic leading-snug mt-2 mb-0">
                Offline at the shelf? Kaya’s read and the barcode still work; the cover and “what it’s about” come when you’re back online. Kids’ typed titles wait ⚠ for a parent.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── tray row ────────────────────────────────────────────────────────

function TrayRow({ it, busy, onSame, onSecond, onFront, onType, onEdit }: {
  it: TrayItem; busy: boolean;
  onSame: () => void; onSecond: () => void; onFront: () => void; onType: () => void; onEdit: () => void;
}) {
  const tone = it.status === 'added' ? 'border-[#BFE3D8] bg-[#F1FAF7]'
    : it.status === 'dup' || it.status === 'nomatch' ? 'border-[#F3D3A6] bg-[#FFF9EF]'
    : it.status === 'error' ? 'border-[#F0C9CC] bg-[#FEF6F6]'
    : 'border-[#E8E0CF] bg-white';
  return (
    <div className={`rounded-[12px] border p-2.5 ${tone}`}>
      <div className="flex items-center gap-2.5">
        <div className="w-[34px] h-[46px] rounded-[5px] grid place-items-center text-[18px] shrink-0 overflow-hidden" style={{ background: WOOD_BG, border: `1px solid #E4CDB2` }}>
          {it.coverUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={it.coverUrl} alt="" className="w-full h-full object-cover" />
            : <span aria-hidden>{it.status === 'looking' ? '⏳' : it.kind === 'game' ? '🎲' : '📚'}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-extrabold text-[#0F1F44] leading-tight line-clamp-2">
            {it.status === 'looking' && 'Looking it up…'}
            {it.status === 'nomatch' && `⚠ ${it.code} — no match yet`}
            {(it.status === 'ready' || it.status === 'added' || it.status === 'dup' || it.status === 'error') && (it.name || '(no name)')}
          </div>
          <div className="text-[10px] font-bold text-[#5B6B8C] mt-0.5 line-clamp-1">
            {it.status === 'ready' && (it.kind === 'book'
              ? `${it.book?.author || ''}${it.book?.pages ? ` · ${it.book.pages} pages` : ''}${it.nameSource === 'vision' ? ' · read by Kaya' : ' · matched'}${it.book?.summary ? ' · 📖 summary' : ''}`
              : `${[it.game?.ageMin ? `${it.game.ageMin}+` : '', it.game?.playersMin ? `${it.game.playersMin}–${it.game.playersMax || it.game.playersMin}` : '', it.game?.minutes ? `${it.game.minutes} min` : ''].filter(Boolean).join(' · ') || 'game'}${it.nameSource === 'vision' ? ' · read by Kaya' : ''}`)}
            {it.status === 'added' && '✓ added to the Cupboard'}
            {it.status === 'dup' && `⚠ already in the Cupboard — ${it.dupOf?.ownerName ? `${it.dupOf.ownerName}’s copy` : 'the family’s copy'}`}
            {it.status === 'nomatch' && 'The code is its identity — snap the front for the words'}
            {it.status === 'error' && (it.error || 'could not add')}
            {it.status === 'looking' && (it.code || '')}
          </div>
        </div>
        {it.status === 'ready' && <button type="button" onClick={onEdit} className="text-[10.5px] font-extrabold shrink-0" style={{ color: WOOD_DK }}>✏️</button>}
      </div>
      {it.status === 'dup' && (
        <div className="flex gap-2 mt-2">
          {it.dupOf && <Link href={`/sparks/treasures/cupboard/${it.dupOf.id}`} className="px-3 py-1 rounded-full font-extrabold text-[11px] no-underline" style={{ background: WOOD, color: '#fff' }}>Open it</Link>}
          <button type="button" onClick={onSame} className="px-3 py-1 rounded-full font-extrabold text-[11px] bg-[#EEF0F4] text-[#5B6B8C]">Same one</button>
          <button type="button" disabled={busy} onClick={onSecond} className="px-3 py-1 rounded-full font-extrabold text-[11px]" style={{ background: WOOD_BG, color: WOOD_DK }}>Add a 2nd copy</button>
        </div>
      )}
      {it.status === 'nomatch' && (
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={onFront} className="px-3 py-1 rounded-full font-extrabold text-[11px] text-white" style={{ background: '#5A3CB8' }}>📖 Snap the front</button>
          <button type="button" onClick={onType} className="px-3 py-1 rounded-full font-extrabold text-[11px]" style={{ background: WOOD_BG, color: WOOD_DK }}>⌨ Type it ⚠</button>
          <button type="button" onClick={onSame} className="px-3 py-1 rounded-full font-extrabold text-[11px] bg-[#EEF0F4] text-[#5B6B8C]">Remove</button>
        </div>
      )}
    </div>
  );
}

// ── the ONE confirm card (design screen 5 / 11) ─────────────────────

function ConfirmCard({ item, shelf, whoOptions, whoValue, scope, kidId, whereKept, onWho, onWhere, busy, onCancel, onAdd }: {
  item: TrayItem; shelf: CupboardShelf;
  whoOptions: Array<{ id: string; label: string }>; whoValue: string;
  scope: OwnerScope; kidId: string; whereKept: string;
  onWho: (v: string) => void; onWhere: (v: string) => void;
  busy: boolean; onCancel: () => void; onAdd: (edited: TrayItem) => void;
}) {
  const isParent = shelf.me.role === 'parent';
  const [kind, setKind] = useState<CupboardKind>(item.kind);
  const [name, setName] = useState(item.name || '');
  const [author, setAuthor] = useState(item.book?.author || '');
  const [pages, setPages] = useState(item.book?.pages ? String(item.book.pages) : '');
  const [ageMin, setAgeMin] = useState(String(item.book?.ageMin || item.game?.ageMin || ''));
  const [pMin, setPMin] = useState(item.game?.playersMin ? String(item.game.playersMin) : '');
  const [pMax, setPMax] = useState(item.game?.playersMax ? String(item.game.playersMax) : '');
  const [minutes, setMinutes] = useState(item.game?.minutes ? String(item.game.minutes) : '');
  const [gameKind, setGameKind] = useState<GameKind | undefined>(item.game?.gameKind);
  // D43 · "What it's about" — parents may edit; kids read.
  const [summary, setSummary] = useState(item.book?.summary || '');
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const summarySource = item.book?.summarySource;
  const digits = (s: string) => s.replace(/\D/g, '');
  const original = item.name || '';
  // D28 · editing a looked-up / read title turns it into a typed one.
  const nameSource: NameSource = normaliseTitle(name) === normaliseTitle(original) && item.nameSource ? item.nameSource : 'manual';
  const matched = item.nameSource === 'lookup';
  void scope; void kidId;

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="w-[46px] h-[64px] rounded-[6px] grid place-items-center text-[20px] shrink-0 overflow-hidden" style={{ background: 'linear-gradient(135deg,#2E3D5C,#5B6B8C)', color: '#fff' }}>
          {item.coverUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.coverUrl} alt="" className="w-full h-full object-cover" />
            : <span aria-hidden>{kind === 'game' ? '🎲' : '📚'}</span>}
        </div>
        <div className="min-w-0">
          <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">Is this it?</div>
          <div className="text-[10.5px] font-bold text-[#5B6B8C] mt-0.5 leading-snug">
            {matched ? '✅ matched in a library' : item.nameSource === 'vision' ? '🧠 read by Kaya from the front' : '⌨ typed by hand'}
            {item.code ? ` · ${item.code}` : ''}
          </div>
          {nameSource === 'manual' && !isParent && <div className="text-[10.5px] font-extrabold mt-1" style={{ color: '#8A6800' }}>⚠ a parent will confirm the name</div>}
        </div>
      </div>

      <div className="mt-3">
        {!item.name && <Field label="What is it?"><ChoiceChips value={kind} onChange={setKind} options={[{ id: 'book', label: '📚 A book' }, { id: 'game', label: '🎲 A game' }]} /></Field>}
        <Field label={kind === 'book' ? 'Title' : 'Name'}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={kind === 'book' ? 'e.g. Matilda' : 'e.g. Ticket to Ride'} /></Field>
        {kind === 'book' ? (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3"><Field label="Author"><input className={inputCls} value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={120} /></Field></div>
            <Field label="Pages"><input className={inputCls} inputMode="numeric" value={pages} onChange={(e) => setPages(digits(e.target.value))} /></Field>
            <Field label="Good for"><input className={inputCls} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(digits(e.target.value))} placeholder="9+" /></Field>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Field label="Ages"><input className={inputCls} inputMode="numeric" value={ageMin} onChange={(e) => setAgeMin(digits(e.target.value))} placeholder="8+" /></Field>
              <Field label="Players from"><input className={inputCls} inputMode="numeric" value={pMin} onChange={(e) => setPMin(digits(e.target.value))} /></Field>
              <Field label="to"><input className={inputCls} inputMode="numeric" value={pMax} onChange={(e) => setPMax(digits(e.target.value))} /></Field>
              <Field label="Minutes"><input className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(digits(e.target.value))} /></Field>
            </div>
            <Field label="Kind"><ChoiceChips value={gameKind} onChange={setGameKind} options={GAME_KINDS.map((k) => ({ id: k.id, label: `${k.emoji} ${k.label}` }))} /></Field>
          </>
        )}
        <Field label="Whose is it?"><ChoiceChips value={whoValue} onChange={onWho} options={whoOptions} /></Field>
        <Field label="📍 Where it lives"><input className={inputCls} value={whereKept} onChange={(e) => onWhere(e.target.value)} placeholder="living-room cupboard, top shelf" maxLength={120} /></Field>
      </div>

      {kind === 'book' && (summary || item.nameSource !== 'manual') && (
        <div className="rounded-[12px] border border-[#E8E0CF] bg-white p-2.5 mb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-extrabold text-[#0F1F44]">📖 What it&rsquo;s about {summarySource && (
              <span className="ml-1 inline-block text-[9.5px] font-extrabold px-2 py-0.5 rounded-full" style={summarySource === 'kaya' ? { background: '#EFE8FF', color: '#5A3CB8' } : { background: '#EEF0F4', color: '#5B6B8C' }}>
                {summarySource === 'kaya' ? '🧠 Kaya’s words' : summarySource === 'openlibrary' ? 'from Open Library' : summarySource === 'parent' ? 'edited by a parent' : 'from Google Books'}
              </span>)}
            </div>
            <div className="flex gap-2">
              {isParent && summary && <button type="button" onClick={() => setEditingSummary((v) => !v)} className="text-[10.5px] font-extrabold" style={{ color: JADE }}>{editingSummary ? 'Done' : '✏️ edit'}</button>}
              {summary && <button type="button" onClick={() => setSummaryOpen((v) => !v)} className="text-[10.5px] font-extrabold text-[#5B6B8C]">{summaryOpen ? 'hide' : 'show'}</button>}
            </div>
          </div>
          {!summary && <p className="text-[10.5px] text-[#8A8471] italic mt-1 m-0">No summary yet — it arrives with the lookup when you’re online.</p>}
          {summary && summaryOpen && !editingSummary && <p className="text-[11.5px] leading-snug text-[#394458] mt-1 m-0 border-l-[3px] border-[#E4CDB2] pl-2.5">{summary}</p>}
          {summary && editingSummary && <textarea className={`${inputCls} mt-1 min-h-[64px]`} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={600} />}
        </div>
      )}

      {item.status === 'error' && <p className="text-[11.5px] text-[#C0392B] font-bold mt-1">{item.error}</p>}

      <div className="flex gap-2 mt-2">
        <button type="button" disabled={busy || !name.trim()} onClick={() => onAdd({
          ...item, kind, name: name.trim(), nameSource,
          book: kind === 'book' ? { ...(item.book || { name: name.trim() }), name: name.trim(), author: author.trim() || undefined, pages: pages ? Number(pages) : undefined, ageMin: ageMin ? Number(ageMin) : undefined, summary: summary.trim() || undefined, summarySource: summary.trim() ? (summary.trim() !== (item.book?.summary || '').trim() ? 'parent' : summarySource) : undefined } : undefined,
          game: kind === 'game' ? { name: name.trim(), ageMin: ageMin ? Number(ageMin) : undefined, playersMin: pMin ? Number(pMin) : undefined, playersMax: pMax ? Number(pMax) : undefined, minutes: minutes ? Number(minutes) : undefined, gameKind } : undefined,
        })} className="flex-1 px-4 py-2.5 rounded-full font-extrabold text-[13px] text-white disabled:opacity-50" style={{ background: WOOD }}>
          {busy ? 'Adding…' : '✓ Add to the Cupboard'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-full font-extrabold text-[13px]" style={{ background: '#EEF0F4', color: JADE }}>Back</button>
      </div>
    </div>
  );
}
