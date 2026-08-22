'use client';

// ✉️ Card Studio (Reminders 2.0, approved Card Designs v2 — 22-Aug-2026).
// One sheet: live preview → theme + accent → ✨ Kaya Writes → one-liner +
// message → stickers (packs, 🔒 earned) → photo → 🖋️ everyone signs →
// signature → Ready / Let-Kaya-send → share row (📣 Moments · 💬 Chat ·
// 📱 WhatsApp · 📧 Email · 🔗 Link · 📤 Share · 🖼️ Save). Persistence via
// /api/reminders/cards; PNG = SVG→canvas (lib/greetingCards), uploaded on
// save under families/{f}/messages/cards/… (existing storage rule).

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { reservePost, finalizePost, uploadProcessedPhoto, type Post } from '@/lib/moments';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { safeUploadBytes, compressImageBlob } from '@/lib/storageUpload';
import { storage } from '@/lib/firebase';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { toDisplayDate } from '@/lib/dates';
import {
  CARD_THEMES, CARD_ACCENTS, STICKER_PACKS, ONE_LINER_MAX, MESSAGE_MAX, LINE_MAX,
  cardIdFor, cardSvgDataUrl, cardPngBlob, downloadCard, cardHeadline, defaultOneLiner, defaultMessage,
  saveCard, setCardReady, addCardLine, decideCard, setCardImage, setCardPost, ensureCardLink, emailCardNow,
  dropCardInChat, logCardDelivery, cardsApi, kayaWrites, remember, remembered,
  type GreetingCard, type CardTheme, type KayaWritesSuggestion,
} from '@/lib/greetingCards';
import {
  buildSignature, nthFor, displayTitle, typeMeta, type ReminderEvent, type GreetTo,
} from '@/lib/reminders';

const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

export interface StudioTarget {
  event: ReminderEvent;
  dateKey: string;
  /** For auto-imported mirrors (no greetTo on the event) — who is celebrated. */
  honoree?: GreetTo;
}

export default function GreetingCardStudio({ target, initial, onClose, onChanged }: {
  target: StudioTarget;
  initial: GreetingCard | null;
  onClose: () => void;
  onChanged?: (card: GreetingCard | null) => void;
}) {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId || '';
  const role = (profile?.role === 'kid' || profile?.role === 'helper') ? profile.role : 'parent';
  const isParent = role === 'parent';
  const isKid = role === 'kid';
  const ev = target.event;
  const honoree: GreetTo | null = ev.greetTo || target.honoree || null;
  const cardId = cardIdFor(ev.id, target.dateKey);
  const nth = nthFor(ev, target.dateKey);

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [card, setCard] = useState<GreetingCard | null>(initial);
  const [theme, setTheme] = useState<CardTheme>(initial?.theme || ((remembered(`kayaCardTheme:${profile?.uid}`) as CardTheme) || (ev.type === 'anniversary' ? 'night' : 'classic')));
  const [accent, setAccent] = useState<string>(initial?.accent || '');
  const [stickers, setStickers] = useState<string[]>(initial?.stickers || (ev.type === 'birthday' ? ['✨', '🎈'] : ev.type === 'anniversary' ? ['✨'] : ['🎉']));
  const [photoUrl, setPhotoUrl] = useState<string>(initial?.photoUrl || '');
  const [lang, setLang] = useState<'en' | 'sw'>(initial?.lang || 'en');
  const [oneLiner, setOneLiner] = useState(initial?.oneLiner || '');
  const [message, setMessage] = useState(initial?.message || '');
  const [packId, setPackId] = useState(STICKER_PACKS[0].id);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [lineText, setLineText] = useState('');
  const [dirty, setDirty] = useState(false);
  // Kaya Writes
  const kwOn = family?.greetingConfig?.kayaWrites !== false;
  const [voice, setVoice] = useState<'warm' | 'funny' | 'formal'>('warm');
  const [kwLang, setKwLang] = useState<'en' | 'sw' | 'mix'>(initial?.lang === 'sw' ? 'sw' : 'en');
  const [kwLen, setKwLen] = useState<'one' | 'short' | 'long'>('short');
  const [seed, setSeed] = useState('');
  const [sugs, setSugs] = useState<KayaWritesSuggestion[]>([]);
  const [kwBusy, setKwBusy] = useState(false);
  const [kwNote, setKwNote] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!familyId) return;
    getFamilyMembers(familyId).then(setMembers).catch(() => setMembers([]));
  }, [familyId]);

  useEffect(() => { if (theme && profile?.uid) remember(`kayaCardTheme:${profile.uid}`, theme); }, [theme, profile?.uid]);

  // ✨ Kaya Writes — smoother (Elia, 22-Aug): when a fresh card opens blank,
  // Kaya starts writing immediately; first draft can be applied in one tap.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current) return;
    if (!kwOn || !honoree || initial?.oneLiner || oneLiner) return;
    if (!(role === 'parent' || role === 'helper' || role === 'kid')) return;
    autoRan.current = true;
    void write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kwOn, honoree?.name]);

  // Client-side signature preview (server recomputes on save — R9).
  const sigPreview = useMemo(() => {
    if (!honoree) return { line: '' };
    return buildSignature({
      parentNames: members.filter((m) => m.role === 'parent').map((m) => m.displayName),
      familyName: family?.name || '', kidNames: children.map((c) => c.name),
      authorName: card?.authorName || profile?.displayName || '', authorRole: card?.authorRole || role,
      relationship: honoree.relationship, lang, signature: family?.greetingSignature,
    });
  }, [members, family?.name, family?.greetingSignature, children, profile?.displayName, role, honoree, lang, card?.authorName, card?.authorRole]);

  // The card as the renderer sees it right now (draft state over saved card).
  const draft: GreetingCard | null = useMemo(() => {
    if (!honoree) return null;
    const partial = { type: ev.type, nth, lang, honoree };
    return {
      id: cardId, familyId, eventId: ev.id, dateKey: target.dateKey, type: ev.type,
      eventTitle: displayTitle(ev, target.dateKey), nth, honoree,
      theme, ...(accent ? { accent } : {}), stickers, ...(photoUrl ? { photoUrl } : {}),
      oneLiner: oneLiner || defaultOneLiner(partial), message: message || defaultMessage(partial, sigPreview.line),
      lines: card?.lines || [], lang, signatureLine: card?.signatureLine || sigPreview.line, ...(sigPreview.roster ? { signatureRoster: sigPreview.roster } : {}),
      status: card?.status || 'draft', authorUid: card?.authorUid || profile?.uid || '', authorName: card?.authorName || profile?.displayName || '', authorRole: card?.authorRole || role,
      ...(card?.imageUrl ? { imageUrl: card.imageUrl } : {}), ...(card?.publicToken ? { publicToken: card.publicToken } : {}),
      deliveries: card?.deliveries || [], momentsPostId: card?.momentsPostId, thanks: card?.thanks || [],
      createdAt: card?.createdAt || 0, updatedAt: card?.updatedAt || 0,
    } as GreetingCard;
  }, [honoree, ev, nth, lang, cardId, familyId, target.dateKey, theme, accent, stickers, photoUrl, oneLiner, message, sigPreview, card, profile, role]);

  const previewUrl = useMemo(() => (draft ? cardSvgDataUrl(draft) : ''), [draft]);
  const headline = cardHeadline(ev.type, nth, lang, ev.title);
  const external = !!honoree && honoree.relationship !== 'family';
  const myKid = isKid ? children.find((c) => c.id === profile?.childId) : null;
  const myPoints = myKid?.lifetimePoints || myKid?.totalPoints || 0;
  const packUnlocked = (p: typeof STICKER_PACKS[number]) => !p.unlock || isParent || role === 'helper' || myPoints >= p.unlock.points;

  const mark = (k: string, v: unknown) => { void k; void v; setDirty(true); };

  // ── save (+ upload PNG so chat/Moments/email carry an image) ──────────
  async function persist(opts: { silent?: boolean } = {}): Promise<GreetingCard | null> {
    if (!honoree || !familyId) return null;
    setSaving(true);
    try {
      const payload: Partial<GreetingCard> & { eventId: string; dateKey: string } = {
        eventId: ev.id, dateKey: target.dateKey, theme, accent: accent || undefined, stickers, photoUrl: photoUrl || undefined,
        oneLiner: oneLiner.trim(), message: message.trim(), lang,
        ...(ev.id.startsWith('auto:') ? { type: ev.type, eventTitle: displayTitle(ev, target.dateKey), honoree, nth: nth || undefined } : {}),
      };
      const saved = await saveCard(payload);
      setCard(saved); setDirty(false);
      onChanged?.(saved);
      // PNG for delivery — best-effort, async.
      void (async () => {
        try {
          const full = { ...saved, lines: saved.lines || [] };
          const blob = await cardPngBlob(full, { full: true });
          const path = `families/${familyId}/messages/cards/${saved.id}-${Date.now().toString(36)}.png`;
          const r = storageRef(storage, path);
          await safeUploadBytes(r, blob, { contentType: 'image/png' });
          const url = await getDownloadURL(r);
          await setCardImage(saved.id, url);
          setCard((c) => (c ? { ...c, imageUrl: url } : c));
        } catch { /* image is optional */ }
      })();
      if (!opts.silent) setMsg('Saved ✓');
      return saved;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
      return null;
    } finally { setSaving(false); }
  }

  async function ensureSaved(): Promise<GreetingCard | null> {
    if (card && !dirty) return card;
    return persist({ silent: true });
  }

  async function toggleReady() {
    const c = await ensureSaved(); if (!c) return;
    const nextReady = !(c.status === 'ready' || c.status === 'pending_parent' || c.status === 'sent');
    try {
      const r = await setCardReady(c.id, nextReady);
      setCard(r); onChanged?.(r);
      setMsg(r.status === 'pending_parent' ? 'Sent to a parent for a nod 👨‍👩‍👧' : r.status === 'ready' ? 'Ready ✓' : 'Back to draft');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not update'); }
  }

  async function decide(d: 'approve' | 'decline') {
    if (!card) return;
    try { const r = await decideCard(card.id, d); setCard(r); onChanged?.(r); setMsg(d === 'approve' ? 'Approved ✓' : 'Sent back for a tweak'); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not decide'); }
  }

  async function addLine() {
    const text = lineText.trim(); if (!text) return;
    const c = await ensureSaved(); if (!c) return;
    try { const r = await addCardLine(c.id, text); setCard(r); setLineText(''); onChanged?.(r); setMsg('Signed 🖋️'); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not add'); }
  }

  async function pickPhoto(f: File | null) {
    if (!f || !familyId) return;
    setBusy('photo');
    try {
      const blob = await compressImageBlob(f, { maxDim: 900, quality: 0.85 });
      const path = `families/${familyId}/messages/cards/${cardId}-photo-${Date.now().toString(36)}.jpg`;
      const r = storageRef(storage, path);
      await safeUploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
      setPhotoUrl(await getDownloadURL(r)); setDirty(true);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not upload'); }
    finally { setBusy(null); }
  }

  async function write(refine?: string) {
    if (!honoree) return;
    setKwBusy(true); setKwNote('');
    try {
      const r = await kayaWrites({
        eventId: ev.id, dateKey: target.dateKey, voice, lang: kwLang, length: kwLen,
        ...(refine ? { refine } : {}), ...(seed.trim() ? { seed: seed.trim() } : {}),
        ...(ev.id.startsWith('auto:') ? { eventTitle: displayTitle(ev, target.dateKey), honoree, nth, type: ev.type } as unknown as Record<string, unknown> : {}),
      } as unknown as Parameters<typeof kayaWrites>[0]);
      if (r.skipped) { setKwNote(r.reason === 'off' ? 'Kaya Writes is off for your family (Settings → ✉️ Greeting cards).' : 'Kaya Writes isn’t available right now — write your own below.'); setSugs([]); }
      else setSugs(r.suggestions || []);
    } catch (e) { setKwNote(e instanceof Error ? e.message : 'Kaya couldn’t write just now'); }
    finally { setKwBusy(false); }
  }

  async function writeAndApply() {
    await write();
  }
  useEffect(() => {
    // One-tap: if the user hasn't typed anything yet, the first suggestion lands in the fields automatically.
    if (sugs.length && !oneLiner && !message && !dirty) useSuggestion(sugs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugs]);

  function useSuggestion(s: KayaWritesSuggestion) {
    setOneLiner(s.oneLiner.slice(0, ONE_LINER_MAX));
    if (kwLen !== 'one') setMessage(s.message.slice(0, MESSAGE_MAX));
    if (kwLang === 'sw') setLang('sw'); else if (kwLang === 'en') setLang('en');
    setDirty(true); setMsg('Using Kaya’s draft — edit freely');
  }

  // ── share row ─────────────────────────────────────────────────────────
  async function act(key: string, fn: (c: GreetingCard) => Promise<string>) {
    if (busy) return;
    setBusy(key); setMsg('');
    try {
      const c = await ensureSaved(); if (!c) throw new Error('Save the card first');
      const full = { ...c, lines: c.lines || [] };
      setMsg(await fn(full));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(null); }
  }

  const toMoments = () => act('moments', async (c) => {
    if (!profile) throw new Error('Sign in');
    const blob = await cardPngBlob(c, { full: true });
    const file = new File([blob], `card-${c.id}.png`, { type: 'image/png' });
    const processed = await processPhotoForUpload(file);
    const postId = await reservePost(familyId, profile.uid);
    const photo = await uploadProcessedPhoto(familyId, postId, processed);
    const kidTags = c.honoree.childId ? [c.honoree.childId] : (isKid && profile.childId ? [profile.childId] : []);
    const postData: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'> = {
      authorUid: profile.uid, authorName: profile.displayName, authorAvatar: profile.avatarPhoto,
      caption: `✉️ ${headline}, ${c.honoree.name}! “${c.oneLiner}” — ${c.signatureLine}`,
      photos: [photo], kidTags, mentionedUids: [], visibility: 'family',
    };
    await finalizePost(familyId, postId, postData);
    await setCardPost(c.id, postId).catch(() => {});
    setCard((x) => (x ? { ...x, momentsPostId: postId } : x));
    return 'Posted to Moments 📣';
  });

  const toChat = () => act('chat', async (c) => { await dropCardInChat(c.id); return 'Dropped in family chat 💬'; });

  const toWhatsapp = () => act('whatsapp', async (c) => {
    const r = await cardsApi<{ text: string; url: string; phone: string | null }>('whatsapp-text', { id: c.id });
    const link = r.phone ? `https://wa.me/${r.phone}?text=${encodeURIComponent(r.text)}` : `https://wa.me/?text=${encodeURIComponent(r.text)}`;
    window.open(link, '_blank', 'noopener,noreferrer');
    await logCardDelivery(c.id, 'whatsapp', r.phone || undefined).catch(() => {});
    return r.phone ? 'WhatsApp opened — tap send 📱' : 'WhatsApp opened — pick the chat 📱';
  });

  const toEmail = () => act('email', async (c) => { const r = await emailCardNow(c.id); return `Emailed to ${r.to[0]}${r.to.length > 1 ? ` (+${r.to.length - 1} in copy)` : ''} 📧`; });

  const copyLink = () => act('link', async (c) => {
    const r = await ensureCardLink(c.id);
    await navigator.clipboard?.writeText(r.url);
    setCard((x) => (x ? { ...x, publicToken: r.token } : x));
    await logCardDelivery(c.id, 'link').catch(() => {});
    return 'Link copied 🔗 · valid 90 days';
  });

  const share = () => act('share', async (c) => {
    const blob = await cardPngBlob(c, { full: true });
    const file = new File([blob], `Kaya-Card-${c.honoree.name}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({ files: [file], title: `${headline} — ${c.honoree.name}` }).catch((e) => { if ((e as Error)?.name === 'AbortError') return; throw e; });
      await logCardDelivery(c.id, 'share').catch(() => {});
      return 'Shared 📤';
    }
    await downloadCard(c); return 'Saved as picture 🖼️';
  });

  const save = () => act('download', async (c) => { await downloadCard(c); await logCardDelivery(c.id, 'download').catch(() => {}); return 'Saved as picture 🖼️'; });

  if (!honoree || !draft) {
    return (
      <Sheet onClose={onClose} title="✉️ Greeting card">
        <div className="text-sm text-kaya-sand">Pick who’s being celebrated on the reminder first (edit → “Who’s being celebrated?”).</div>
      </Sheet>
    );
  }

  const status = card?.status || 'draft';
  const statusLabel = status === 'sent' ? '✅ Sent' : status === 'belated' ? '✅ Sent (belated)' : status === 'ready' ? '✓ Ready' : status === 'pending_parent' ? '⏳ Awaiting a parent' : '✏️ Draft';
  const pack = STICKER_PACKS.find((p) => p.id === packId) || STICKER_PACKS[0];
  const canEdit = !card || isParent || card.authorUid === profile?.uid;
  const chip = (on: boolean, label: string, onClick: () => void, key?: string) => (
    <button key={key || label} type="button" onClick={onClick}
      className="rounded-full px-3 py-1.5 text-[12px] font-extrabold border"
      style={on ? { background: CAL, borderColor: CAL, color: '#fff' } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>{label}</button>
  );

  return (
    <Sheet onClose={onClose} title={`✉️ ${headline} — ${honoree.name}`} sub={`${typeMeta(ev.type).icon} ${toDisplayDate(target.dateKey)} · ${statusLabel}`}>
      {/* Preview */}
      <div className="flex justify-center mb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="Card preview" className="w-[220px] rounded-2xl shadow-lg border border-kaya-warm-dark" />
      </div>

      {/* Theme + accent */}
      <Block label="Theme">
        <div className="flex flex-wrap gap-1.5">
          {CARD_THEMES.map((t) => chip(theme === t.id, `${t.emoji} ${t.label}`, () => { setTheme(t.id); mark('theme', t.id); }, t.id))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand">Accent</span>
          <button type="button" onClick={() => { setAccent(''); mark('accent', ''); }} className="w-6 h-6 rounded-full border-2 text-[10px] font-black" style={{ borderColor: accent ? '#E8DEC9' : CAL, color: CAL }}>A</button>
          {CARD_ACCENTS.map((c) => (
            <button key={c} type="button" onClick={() => { setAccent(c); mark('accent', c); }} className="w-6 h-6 rounded-full border-2" style={{ background: c, borderColor: accent === c ? '#1F2D3D' : '#fff', boxShadow: '0 0 0 1px #E8DEC9' }} aria-label={c} />
          ))}
        </div>
      </Block>

      {/* Kaya Writes */}
      {kwOn && canEdit && (
        <Block label="✨ Kaya Writes — one-liner + message">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {(['warm', 'funny', 'formal'] as const).map((v) => chip(voice === v, v[0].toUpperCase() + v.slice(1), () => setVoice(v), `v-${v}`))}
            <span className="w-px bg-kaya-warm-dark mx-1" />
            {([['en', 'English'], ['sw', 'Kiswahili'], ['mix', 'Mix']] as const).map(([k, l]) => chip(kwLang === k, l, () => setKwLang(k), `l-${k}`))}
            <span className="w-px bg-kaya-warm-dark mx-1" />
            {([['one', 'One-liner'], ['short', '+ short'], ['long', '+ long']] as const).map(([k, l]) => chip(kwLen === k, l, () => setKwLen(k), `n-${k}`))}
          </div>
          <div className="flex gap-2">
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder={isKid ? 'What do you want to say? Kaya shapes YOUR words' : 'Optional: a memory or a thing to mention'} maxLength={300}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void writeAndApply(); } }}
              className="flex-1 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate" />
            <button type="button" onClick={() => writeAndApply()} disabled={kwBusy} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>{kwBusy ? '✨ Writing…' : sugs.length ? '🔄 Write again' : '✨ Write for me'}</button>
          </div>
          {kwBusy && (
            <div className="space-y-2 mt-2" aria-live="polite">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 animate-pulse">
                  <div className="h-2.5 w-20 rounded bg-kaya-warm mb-2" /><div className="h-3.5 w-3/4 rounded bg-kaya-warm mb-1.5" /><div className="h-3 w-full rounded bg-kaya-warm" />
                </div>
              ))}
              <div className="text-[11px] text-kaya-sand">Kaya is writing three {voice} drafts{seed.trim() ? ' around your words' : ''}…</div>
            </div>
          )}
          {kwNote && <div className="text-[11px] text-red-600 font-bold mt-1.5">{kwNote} <button type="button" onClick={() => write()} className="underline">Try again</button></div>}
          {sugs.length > 0 && !kwBusy && (
            <div className="space-y-2 mt-2">
              {sugs.map((s, i) => (
                <div key={i} className="rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 relative">
                  <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: CAL_DK }}>{s.voice} · {i + 1}</div>
                  <div className="font-display italic font-extrabold text-[14px] text-kaya-chocolate pr-14">“{s.oneLiner}”</div>
                  {kwLen !== 'one' && <div className="text-[12.5px] text-kaya-chocolate mt-1 pr-14">{s.message}</div>}
                  <button type="button" onClick={() => useSuggestion(s)} className="absolute top-2 right-2 rounded-kaya-sm px-2.5 py-1 text-[11px] font-extrabold" style={oneLiner === s.oneLiner ? { background: '#2E7D34', color: '#fff' } : { background: CAL, color: '#fff' }}>{oneLiner === s.oneLiner ? '✓ Using' : 'Use'}</button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {['Shorter', 'Warmer', 'Funnier', 'Add a memory', 'More Swahili', '🔄 Another 3'].map((r) => (
                  <button key={r} type="button" disabled={kwBusy} onClick={() => write(r === '🔄 Another 3' ? 'different angle' : r)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: CAL_SOFT, color: CAL_DK }}>{r}</button>
                ))}
              </div>
            </div>
          )}
        </Block>
      )}

      {/* One-liner + message */}
      <Block label={`The one-liner (front) · ${oneLiner.length}/${ONE_LINER_MAX}`}>
        <input value={oneLiner} onChange={(e) => { setOneLiner(e.target.value.slice(0, ONE_LINER_MAX)); mark('ol', 1); }} disabled={!canEdit}
          placeholder={defaultOneLiner({ type: ev.type, nth, lang, honoree })}
          className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-bold italic text-kaya-chocolate" />
        <div className="text-[10.5px] text-kaya-sand mt-1">One true line makes it theirs. Leave blank and Kaya uses a gentle default.</div>
      </Block>
      <Block label={`Message (inside) · ${message.length}/${MESSAGE_MAX}`}>
        <textarea value={message} onChange={(e) => { setMessage(e.target.value.slice(0, MESSAGE_MAX)); mark('msg', 1); }} disabled={!canEdit} rows={4}
          placeholder={defaultMessage({ type: ev.type, nth, lang, honoree }, sigPreview.line)}
          className="w-full rounded-kaya border border-kaya-warm-dark bg-white px-3 py-2.5 text-sm font-medium text-kaya-chocolate" />
        <div className="flex gap-1.5 mt-1.5 items-center">
          <span className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand">Card language</span>
          {chip(lang === 'en', 'English', () => { setLang('en'); mark('lang', 1); }, 'cl-en')}
          {chip(lang === 'sw', 'Kiswahili', () => { setLang('sw'); mark('lang', 1); }, 'cl-sw')}
        </div>
      </Block>

      {/* Stickers */}
      <Block label={`Stickers · ${stickers.length}/6`}>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {STICKER_PACKS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPackId(p.id)}
              className="rounded-full px-2.5 py-1 text-[11px] font-extrabold border"
              style={packId === p.id ? { background: CAL_SOFT, borderColor: CAL, color: CAL_DK } : { background: '#fff', borderColor: '#E8DEC9', color: '#5C6975' }}>
              {packUnlocked(p) ? '' : '🔒 '}{p.label}
            </button>
          ))}
        </div>
        {packUnlocked(pack) ? (
          <div className="flex flex-wrap gap-1.5">
            {pack.stickers.map((s) => (
              <button key={s} type="button" disabled={!canEdit} onClick={() => { if (stickers.includes(s)) setStickers(stickers.filter((x) => x !== s)); else if (stickers.length < 6) setStickers([...stickers, s]); mark('stk', 1); }}
                className="w-10 h-10 rounded-kaya-sm border text-xl" style={stickers.includes(s) ? { borderColor: CAL, background: CAL_SOFT } : { borderColor: '#E8DEC9', background: '#fff' }}>{s}</button>
            ))}
          </div>
        ) : (
          <div className="text-[11.5px] text-kaya-sand rounded-kaya border border-dashed border-kaya-warm-dark px-3 py-2">🔒 {pack.label} pack unlocks at {pack.unlock?.points} lifetime points ({myPoints} so far) — keep shining!</div>
        )}
        {stickers.length > 0 && <div className="text-[10.5px] text-kaya-sand mt-1">On the card: {stickers.join(' ')} · tap to remove</div>}
      </Block>

      {/* Photo */}
      <Block label="Photo (optional)">
        <div className="flex items-center gap-2">
          {photoUrl && <img src={photoUrl} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0] || null)} />
          <button type="button" disabled={busy === 'photo' || !canEdit} onClick={() => fileRef.current?.click()} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold bg-white border border-kaya-warm-dark text-kaya-chocolate disabled:opacity-60">{busy === 'photo' ? 'Uploading…' : photoUrl ? 'Change photo' : '📷 Add a photo'}</button>
          {photoUrl && <button type="button" onClick={() => { setPhotoUrl(''); mark('photo', 1); }} className="text-xs font-bold text-kaya-sand">Remove</button>}
        </div>
      </Block>

      {/* Everyone signs */}
      <Block label="🖋️ Everyone signs">
        {(card?.lines || []).length > 0 && (
          <div className="space-y-1.5 mb-2">
            {(card?.lines || []).map((l, i) => (
              <div key={i} className="flex gap-2 text-[12.5px]">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0" style={{ background: l.kid ? '#FFF4E0' : CAL_SOFT, color: l.kid ? '#B8860B' : CAL_DK }}>{(l.name || '?')[0]}</span>
                <div><div className="text-[11px] font-extrabold text-kaya-sand">{l.name}</div><div className={l.kid ? 'italic font-bold text-[#6b4a1a]' : 'text-kaya-chocolate'}>{l.text}</div></div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={lineText} onChange={(e) => setLineText(e.target.value.slice(0, LINE_MAX))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
            placeholder={isKid ? 'Your line, in your words…' : 'Add your line…'} className="flex-1 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate" />
          <button type="button" onClick={addLine} disabled={!lineText.trim() || saving} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>Sign</button>
        </div>
        <div className="text-[10.5px] text-kaya-sand mt-1">Anyone in the family can add a line. Kids’ lines print in their own warm style.</div>
      </Block>

      {/* Signature + status */}
      <div className="rounded-kaya border border-dashed px-3 py-2.5 mb-3" style={{ borderColor: CAL, background: CAL_SOFT }}>
        <div className="text-[10px] font-extrabold uppercase tracking-wide" style={{ color: CAL_DK }}>Signs as</div>
        <div className="font-display italic font-extrabold text-[15px] text-kaya-chocolate">{card?.signatureLine || sigPreview.line}</div>
        {(card?.signatureRoster || sigPreview.roster) && <div className="text-[11px] text-kaya-sand">{card?.signatureRoster || sigPreview.roster}</div>}
        <div className="text-[11px] text-kaya-sand mt-1.5">
          {external
            ? (honoree.autoSend && honoree.email
              ? `✨ Kaya sends it at 07:00 on ${toDisplayDate(target.dateKey)} to ${honoree.email}${honoree.ccParents ? ', parents in copy' : ''} — unless you share it first.`
              : honoree.whatsapp ? `On the day Kaya prompts you to tap-send on WhatsApp (${'+' + honoree.whatsapp}).` : 'No auto-send — share it yourself below.')
            : 'In the family: this card goes to family chat + Moments (and the birthday wishes). No separate email.'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" onClick={() => persist()} disabled={saving || !canEdit} className="rounded-kaya px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>{saving ? 'Saving…' : dirty || !card ? 'Save card' : 'Saved ✓'}</button>
        {card && canEdit && (status === 'sent' || status === 'belated') && (
          <span className="text-[11px] text-kaya-sand">Already sent — edits update the link + email; re-share the picture for WhatsApp.</span>
        )}
        {card && canEdit && status !== 'sent' && status !== 'belated' && (
          <button type="button" onClick={toggleReady} className="rounded-kaya px-4 py-2.5 text-sm font-extrabold bg-white border" style={{ borderColor: CAL, color: CAL_DK }}>
            {status === 'ready' ? '↩ Back to draft' : status === 'pending_parent' ? '⏳ Awaiting parent' : (!isParent && external ? '📨 Send to a parent' : '✓ Mark ready')}
          </button>
        )}
        {card && isParent && status === 'pending_parent' && (
          <>
            <button type="button" onClick={() => decide('approve')} className="rounded-kaya px-3 py-2.5 text-sm font-extrabold text-white" style={{ background: '#2E7D34' }}>✅ Approve</button>
            <button type="button" onClick={() => decide('decline')} className="rounded-kaya px-3 py-2.5 text-sm font-bold text-kaya-sand bg-white border border-kaya-warm-dark">✏️ Send back</button>
          </>
        )}
        {card?.momentsPostId && <Link href="/moments" className="text-[12px] font-extrabold" style={{ color: CAL_DK }}>📣 In Moments →</Link>}
      </div>

      {/* Share row */}
      <Block label="Share it">
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
          <ShareBtn k="moments" busy={busy} onClick={toMoments} bg="#D4A017" label="📣 Moments" />
          <ShareBtn k="chat" busy={busy} onClick={toChat} bg="#6B3FE0" label="💬 Chat" />
          {!isKid && external && <ShareBtn k="whatsapp" busy={busy} onClick={toWhatsapp} bg="#25D366" label="📱 WhatsApp" />}
          {!isKid && external && <ShareBtn k="email" busy={busy} onClick={toEmail} bg="#D2691E" label="📧 Email" disabled={status === 'pending_parent' && !isParent} />}
          <ShareBtn k="link" busy={busy} onClick={copyLink} bg="#3E4DA0" label="🔗 Link" />
          <ShareBtn k="share" busy={busy} onClick={share} bg="#11A08A" label="📤 Share" />
          <ShareBtn k="download" busy={busy} onClick={save} bg="#fff" fg="#1F2D3D" border label="🖼️ Save" />
        </div>
        {isKid && external && <div className="text-[10.5px] text-kaya-sand mt-1.5">Cards to people outside the family are sent by a parent — tap “📨 Send to a parent” when you’re happy with it.</div>}
        {(card?.deliveries || []).length > 0 && (
          <div className="text-[10.5px] text-kaya-sand mt-1.5">
            {(card?.deliveries || []).slice(-4).map((d, i) => <span key={i} className="mr-2">{d.ok ? '✓' : '✗'} {d.channel}{d.to ? ` → ${d.to}` : ''}</span>)}
          </div>
        )}
      </Block>

      {msg && <div className="text-[12.5px] font-bold text-center mt-1" style={{ color: CAL_DK }}>{msg}</div>}
    </Sheet>
  );
}

function ShareBtn({ k, busy, onClick, bg, fg, border, label, disabled }: { k: string; busy: string | null; onClick: () => void; bg: string; fg?: string; border?: boolean; label: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={!!busy || disabled}
      className={`rounded-kaya-sm px-2 py-2 text-[11px] font-black leading-tight disabled:opacity-60 ${border ? 'border border-kaya-warm-dark' : ''}`}
      style={{ background: bg, color: fg || '#fff' }}>
      {busy === k ? '…' : label}
    </button>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-kaya-cream w-full sm:max-w-xl lg:max-w-2xl rounded-t-kaya-lg sm:rounded-kaya-lg max-h-[94vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="sticky top-0 bg-kaya-cream border-b border-kaya-warm-dark px-4 py-3 flex items-center justify-between z-10">
          <div className="min-w-0">
            <div className="font-display font-extrabold text-kaya-chocolate truncate">{title}</div>
            {sub && <div className="text-[11px] text-kaya-sand truncate">{sub}</div>}
          </div>
          <button onClick={onClose} className="text-kaya-sand text-xl leading-none px-2">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
