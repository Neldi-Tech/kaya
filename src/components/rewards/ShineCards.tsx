'use client';

// 🌟 Shine Cards UI (RR PR-2) — the post-award sheet (theme picker +
// Post to Moments / Drop into chat / Save picture) and the Shine Wall
// (a kid's collected cards; flip side carries 📝 notes + 💌 the kid's
// thank-you echo). Persistence via the /api/recognition gateway; the
// PNG pipeline is self-contained SVG → canvas (lib/shineCards).

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  type ShineCard, type ShineTheme, SHINE_THEMES,
  shineCardSvg, shineCardPngBlob, downloadShineCard,
  setShineCardTheme, addShineCardNote, sendShineCardEcho, listShineCards,
  rememberTheme,
} from '@/lib/shineCards';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { reservePost, finalizePost, uploadProcessedPhoto, type Post } from '@/lib/moments';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { ensureDirectThread, sendMessage, type ThreadMember } from '@/lib/messaging';
import { safeUploadBytes } from '@/lib/storageUpload';
import { storage } from '@/lib/firebase';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';

const svgDataUrl = (card: ShineCard) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(shineCardSvg(card))}`;

// ── Shared share row (HD PR-B) — the SAME four actions everywhere a
// card renders: 📣 Moments · 💬 kid's chat · 📤 device share · 🖼️ save.
export function CardShareRow({ familyId, card, compact = false }: {
  familyId: string;
  card: ShineCard;
  compact?: boolean;
}) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const isAdult = profile?.role === 'parent' || profile?.role === 'helper';

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(key); setMsg('');
    try { await fn(); setMsg(done); } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That did not work — try again.');
    }
    setBusy(null);
  };

  const postToMoments = () => act('moments', async () => {
    if (!profile) throw new Error('Not signed in.');
    const blob = await shineCardPngBlob(card);
    const file = new File([blob], `shine-${card.n}.png`, { type: 'image/png' });
    const processed = await processPhotoForUpload(file);
    const postId = await reservePost(familyId, profile.uid);
    const photo = await uploadProcessedPhoto(familyId, postId, processed);
    const postData: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'> = {
      authorUid: profile.uid,
      authorName: profile.displayName,
      authorAvatar: profile.avatarPhoto,
      caption: `🌟 Shine Card №${card.n} — ${card.kidName}. ${card.quote}`,
      photos: [photo],
      kidTags: [card.kidId],
      mentionedUids: [],
      visibility: 'family',
    };
    await finalizePost(familyId, postId, postData);
  }, '📣 Posted to Moments!');

  const dropIntoChat = () => act('chat', async () => {
    if (!profile) throw new Error('Not signed in.');
    const members = await getFamilyMembers(familyId);
    const kidLogin = members.find((m: UserProfile) => m.childId === card.kidId);
    if (!kidLogin) throw new Error(`${card.kidName} has no Kaya login yet — post to Moments instead.`);
    const me: ThreadMember = { uid: profile.uid, name: profile.displayName, role: profile.role, avatar: profile.avatarPhoto };
    const them: ThreadMember = { uid: kidLogin.uid, name: kidLogin.displayName, role: 'kid', avatar: kidLogin.avatarPhoto };
    const threadId = await ensureDirectThread(familyId, me, them);
    const blob = await shineCardPngBlob(card);
    const path = `families/${familyId}/messages/${threadId}/shine-${card.n}-${Date.now().toString(36)}.png`;
    const r = storageRef(storage, path);
    await safeUploadBytes(r, blob, { contentType: 'image/png' });
    const url = await getDownloadURL(r);
    await sendMessage(familyId, threadId, {
      text: `🌟 Shine Card №${card.n} — for you, ${card.kidName.split(' ')[0]}!`,
      attachments: [{ kind: 'photo', url, mime: 'image/png' }],
    }, me);
  }, `💬 Dropped into ${card.kidName.split(' ')[0]}'s chat!`);

  const deviceShare = () => act('share', async () => {
    const blob = await shineCardPngBlob(card);
    const file = new File([blob], `Kaya-ShineCard-${card.n}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({ files: [file], title: `🌟 Shine Card №${card.n} — ${card.kidName}` }).catch((e) => {
        if ((e as Error)?.name === 'AbortError') return; // user closed the sheet
        throw e;
      });
    } else {
      await downloadShineCard(card); // no share sheet on this device — save instead
    }
  }, '📤 Shared!');

  const savePicture = () => act('save', () => downloadShineCard(card), '🖼️ Saved!');

  if (!isAdult) return null;
  const btn = (extra: string) =>
    `${compact ? 'h-9 text-[10.5px]' : 'h-10 text-[11.5px]'} rounded-kaya-sm font-black disabled:opacity-50 ${extra}`;
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5 mt-3">
        <button onClick={postToMoments} disabled={!!busy} className={btn('bg-kaya-gold text-white')}>
          {busy === 'moments' ? '…' : '📣 Moments'}
        </button>
        <button onClick={dropIntoChat} disabled={!!busy} className={btn('text-white')} style={{ background: '#6B3FE0' }}>
          {busy === 'chat' ? '…' : '💬 Their chat'}
        </button>
        <button onClick={deviceShare} disabled={!!busy} className={btn('text-white')} style={{ background: '#11A08A' }}>
          {busy === 'share' ? '…' : '📤 Share'}
        </button>
        <button onClick={savePicture} disabled={!!busy} className={btn('border border-kaya-warm-dark text-kaya-sand')}>
          {busy === 'save' ? '…' : '🖼️ Save'}
        </button>
      </div>
      {msg && <p className="text-[12px] font-bold text-center mt-2">{msg}</p>}
    </div>
  );
}

// ── Post-award sheet ──────────────────────────────────────────────

export function ShineCardSheet({ familyId, cards, onClose, onThemeChange }: {
  familyId: string;
  cards: ShineCard[];
  onClose: () => void;
  onThemeChange: (cardId: string, theme: ShineTheme) => void;
}) {
  const { profile } = useAuth();
  const [idx, setIdx] = useState(0);
  const card = cards[idx];

  if (!card) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-kaya-lg sm:rounded-kaya-lg p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <p className="font-display font-black text-[15px] flex-1">🌟 Shine Card №{card.n}{card.doubleShine ? ' · 🤝 Double Shine!' : ''}</p>
          {cards.length > 1 && (
            <span className="text-[11px] font-bold text-kaya-sand">
              <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="px-1.5 disabled:opacity-30">‹</button>
              {idx + 1}/{cards.length}
              <button onClick={() => setIdx((i) => Math.min(cards.length - 1, i + 1))} disabled={idx === cards.length - 1} className="px-1.5 disabled:opacity-30">›</button>
            </span>
          )}
          <button onClick={onClose} className="text-kaya-sand font-black text-lg leading-none px-1">×</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgDataUrl(card)} alt={`Shine Card ${card.n} for ${card.kidName}`} className="w-full rounded-kaya border border-kaya-warm-dark/50" />
        <div className="flex gap-1.5 flex-wrap mt-3">
          {SHINE_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                onThemeChange(card.id, t.id);
                if (profile) rememberTheme(profile.uid, t.id);
                void setShineCardTheme(familyId, card.id, t.id).catch(() => {});
              }}
              className={`px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold border ${card.theme === t.id ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}
            >{t.emoji} {t.label}</button>
          ))}
        </div>
        <CardShareRow familyId={familyId} card={card} />
        <p className="text-[10.5px] text-kaya-sand text-center mt-2">The card is already on {card.kidName.split(' ')[0]}&apos;s Shine Wall — these are extra places to share it.</p>
      </div>
    </div>
  );
}

// ── Shine Wall ────────────────────────────────────────────────────

const ECHO_OPTIONS = ['🥹', '💪', '❤️'];

export function ShineWall({ familyId, childId, childName }: {
  familyId: string;
  childId: string;
  childName: string;
}) {
  const { profile } = useAuth();
  const [cards, setCards] = useState<ShineCard[]>([]);
  const [openCard, setOpenCard] = useState<ShineCard | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [echoText, setEchoText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 📖 RR PR-4 — yearly Shine Book state.
  const [albumOpen, setAlbumOpen] = useState(false);
  const [albumYear, setAlbumYear] = useState(() => new Date().getFullYear());
  const albumYears = useMemo(() => {
    const ys = new Set(cards.map((c) => new Date(c.at).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [cards]);
  const albumCards = useMemo(
    () => cards.filter((c) => new Date(c.at).getFullYear() === albumYear).sort((a, b) => a.n - b.n),
    [cards, albumYear],
  );
  const printAlbum = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const imgs = albumCards.map((c) => `<img src="${svgDataUrl(c)}" style="width:330px;margin:10px;page-break-inside:avoid" alt="Shine Card ${c.n}"/>`).join('');
    w.document.write(`<html><head><title>Shine Book ${albumYear} — ${childName}</title></head>
      <body style="font-family:Georgia,serif;text-align:center;background:#FDFBF7">
      <h1 style="font-size:26px;color:#1E120B;margin:24px 0 2px">📖 ${childName.split(' ')[0]}'s Shine Book ${albumYear}</h1>
      <p style="color:#9B8A72;font-size:13px;margin:0 0 14px">${albumCards.length} moments this family stopped to say "we see you"</p>
      ${imgs}<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  const isAdult = profile?.role === 'parent' || profile?.role === 'helper';
  const isKidOwner = profile?.role === 'kid' && profile?.childId === childId;

  const load = useMemo(() => async () => {
    try { setCards(await listShineCards(familyId, childId)); } catch { setCards([]); }
    setLoaded(true);
  }, [familyId, childId]);
  useEffect(() => { void load(); }, [load]);

  if (loaded && cards.length === 0) return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2.5">
        🌟 {childName.split(' ')[0]}&apos;s Shine Wall · {cards.length} card{cards.length === 1 ? '' : 's'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {cards.slice(0, 12).map((c) => (
          <button key={c.id} onClick={() => { setOpenCard(c); setFlipped(false); setNoteText(''); setEchoText(''); }} className="text-left group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUrl(c)} alt={`Shine Card ${c.n}`} className="w-full rounded-kaya-sm border border-kaya-warm-dark/40 group-hover:border-kaya-gold transition-colors" />
            <p className="text-[10px] font-bold text-kaya-sand mt-1">№{c.n}{c.doubleShine ? ' · 🤝' : ''}{c.echo ? ` · ${c.echo.reaction}` : ''}{(c.notes?.length || 0) > 0 ? ' · 📝' : ''}</p>
          </button>
        ))}
      </div>
      {/* 📖 RR PR-4 — the yearly Shine Book. */}
      <div className="flex items-center gap-2 mt-3">
        <button type="button" onClick={() => setAlbumOpen(true)}
          className="h-9 px-3.5 rounded-kaya-sm bg-kaya-warm text-kaya-chocolate text-[11.5px] font-black hover:bg-kaya-warm-dark">
          📖 Open the Shine Book
        </button>
        {cards.length > 12 && <span className="text-[10.5px] text-kaya-sand">…{cards.length - 12} more card{cards.length - 12 === 1 ? '' : 's'} live in the book.</span>}
      </div>

      {albumOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-6" onClick={() => setAlbumOpen(false)}>
          <div className="bg-white w-full max-w-3xl rounded-kaya-lg p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <p className="font-display font-black text-[15px] flex-1">📖 {childName.split(' ')[0]}&apos;s Shine Book</p>
              {albumYears.map((y) => (
                <button key={y} type="button" onClick={() => setAlbumYear(y)}
                  className={`px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border ${albumYear === y ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>{y}</button>
              ))}
              <button type="button" onClick={() => printAlbum()}
                className="h-8 px-3 rounded-kaya-sm bg-kaya-gold text-white text-[11px] font-black">🖨️ Print keepsake</button>
              <button type="button" onClick={() => setAlbumOpen(false)} className="text-kaya-sand font-black text-lg leading-none px-1">×</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {albumCards.map((c) => (
                <div key={c.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={svgDataUrl(c)} alt={`Shine Card ${c.n}`} className="w-full rounded-kaya-sm border border-kaya-warm-dark/40" />
                  <p className="text-[10px] font-bold text-kaya-sand mt-1">№{c.n} · {new Date(c.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{c.doubleShine ? ' · 🤝' : ''}{c.echo ? ` · ${c.echo.reaction}` : ''}</p>
                </div>
              ))}
              {albumCards.length === 0 && <p className="text-[12px] text-kaya-sand col-span-full">No cards in {albumYear} yet — the book fills as the year shines.</p>}
            </div>
          </div>
        </div>
      )}

      {openCard && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setOpenCard(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-kaya-lg sm:rounded-kaya-lg p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <p className="font-display font-black text-[15px] flex-1">🌟 №{openCard.n}{openCard.doubleShine ? ' · 🤝 Double Shine' : ''}</p>
              <button onClick={() => setFlipped((f) => !f)} className="px-2.5 py-1 rounded-full text-[10.5px] font-extrabold bg-kaya-warm text-kaya-chocolate">
                {flipped ? '🔄 Front' : '🔄 Flip'}
              </button>
              <button onClick={() => setOpenCard(null)} className="text-kaya-sand font-black text-lg leading-none px-1">×</button>
            </div>
            {!flipped ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={svgDataUrl(openCard)} alt={`Shine Card ${openCard.n}`} className="w-full rounded-kaya border border-kaya-warm-dark/50" />
                {/* HD PR-B — full share row on the Wall too (adults). */}
                <CardShareRow familyId={familyId} card={openCard} compact />
              </>
            ) : (
              <div className="rounded-kaya border-[1.5px] border-dashed border-kaya-warm-dark bg-kaya-cream/60 p-4 min-h-[240px]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-2">The back of the card</p>
                {(openCard.notes || []).map((nte, i) => (
                  <p key={i} className="text-[12px] mb-1.5">📝 <i>&ldquo;{nte.text}&rdquo;</i> <span className="text-kaya-sand">— {nte.byName}</span></p>
                ))}
                {openCard.echo && (
                  <p className="text-[12px] mb-1.5" style={{ color: '#6B3FE0' }}>💌 {openCard.echo.reaction} {openCard.echo.text ? <i>&ldquo;{openCard.echo.text}&rdquo;</i> : ''} <span className="text-kaya-sand">— {openCard.kidName.split(' ')[0]}</span></p>
                )}
                {(openCard.notes || []).length === 0 && !openCard.echo && (
                  <p className="text-[12px] text-kaya-sand">Nothing on the back yet — the memory grows here.</p>
                )}
                {isAdult && (
                  <div className="flex gap-2 mt-3">
                    <input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={300} placeholder="Add a note to this memory…"
                      className="flex-1 h-9 px-3 rounded-kaya-sm border border-kaya-warm-dark text-[12px] bg-white focus:outline-none focus:border-kaya-gold" />
                    <button
                      disabled={busy || !noteText.trim()}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await addShineCardNote(familyId, openCard.id, noteText);
                          setNoteText('');
                          await load();
                          setOpenCard((c) => c ? { ...c, notes: [...(c.notes || []), { text: noteText.trim(), byUid: profile?.uid || '', byName: (profile?.displayName || '').split(' ')[0], at: Date.now() }] } : c);
                        } catch { /* leave text for retry */ }
                        setBusy(false);
                      }}
                      className="h-9 px-3 rounded-kaya-sm bg-kaya-gold text-white text-[11.5px] font-black disabled:opacity-50">📝 Add</button>
                  </div>
                )}
                {isKidOwner && !openCard.echo && (
                  <div className="mt-3">
                    <p className="text-[11px] font-bold text-kaya-sand mb-1.5">💌 Say something back:</p>
                    <div className="flex gap-2 items-center flex-wrap">
                      {ECHO_OPTIONS.map((r) => (
                        <button key={r} disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await sendShineCardEcho(familyId, openCard.id, r, echoText);
                              await load();
                              setOpenCard((c) => c ? { ...c, echo: { reaction: r, ...(echoText.trim() ? { text: echoText.trim() } : {}), at: Date.now() } } : c);
                            } catch { /* retryable */ }
                            setBusy(false);
                          }}
                          className="w-10 h-10 rounded-full bg-white border border-kaya-warm-dark text-lg hover:border-kaya-gold disabled:opacity-50">{r}</button>
                      ))}
                      <input value={echoText} onChange={(e) => setEchoText(e.target.value)} maxLength={200} placeholder="…and a few words (optional)"
                        className="flex-1 min-w-[150px] h-9 px-3 rounded-kaya-sm border border-kaya-warm-dark text-[12px] bg-white focus:outline-none focus:border-kaya-gold" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
