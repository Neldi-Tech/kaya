'use client';

// Timeline 2.0 · 🖼 Note Studio (approved design v2 §3, 2026-08-25).
//
// Opens from ↗ Share on any day card: the day's note typeset on a themed
// keepsake card, exported as an image, WhatsApp share, a Moments post, or
// an A5 PDF (single day or the whole month as a mini-book). The note is
// the star — no statistics anywhere.
//
// Privacy posture (design v2 decisions):
//  · locked diary pages never reach this sheet (callers exclude them)
//  · kids post to Moments freely; image/WhatsApp/PDF to the OUTSIDE
//    goes through the parent-approval rail (🙋 Ask → /parent/approvals)
//  · parents may trim the CARD copy — the journal entry is never touched.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  type NoteCardData, type NoteTheme, NOTE_THEMES,
  noteCardSvgDataUrl, noteCardPngBlob, noteFilename, downloadNoteCard,
  shareNoteCard, waNoteText, rememberedNoteTheme, rememberNoteTheme,
  stashNotesForPrint,
} from '@/lib/noteCards';
import { sendNoteToSomeone } from '@/lib/noteSend';
import type { FamilyContact } from '@/lib/reminders';

export interface NoteStudioAsk {
  state: 'none' | 'pending' | 'approved';
  onAsk: () => Promise<void>;
}

/** 💌 Send-to-Someone — who owns the journal being shared. */
export interface NoteStudioSendMeta {
  kidId: string;
  surface: 'reflection' | 'diary';
}

export default function NoteStudio({
  open, onClose, base, monthNotes, monthLabel, kidTags, canShareOutside, ask, sw, sendMeta,
}: {
  open: boolean;
  onClose: () => void;
  /** The day being shared (locked pages already excluded by the caller). */
  base: Omit<NoteCardData, 'theme'> | null;
  /** Every shareable note in the same month (for the 📚 month book). */
  monthNotes: Array<Omit<NoteCardData, 'theme'>>;
  monthLabel: string;
  /** childIds tagged on a Moments post ([] for a parent's own journal). */
  kidTags: string[];
  /** Adults: all exports. Kids: Moments only until a parent approves. */
  canShareOutside: boolean;
  /** Kid flow — the parent-approval rail for outside shares. */
  ask?: NoteStudioAsk | null;
  sw: boolean;
  /** When set, 💌 Send-to-Someone offers the People-Book contacts. */
  sendMeta?: NoteStudioSendMeta | null;
}) {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const contacts = useMemo<FamilyContact[]>(
    () => ((family?.contacts as FamilyContact[] | undefined) ?? [])
      .filter((c) => !c.optOut && (!!c.email || (c.emails ?? []).length > 0)),
    [family?.contacts],
  );
  const [theme, setTheme] = useState<NoteTheme>('classic');
  const [cardText, setCardText] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (open && profile?.uid) setTheme(rememberedNoteTheme(profile.uid));
  }, [open, profile?.uid]);
  useEffect(() => {
    if (open && base) { setCardText(base.text); setEditing(false); setMsg(''); }
  }, [open, base]);

  const card = useMemo<NoteCardData | null>(
    () => (base ? { ...base, text: cardText || base.text, theme } : null),
    [base, cardText, theme],
  );

  if (!open || !base || !card) return null;

  const outsideUnlocked = canShareOutside || ask?.state === 'approved';

  const pickTheme = (t: NoteTheme) => {
    setTheme(t);
    if (profile?.uid) rememberNoteTheme(profile.uid, t);
  };

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(key); setMsg('');
    try { await fn(); setMsg(done); }
    catch (e) { setMsg((e as Error).message || (sw ? 'Imeshindikana' : 'Something went wrong')); }
    finally { setBusy(null); }
  };

  const toMoments = () => act('moments', async () => {
    if (!profile?.familyId || !profile.uid) throw new Error(sw ? 'Ingia kwanza' : 'Sign in first');
    const [{ reservePost, uploadProcessedPhoto, finalizePost }, { processPhotoForUpload }] = await Promise.all([
      import('@/lib/moments'), import('@/lib/photoUpload'),
    ]);
    const blob = await noteCardPngBlob(card);
    const file = new File([blob], noteFilename(card), { type: 'image/png' });
    const processed = await processPhotoForUpload(file);
    const postId = await reservePost(profile.familyId, profile.uid);
    const photo = await uploadProcessedPhoto(profile.familyId, postId, processed);
    await finalizePost(profile.familyId, postId, {
      authorUid: profile.uid,
      authorName: profile.displayName || card.kidName,
      caption: `${card.feeling ?? '📝'} ${card.kidName} · ${card.surfaceLabel} · ${card.dateLabel}`,
      photos: [photo],
      kidTags,
      mentionedUids: [],
      visibility: 'family',
    });
  }, sw ? '✓ Imewekwa Moments' : '✓ Posted to Moments');

  const toWhatsapp = () => act('wa', async () => {
    const shared = await shareNoteCard(card);
    if (!shared) window.open(`https://wa.me/?text=${encodeURIComponent(waNoteText(card))}`, '_blank');
  }, sw ? '✓ Imeshirikiwa' : '✓ Shared');

  const saveImage = () => act('save', () => downloadNoteCard(card), sw ? '✓ Imehifadhiwa' : '✓ Saved');

  const openPrint = (notes: Array<Omit<NoteCardData, 'theme'>>, title: string) => {
    stashNotesForPrint({ title, theme, notes });
    window.open('/sparks/note-print', '_blank');
  };

  /** 📚 month book — the cached 📖 Month Story becomes the cover intro. */
  const openMonthBook = () => act('book', async () => {
    let intro: string | undefined;
    if (sendMeta && base) {
      try {
        const { getMonthStory } = await import('@/lib/noteSend');
        const s = await getMonthStory({
          kidId: sendMeta.kidId, surface: sendMeta.surface,
          monthKey: base.dateKey.slice(0, 7),
        });
        intro = s.story ?? undefined;
      } catch { /* the cover simply skips the intro */ }
    }
    stashNotesForPrint({ title: monthLabel, theme, notes: monthNotes, ...(intro ? { intro } : {}) });
    window.open('/sparks/note-print', '_blank');
  }, sw ? '✓ Kitabu kimeandaliwa' : '✓ Book staged');

  const askOutside = () => act('ask', async () => { await ask?.onAsk(); },
    sw ? '🙋 Umemwomba mzazi — subiri kidogo' : '🙋 Asked — waiting for a parent');

  const btn = 'rounded-xl border-[1.5px] border-[#EDE6DA] bg-white px-3 py-2 font-nunito font-extrabold text-[12px] text-[#7A2E5C] disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-[#FFFBF5] rounded-t-3xl sm:rounded-3xl shadow-2xl">
        <div className="px-5 pt-4 pb-3 text-white sticky top-0 z-10" style={{ background: 'linear-gradient(135deg, #7A2E5C, #C05299)' }}>
          <div className="font-display font-extrabold text-[16px]">🖼 {sw ? 'Studio ya Kumbukumbu' : 'Note Studio'}</div>
          <div className="text-[11.5px] opacity-90">{card.dateLabel} · {card.surfaceLabel}</div>
        </div>

        <div className="p-4 space-y-3">
          {/* theme picker */}
          <div className="flex gap-1.5">
            {NOTE_THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => pickTheme(t.id)}
                className={`flex-1 rounded-xl border-[1.5px] py-1.5 font-nunito font-extrabold text-[11px] ${
                  theme === t.id ? 'border-[#C05299] bg-[#FBEAF4] text-[#7A2E5C]' : 'border-[#EDE6DA] bg-white text-[#5A6488]'
                }`}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>

          {/* live preview */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={noteCardSvgDataUrl(card)} alt={sw ? 'Kadi ya kumbukumbu' : 'Note card preview'}
            className="w-full rounded-2xl shadow-[0_10px_26px_rgba(122,46,92,0.22)]" />

          {/* ✂️ parents may trim the CARD copy; the journal stays untouched */}
          {canShareOutside && (
            <div>
              <button type="button" onClick={() => setEditing((v) => !v)}
                className="text-[11.5px] font-nunito font-extrabold text-[#5A3CB8] underline underline-offset-2">
                ✂️ {sw ? 'Punguza maandishi ya kadi (shajara haibadiliki)' : 'Trim the card text (the journal stays untouched)'}
              </button>
              {editing && (
                <textarea value={cardText} onChange={(e) => setCardText(e.target.value)}
                  rows={4} maxLength={2000}
                  className="mt-1.5 w-full rounded-xl border border-[#EDE6DA] bg-white p-2.5 text-[12.5px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#C05299]/30 resize-none" />
              )}
            </div>
          )}

          {/* share row */}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toMoments} disabled={!!busy} className={btn}>
              {busy === 'moments' ? '…' : '📸 Moments'}
            </button>
            {outsideUnlocked ? (
              <>
                <button type="button" onClick={saveImage} disabled={!!busy} className={btn}>
                  {busy === 'save' ? '…' : `🖼 ${sw ? 'Hifadhi picha' : 'Save image'}`}
                </button>
                <button type="button" onClick={toWhatsapp} disabled={!!busy}
                  className={`${btn} !border-[#25D366] !text-[#1F7A44]`}>
                  {busy === 'wa' ? '…' : '💬 WhatsApp'}
                </button>
                <button type="button" onClick={() => openPrint([base], card.dateLabel)} disabled={!!busy} className={btn}>
                  📄 {sw ? 'PDF A5' : 'A5 PDF'}
                </button>
                {monthNotes.length > 1 && (
                  <button type="button" onClick={openMonthBook} disabled={!!busy} className={btn}>
                    {busy === 'book' ? '…' : `📚 ${sw ? `Kitabu cha ${monthLabel}` : `${monthLabel} book`}`}
                  </button>
                )}
                {sendMeta && contacts.length > 0 && (
                  <button type="button" onClick={() => setPickerOpen((v) => !v)} disabled={!!busy}
                    className={`${btn} !border-[#C05299]`}>
                    💌 {sw ? 'Tuma kwa mtu' : 'Send to someone'}
                  </button>
                )}
              </>
            ) : ask ? (
              ask.state === 'pending' ? (
                <span className="rounded-xl bg-[#FFF3D6] border-[1.5px] border-[#F3D9A5] px-3 py-2 font-nunito font-extrabold text-[12px] text-[#8A6100]">
                  ⏳ {sw ? 'Umemwomba mzazi — subiri' : 'Asked — waiting for a parent'}
                </span>
              ) : (
                <button type="button" onClick={askOutside} disabled={!!busy} className={btn}>
                  {busy === 'ask' ? '…' : `🙋 ${sw ? 'Omba kushiriki nje' : 'Ask to share outside'}`}
                </button>
              )
            ) : null}
          </div>

          {/* 💌 People-Book picker — parent-added contacts only, opt-outs
              hidden. The server re-reads the note + re-checks the pass. */}
          {pickerOpen && sendMeta && base && (
            <div className="rounded-2xl border-[1.5px] border-[#EDE6DA] bg-white p-2.5">
              <div className="text-[10.5px] text-[#5A6488] mb-1.5 px-0.5">
                {sw ? '📇 Kitabu cha Watu — barua pepe' : '📇 People Book — sends the note by email'}
              </div>
              <div className="space-y-1.5">
                {contacts.map((c) => (
                  <button key={c.id} type="button" disabled={!!busy}
                    onClick={() => act(`send-${c.id}`, async () => {
                      await sendNoteToSomeone({
                        kidId: sendMeta.kidId, surface: sendMeta.surface,
                        date: base.dateKey, contactId: c.id,
                        kidName: base.kidName, surfaceLabel: base.surfaceLabel,
                        dateLabel: base.dateLabel, theme,
                      });
                      setSentTo(c.name); setPickerOpen(false);
                    }, sw ? `✓ Imetumwa kwa ${c.name}` : `✓ Sent to ${c.name}`)}
                    className="w-full flex items-center justify-between rounded-xl border-[1.5px] border-[#EDE6DA] bg-[#FFFBF5] px-3 py-2 text-left disabled:opacity-50">
                    <span>
                      <span className="block font-nunito font-extrabold text-[12.5px] text-[#0F1F44]">{c.name}</span>
                      <span className="block text-[10.5px] text-[#5A6488]">{c.relation || c.relationship}{c.email ? ` · ${c.email}` : ''}</span>
                    </span>
                    <span className="text-[14px]">{busy === `send-${c.id}` ? '…' : '💌'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {sentTo && (
            <p className="text-[11.5px] text-[#5A6488] m-0">
              💌 {sw
                ? `${sentTo} atapata barua pepe yenye kadi + kitufe cha kujibu 💛 — jibu litabandikwa kwenye siku hii.`
                : `${sentTo} gets the card by email with a one-tap 💛 reply — it pins right back onto this day.`}
            </p>
          )}

          {!canShareOutside && ask && (
            <p className="text-[10.5px] text-[#5A6488] leading-relaxed m-0">
              {sw
                ? 'Moments ni ya familia — unaweza kuweka mwenyewe. Kushiriki NJE (picha/WhatsApp/PDF) kunahitaji idhini ya mzazi kwa siku hii.'
                : 'Moments is family-only — you can post it yourself. Sharing OUTSIDE (image/WhatsApp/PDF) needs a parent’s OK for this day.'}
            </p>
          )}

          {msg && <p className="text-[12px] font-bold text-[#1F7A44] m-0">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
