'use client';

// 🌟 Shine Cards UI (RR PR-2) — the post-award sheet (theme picker +
// Post to Moments / Drop into chat / Save picture) and the Shine Wall
// (a kid's collected cards; flip side carries 📝 notes + 💌 the kid's
// thank-you echo). Persistence via the /api/recognition gateway; the
// PNG pipeline is self-contained SVG → canvas (lib/shineCards).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  type ShineCard, type ShineTheme, SHINE_THEMES,
  shineCardSvg, shineCardPngBlob, downloadShineCard,
  setShineCardTheme, addShineCardNote, sendShineCardEcho, listShineCards,
  setShineCardPost, emailShineCard, deleteShineCard, setShineCardGift, rememberTheme,
} from '@/lib/shineCards';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { reservePost, finalizePost, uploadProcessedPhoto, type Post } from '@/lib/moments';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { ensureDirectThread, sendMessage, type ThreadMember } from '@/lib/messaging';
import { safeUploadBytes } from '@/lib/storageUpload';
import { storage } from '@/lib/firebase';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { toDisplayDate } from '@/lib/dates';
import { useFamily } from '@/contexts/FamilyContext';
import { readHiveConfig, depositCash } from '@/lib/hive';
import { formatCents } from '@/components/pantry/format';

const svgDataUrl = (card: ShineCard) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(shineCardSvg(card))}`;

// 📣 Post a card to Moments (shared by the share row + the wizard's
// auto-post on approve). Returns the postId; also stamps the card.
export async function postShineCardToMoments(
  familyId: string,
  profile: { uid: string; displayName: string; avatarPhoto?: string },
  card: ShineCard,
): Promise<string> {
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
  await setShineCardPost(familyId, card.id, postId).catch(() => {});
  return postId;
}

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
  const [postedId, setPostedId] = useState<string | null>(card.momentsPostId || null);
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
    const postId = await postShineCardToMoments(familyId, profile, card);
    setPostedId(postId);
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

  // 📧 FX PR-5 — card straight to the kid's inbox + the family mailing
  // list. PNG uploads to the allowed messages path, server sends + logs.
  const emailCard = () => act('email', async () => {
    const blob = await shineCardPngBlob(card);
    const path = `families/${familyId}/messages/shine-email/shine-${card.n}-${Date.now().toString(36)}.png`;
    const r = storageRef(storage, path);
    await safeUploadBytes(r, blob, { contentType: 'image/png' });
    const url = await getDownloadURL(r);
    const res = await emailShineCard(familyId, card.id, url);
    setMsg(`📧 Sent to ${res.count} inbox${res.count === 1 ? '' : 'es'}!`);
  }, '📧 Emailed!');

  if (!isAdult) return null;
  const btn = (extra: string) =>
    `${compact ? 'h-9 text-[10.5px]' : 'h-10 text-[11.5px]'} rounded-kaya-sm font-black disabled:opacity-50 ${extra}`;
  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mt-3">
        <button onClick={postToMoments} disabled={!!busy} className={btn('bg-kaya-gold text-white')}>
          {busy === 'moments' ? '…' : '📣 Moments'}
        </button>
        <button onClick={dropIntoChat} disabled={!!busy} className={btn('text-white')} style={{ background: '#6B3FE0' }}>
          {busy === 'chat' ? '…' : '💬 Chat'}
        </button>
        <button onClick={emailCard} disabled={!!busy} className={btn('text-white')} style={{ background: '#D2691E' }}>
          {busy === 'email' ? '…' : '📧 Email'}
        </button>
        <button onClick={deviceShare} disabled={!!busy} className={btn('text-white')} style={{ background: '#11A08A' }}>
          {busy === 'share' ? '…' : '📤 Share'}
        </button>
        <button onClick={savePicture} disabled={!!busy} className={btn('border border-kaya-warm-dark text-kaya-sand')}>
          {busy === 'save' ? '…' : '🖼️ Save'}
        </button>
      </div>
      {msg && <p className="text-[12px] font-bold text-center mt-2">{msg}</p>}
      {postedId && (
        <p className="text-center mt-1.5">
          <Link href="/moments" className="text-[11.5px] font-black text-kaya-gold hover:underline">📣 This card is in Moments →</Link>
        </p>
      )}
    </div>
  );
}

// 🧭 FX PR-8 — pathway shortcuts on every card: the reward it points to,
// the Treasures register for valuables, the Hive for money.
export function CardPathwayLinks({ card }: { card: ShineCard }) {
  const links: Array<{ href: string; label: string }> = [];
  if (card.giftMeta?.rewardId) links.push({ href: '/rewards', label: '🎁 In the Rewards store →' });
  if (card.giftMeta?.pathway === 'treasure') links.push({ href: '/sparks/treasures', label: '💎 In Treasures →' });
  if (card.giftMeta?.pathway === 'hive') links.push({ href: '/hive', label: '💰 In the Hive ledger →' });
  if (links.length === 0) return null;
  return (
    <p className="text-center mt-1.5 flex gap-3 justify-center flex-wrap">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="text-[11px] font-black text-kaya-gold hover:underline">{l.label}</Link>
      ))}
    </p>
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

export function ShineWall({ familyId, childId, childName, title, bare = false, filterable = false }: {
  familyId: string;
  /** Absent = family-wide 🌟 Recognition history (FX PR-3). */
  childId?: string;
  childName?: string;
  title?: string;
  /** FX PR-7 — no outer card chrome (hosted inside a CollapsibleSection). */
  bare?: boolean;
  /** FX PR-7 — year + month timeline chips so history never overstacks. */
  filterable?: boolean;
}) {
  const { profile } = useAuth();
  const [cards, setCards] = useState<ShineCard[]>([]);
  const [openCard, setOpenCard] = useState<ShineCard | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [echoText, setEchoText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [giftFormOpen, setGiftFormOpen] = useState(false);

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
    w.document.write(`<html><head><title>Shine Book ${albumYear} — ${wallName}</title></head>
      <body style="font-family:Georgia,serif;text-align:center;background:#FDFBF7">
      <h1 style="font-size:26px;color:#1E120B;margin:24px 0 2px">📖 ${wallName}'s Shine Book ${albumYear}</h1>
      <p style="color:#9B8A72;font-size:13px;margin:0 0 14px">${albumCards.length} moments this family stopped to say "we see you"</p>
      ${imgs}<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  const isAdult = profile?.role === 'parent' || profile?.role === 'helper';
  // Family-wide history: the kid-owner check runs per CARD, not per wall.
  const isKidOwner = !!openCard && profile?.role === 'kid' && profile?.childId === openCard.kidId;
  const wallName = (childName || 'Family').split(' ')[0];

  // 🗓️ FX PR-7 — timeline filters (year → month) so the shelf stays tidy.
  const [fYear, setFYear] = useState<number>(() => new Date().getFullYear());
  const [fMonth, setFMonth] = useState<number | null>(null); // null = all months
  const filterYears = useMemo(() => {
    const ys = new Set(cards.map((c) => new Date(c.at).getFullYear()));
    ys.add(new Date().getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [cards]);
  const shownCards = useMemo(() => {
    if (!filterable) return cards;
    return cards.filter((c) => {
      const d = new Date(c.at);
      if (d.getFullYear() !== fYear) return false;
      if (fMonth !== null && d.getMonth() !== fMonth) return false;
      return true;
    });
  }, [cards, filterable, fYear, fMonth]);
  const monthsWithCards = useMemo(() => {
    const set = new Set<number>();
    for (const c of cards) {
      const d = new Date(c.at);
      if (d.getFullYear() === fYear) set.add(d.getMonth());
    }
    return set;
  }, [cards, fYear]);

  const load = useMemo(() => async () => {
    try { setCards(await listShineCards(familyId, childId)); } catch { setCards([]); }
    setLoaded(true);
  }, [familyId, childId]);
  useEffect(() => { void load(); }, [load]);

  if (loaded && cards.length === 0) return null;

  const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className={bare ? '' : 'bg-white border border-kaya-warm-dark rounded-kaya-lg p-4'}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-1">
        {title || `🌟 ${wallName}'s Shine Wall`} · {cards.length} card{cards.length === 1 ? '' : 's'}
      </p>
      {(() => {
        // 🎁 FX PR-5 — gift statistics groundwork, visible from day one.
        const gifts = cards.filter((c) => c.gift);
        if (gifts.length === 0) return <div className="mb-1.5" />;
        const byLabel = new Map<string, number>();
        for (const g of gifts) byLabel.set(g.gift!, (byLabel.get(g.gift!) || 0) + 1);
        const top = [...byLabel.entries()].sort((a, b) => b[1] - a[1])[0];
        return (
          <p className="text-[10.5px] font-bold text-kaya-sand mb-2.5">
            🎁 {gifts.length} gift{gifts.length === 1 ? '' : 's'} recorded · top: {top[0]}{top[1] > 1 ? ` ×${top[1]}` : ''}
          </p>
        );
      })()}
      {filterable && (
        <div className="flex gap-1.5 flex-wrap items-center mb-2.5">
          {filterYears.map((y) => (
            <button key={y} type="button" onClick={() => { setFYear(y); setFMonth(null); }}
              className={`px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border ${fYear === y ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
              {y}
            </button>
          ))}
          <span className="w-px h-4 bg-kaya-warm-dark mx-0.5" />
          <button type="button" onClick={() => setFMonth(null)}
            className={`px-2 py-1 rounded-full text-[10px] font-extrabold border ${fMonth === null ? 'bg-kaya-gold text-white border-kaya-gold-dark' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
            All
          </button>
          {MONTH_LABEL.map((m, i) => monthsWithCards.has(i) && (
            <button key={m} type="button" onClick={() => setFMonth(i)}
              className={`px-2 py-1 rounded-full text-[10px] font-extrabold border ${fMonth === i ? 'bg-kaya-gold text-white border-kaya-gold-dark' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
              {m}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {shownCards.slice(0, 12).map((c) => (
          <button key={c.id} onClick={() => { setOpenCard(c); setFlipped(false); setNoteText(''); setEchoText(''); setGiftFormOpen(false); }} className="text-left group">
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
        {shownCards.length > 12 && <span className="text-[10.5px] text-kaya-sand">…{shownCards.length - 12} more card{shownCards.length - 12 === 1 ? '' : 's'} live in the book.</span>}
      </div>

      {albumOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-6" onClick={() => setAlbumOpen(false)}>
          <div className="bg-white w-full max-w-3xl rounded-kaya-lg p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <p className="font-display font-black text-[15px] flex-1">📖 {wallName}&apos;s Shine Book</p>
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
                <CardPathwayLinks card={openCard} />
                {/* 🎁 FX PR-9 — retro-add a gift to a card that has none. */}
                {isAdult && !openCard.gift && (
                  giftFormOpen ? (
                    <GiftForm familyId={familyId} card={openCard}
                      onSaved={(gm) => {
                        setGiftFormOpen(false);
                        setOpenCard((c) => c ? { ...c, gift: gm.label, giftMeta: gm } : c);
                        void load();
                      }} />
                  ) : (
                    <button type="button" onClick={() => setGiftFormOpen(true)}
                      className="mt-2 text-[11.5px] font-black text-kaya-gold hover:underline">
                      ＋ 🎁 Add a gift to this recognition
                    </button>
                  )
                )}
                {profile?.role === 'parent' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      // 🗑 FX PR-6 — remove a WRONG recognition. Points stay.
                      if (!window.confirm(`Delete Shine Card №${openCard.n}? The points/award stay — only the card is removed.`)) return;
                      setBusy(true);
                      try { await deleteShineCard(familyId, openCard.id); setOpenCard(null); await load(); }
                      catch { /* retryable */ }
                      setBusy(false);
                    }}
                    className="mt-2 text-[11px] font-bold text-kaya-rose hover:underline disabled:opacity-50"
                    style={{ color: '#E06A7B' }}
                  >
                    🗑 Delete this card (wrong recognition)
                  </button>
                )}
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


// ── 🎁 Retro gift form (FX PR-9) ──────────────────────────────────
// Record a gift on an EXISTING card — same pathways as the wizard:
// 🎈 simple · 💎 valuable → Treasures · 💰 money → real Hive deposit.
export function GiftForm({ familyId, card, onSaved }: {
  familyId: string;
  card: ShineCard;
  onSaved: (giftMeta: NonNullable<ShineCard['giftMeta']>) => void;
}) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const currency = readHiveConfig(family).currency;
  const [label, setLabel] = useState('');
  const [pathway, setPathway] = useState<'simple' | 'treasure' | 'hive'>('simple');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async () => {
    if (busy || !label.trim()) return;
    if (pathway === 'hive' && !(parseFloat(amount) > 0)) { setMsg('Enter the amount.'); return; }
    setBusy(true); setMsg('');
    try {
      const cents = pathway === 'hive' ? Math.round(parseFloat(amount) * 100) : 0;
      const giftMeta: NonNullable<ShineCard['giftMeta']> = {
        label: label.trim(),
        source: 'custom',
        pathway,
        ...(cents > 0 ? { amountCents: cents } : {}),
      };
      await setShineCardGift(familyId, card.id, label.trim(), giftMeta);
      if (pathway === 'hive' && cents > 0 && profile?.role === 'parent') {
        await depositCash(familyId, card.kidId, cents, 'gift',
          `🌟 Recognition gift — Shine Card №${card.n}`, profile.uid).catch(() => {});
      }
      onSaved(giftMeta);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save — try again.');
    }
    setBusy(false);
  };

  return (
    <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark bg-kaya-cream/60 p-3 mt-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">🎁 Record the gift for №{card.n} · {card.kidName}</p>
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} autoFocus
        placeholder="What was given? e.g. Ice cream cone, TZS 10,000, a bicycle…"
        className="w-full h-10 px-3 rounded-kaya-sm border border-kaya-warm-dark text-[12.5px] bg-white focus:outline-none focus:border-kaya-gold" />
      <div className="flex gap-1.5 flex-wrap items-center mt-2">
        {([['simple', '🎈 Simple — settles here'], ['treasure', '💎 Valuable → Treasures'], ['hive', '💰 Money → Hive']] as const).map(([pw, l]) => (
          <button key={pw} type="button" onClick={() => setPathway(pw)}
            className={`px-2.5 py-1.5 rounded-full text-[10.5px] font-extrabold border ${pathway === pw ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
            {l}
          </button>
        ))}
        {pathway === 'hive' && (
          <input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
            className="h-9 w-36 px-3 rounded-kaya-sm border border-kaya-warm-dark text-[12px] bg-white focus:outline-none focus:border-kaya-gold" />
        )}
      </div>
      {pathway === 'hive' && profile?.role === 'parent' && (
        <p className="text-[10px] text-kaya-sand mt-1">Deposits into {card.kidName}&apos;s Hive Cash with a 📜 ledger line.</p>
      )}
      <div className="flex items-center gap-2 mt-2.5">
        <button type="button" onClick={() => void save()} disabled={busy || !label.trim()}
          className="h-9 px-4 rounded-kaya-sm bg-kaya-gold text-white text-[11.5px] font-black disabled:opacity-50">
          {busy ? 'Saving…' : '🎁 Seal the record'}
        </button>
        {msg && <span className="text-[11px] font-bold text-kaya-rose" style={{ color: '#E06A7B' }}>{msg}</span>}
      </div>
    </div>
  );
}

// ── 🎁 Gift register (FX PR-7) ────────────────────────────────────
// Every gift, linked to the recognition (card №) it rode on — the
// visible face of the giftMeta statistics substrate.

const GIFT_SOURCE_BADGE: Record<string, string> = {
  store: '🏬 store', custom: '✏️ own', surprise: '🎲 surprise',
};

export function GiftRegister({ familyId }: { familyId: string }) {
  const { family } = useFamily();
  const currency = readHiveConfig(family).currency;
  const [cards, setCards] = useState<ShineCard[]>([]);
  const [openCard, setOpenCard] = useState<ShineCard | null>(null);
  // 🎁 FX PR-9 — record-a-gift entry point (retro-add on giftless cards).
  const [pickOpen, setPickOpen] = useState(false);
  const [pickCard, setPickCard] = useState<ShineCard | null>(null);
  useEffect(() => {
    listShineCards(familyId).then(setCards).catch(() => setCards([]));
  }, [familyId]);

  // 🧭 FX PR-8 — pathway filter (All / 💎 / 💰 / 🎈) + money totals.
  const [pathFilter, setPathFilter] = useState<'all' | 'treasure' | 'hive' | 'simple'>('all');
  const allGifts = useMemo(() => cards.filter((c) => c.gift), [cards]);
  const gifts = useMemo(() => allGifts.filter((c) =>
    pathFilter === 'all' ? true : (c.giftMeta?.pathway || 'simple') === pathFilter), [allGifts, pathFilter]);
  const moneyTotal = useMemo(() =>
    allGifts.reduce((sum, c) => sum + (c.giftMeta?.pathway === 'hive' ? (c.giftMeta?.amountCents || 0) : 0), 0), [allGifts]);
  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gifts) m.set(g.gift!, (m.get(g.gift!) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gifts]);

  const giftless = cards.filter((c) => !c.gift).slice(0, 10);
  const recordEntry = giftless.length > 0 ? (
    <div className="mb-2.5">
      {!pickOpen ? (
        <button type="button" onClick={() => setPickOpen(true)}
          className="h-9 px-3.5 rounded-kaya-sm bg-kaya-gold text-white text-[11.5px] font-black">
          ＋ 🎁 Record a gift on a card
        </button>
      ) : pickCard ? (
        <GiftForm familyId={familyId} card={pickCard}
          onSaved={() => {
            setPickOpen(false); setPickCard(null);
            listShineCards(familyId).then(setCards).catch(() => {});
          }} />
      ) : (
        <div className="rounded-kaya-sm border border-dashed border-kaya-warm-dark bg-kaya-cream/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">Which recognition was the gift for?</p>
          <div className="space-y-1">
            {giftless.map((c) => (
              <button key={c.id} type="button" onClick={() => setPickCard(c)}
                className="w-full flex items-center gap-2 text-left bg-white border border-kaya-warm-dark rounded-kaya-sm px-3 py-1.5 hover:border-kaya-gold">
                <span className="text-[11px] font-black text-kaya-gold shrink-0">🌟 №{c.n}</span>
                <span className="text-[12px] font-bold shrink-0">{c.kidEmoji} {c.kidName}</span>
                <span className="text-[11px] text-kaya-sand truncate flex-1">&ldquo;{c.quote}&rdquo;</span>
                <span className="text-[10px] font-bold text-kaya-sand shrink-0">{toDisplayDate(new Date(c.at).toISOString().slice(0, 10))}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPickOpen(false)} className="text-[11px] font-bold text-kaya-sand mt-1.5">cancel</button>
        </div>
      )}
    </div>
  ) : null;

  if (allGifts.length === 0) {
    return (
      <div>
        {recordEntry}
        <p className="text-[12px] text-kaya-sand">No gifts recorded yet — record one on any card above, or they land here automatically when a recognition carries one.</p>
      </div>
    );
  }
  const PATH_CHIP: Array<[typeof pathFilter, string]> = [['all', 'All'], ['treasure', '💎 Treasures'], ['hive', '💰 Hive'], ['simple', '🎈 Simple']];
  return (
    <div>
      {recordEntry}
      <div className="flex gap-1.5 flex-wrap items-center mb-2">
        {PATH_CHIP.map(([pf, label]) => (
          <button key={pf} type="button" onClick={() => setPathFilter(pf)}
            className={`px-2.5 py-1 rounded-full text-[10.5px] font-extrabold border ${pathFilter === pf ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-[10.5px] font-bold text-kaya-sand mb-2">
        🎁 {allGifts.length} gift{allGifts.length === 1 ? '' : 's'} recorded
        {byLabel.length > 0 ? <> · top: {byLabel[0][0]}{byLabel[0][1] > 1 ? ` ×${byLabel[0][1]}` : ''}</> : null}
        {moneyTotal > 0 ? <> · 💰 total gifted to Hive: <b>{formatCents(moneyTotal, currency)}</b></> : null}
      </p>
      <div className="space-y-1">
        {gifts.slice(0, 30).map((g) => (
          <button key={g.id} type="button" onClick={() => setOpenCard(g)}
            className="w-full flex items-center gap-2 text-left bg-white border border-kaya-warm-dark rounded-kaya-sm px-3 py-2 hover:border-kaya-gold transition-colors">
            <span className="text-[11px] font-bold text-kaya-sand shrink-0 w-24">{toDisplayDate(new Date(g.at).toISOString().slice(0, 10))}</span>
            <span className="text-[12px] font-bold shrink-0">{g.kidEmoji} {g.kidName}</span>
            <span className="text-[12px] font-semibold flex-1 truncate">{g.gift}</span>
            <span className="text-[9.5px] font-extrabold text-kaya-sand shrink-0 px-1.5 py-0.5 rounded-full bg-kaya-warm">{GIFT_SOURCE_BADGE[g.giftMeta?.source || 'custom']}</span>
            <span className="text-[9.5px] font-extrabold shrink-0 px-1.5 py-0.5 rounded-full" style={
              g.giftMeta?.pathway === 'hive' ? { background: '#E2F7F3', color: '#0E9C86' }
              : g.giftMeta?.pathway === 'treasure' ? { background: '#EFE9FF', color: '#6B3FE0' }
              : { background: '#FDF3E0', color: '#A87D0F' }
            }>{g.giftMeta?.pathway === 'hive' ? `💰 Hive${g.giftMeta?.amountCents ? ` · ${formatCents(g.giftMeta.amountCents, currency)}` : ''}` : g.giftMeta?.pathway === 'treasure' ? '💎 Treasure' : '🎈 simple'}</span>
            <span className="text-[10.5px] font-black text-kaya-gold shrink-0">🌟 №{g.n}</span>
          </button>
        ))}
        {gifts.length > 30 && <p className="text-[10.5px] text-kaya-sand">…and {gifts.length - 30} older gifts.</p>}
      </div>
      {openCard && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setOpenCard(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-kaya-lg sm:rounded-kaya-lg p-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <p className="font-display font-black text-[15px] flex-1">🎁 {openCard.gift} · 🌟 №{openCard.n}</p>
              <button onClick={() => setOpenCard(null)} className="text-kaya-sand font-black text-lg leading-none px-1">×</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgDataUrl(openCard)} alt={`Shine Card ${openCard.n}`} className="w-full rounded-kaya border border-kaya-warm-dark/50" />
            <CardShareRow familyId={familyId} card={openCard} compact />
            <CardPathwayLinks card={openCard} />
          </div>
        </div>
      )}
    </div>
  );
}
