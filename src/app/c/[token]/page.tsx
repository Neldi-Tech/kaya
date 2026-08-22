'use client';

// ✉️ Public card page (Reminders 2.0 — R10 + innovation 2 "thank-you loop").
// Opened from the greeting email / WhatsApp link — NO login. Shows the card
// (front → tap to open → message · lines · signature), lets the recipient
// react / write a thank-you (lands in the family's chat + bells), carries
// the Kaya signature footer, and honours "?stop=<contactId>" (R13 opt-out).
// Self-styled like /p/[token] — no app shell, no auth context.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { cardSvgDataUrl, cardHeadline, shortName, type GreetingCard } from '@/lib/greetingCards';
import { toDisplayDate } from '@/lib/dates';

type Proj = {
  id: string; type: 'birthday' | 'anniversary' | 'event' | 'appointment' | 'reminder'; nth: number | null; dateKey: string; eventTitle: string;
  honoree: { name: string; relationship: 'family' | 'adult' | 'kid-friend'; contactId: string | null };
  theme: GreetingCard['theme']; accent: string | null; stickers: string[]; photoUrl: string | null; imageUrl: string | null;
  oneLiner: string; message: string; lang: 'en' | 'sw';
  lines: Array<{ name: string; text: string; kid: boolean }>;
  signatureLine: string; signatureRoster: string | null; familyName: string; thanksCount: number;
};

const REACTIONS = ['❤️', '🙏', '😂', '🥹'];

export default function PublicCardPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token ?? '');
  const [stopId, setStopId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'expired' | 'error'>('loading');
  const [card, setCard] = useState<Proj | null>(null);
  const [open, setOpen] = useState(false);
  const [reaction, setReaction] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [thanked, setThanked] = useState(false);
  const [stopState, setStopState] = useState<'ask' | 'done' | 'no'>('ask');

  useEffect(() => {
    try { setStopId(new URLSearchParams(window.location.search).get('stop') || ''); } catch { /* noop */ }
    if (!token) { setState('notfound'); return; }
    fetch(`/api/cards/public?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 404) { setState('notfound'); return; }
        if (r.status === 410) { setState('expired'); return; }
        if (!r.ok) { setState('error'); return; }
        const j = await r.json();
        setCard(j.card); setState('ready');
        if (typeof window !== 'undefined' && window.location.hash === '#thanks') setOpen(true);
      })
      .catch(() => setState('error'));
  }, [token]);

  const svg = useMemo(() => {
    if (!card) return '';
    const c: GreetingCard = {
      id: card.id, familyId: '', eventId: '', dateKey: card.dateKey, type: card.type, eventTitle: card.eventTitle, nth: card.nth,
      honoree: { name: card.honoree.name, relationship: card.honoree.relationship, autoSend: false, ccParents: false },
      theme: card.theme, ...(card.accent ? { accent: card.accent } : {}), stickers: card.stickers, ...(card.photoUrl ? { photoUrl: card.photoUrl } : {}),
      oneLiner: card.oneLiner, message: card.message, lines: card.lines.map((l) => ({ uid: '', name: l.name, text: l.text, at: 0, kid: l.kid })),
      lang: card.lang, signatureLine: card.signatureLine, ...(card.signatureRoster ? { signatureRoster: card.signatureRoster } : {}),
      status: 'sent', authorUid: '', authorName: '', authorRole: 'parent', createdAt: 0, updatedAt: 0,
    };
    return cardSvgDataUrl(c, { dateLabel: toDisplayDate(card.dateKey) });
  }, [card]);

  async function sendThanks() {
    if (!card || (!reaction && !text.trim()) || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/cards/public', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'thanks', reaction, text: text.trim() }) });
      if (r.ok) setThanked(true);
    } finally { setSending(false); }
  }
  async function stop() {
    if (!card || !stopId) return;
    const r = await fetch('/api/cards/public', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, action: 'stop', contactId: stopId }) });
    setStopState(r.ok ? 'done' : 'no');
  }

  const sw = card?.lang === 'sw';
  const headline = card ? cardHeadline(card.type, card.nth, card.lang, card.eventTitle) : '';
  const first = shortName(card?.honoree.name);

  return (
    <div style={{ minHeight: '100vh', background: '#F4F1EA', fontFamily: "'Nunito', Lato, -apple-system, Segoe UI, Helvetica, Arial, sans-serif", color: '#1F2D3D' }}>
      <div style={{ background: '#1F2D3D', color: '#FFF8EC', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
        <b style={{ letterSpacing: '.08em', fontWeight: 900 }}>KAYA</b>
        <span>{sw ? 'kadi kwa ajili yako' : 'a card for you'}</span>
      </div>
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '18px 14px 40px' }}>
        {state === 'loading' && <Panel emoji="✉️" title={sw ? 'Inafungua kadi…' : 'Opening your card…'} />}
        {state === 'notfound' && <Panel emoji="🔎" title="Link not found" body="This card link doesn’t exist or was withdrawn by the family." />}
        {state === 'expired' && <Panel emoji="⌛" title="Link expired" body="Card links stay open for 90 days. Ask the family to share it again." />}
        {state === 'error' && <Panel emoji="😕" title="Something went wrong" body="Please try again in a moment." />}

        {state === 'ready' && card && (
          <>
            {stopId && card.honoree.contactId === stopId && stopState !== 'done' && (
              <div style={{ background: '#FFF4E0', border: '1px solid #E8B45A', borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>
                <b>Stop these greetings?</b> The {card.familyName || ''} family would no longer be able to auto-send you cards from Kaya.
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={stop} style={btn('#C0392B')}>Yes, stop them</button>
                  <button onClick={() => setStopState('no')} style={btn('#fff', '#1F2D3D', true)}>Keep them coming</button>
                </div>
                {stopState === 'no' && <div style={{ fontSize: 12, marginTop: 6 }}>Lovely — nothing changed. 💛</div>}
              </div>
            )}
            {stopState === 'done' && <div style={{ background: '#E6F4EC', border: '1px solid #9bd3ad', borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: 13 }}>Done — Kaya won’t auto-send you greetings any more. The family has been told.</div>}

            <div style={{ textAlign: 'center', fontSize: 12, color: '#5C6975', marginBottom: 8 }}>{sw ? 'Kutoka' : 'From'} <b>{card.signatureLine}</b> · {toDisplayDate(card.dateKey)}</div>
            <button onClick={() => setOpen((o) => !o)} style={{ display: 'block', width: '100%', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }} aria-label="Open the card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svg} alt={`${headline} — ${card.honoree.name}`} style={{ width: '100%', maxWidth: 340, margin: '0 auto', display: 'block', borderRadius: 18, boxShadow: '0 18px 40px -18px rgba(30,18,11,.45)' }} />
            </button>
            <div style={{ textAlign: 'center', fontSize: 12, color: '#5C6975', margin: '8px 0 12px' }}>{open ? (sw ? 'Gusa kadi kufunga' : 'Tap the card to close it') : (sw ? `Gusa kadi kuifungua · ${card.lines.length ? `mistari ${card.lines.length} ndani` : 'ujumbe ndani'}` : `Tap the card to open it · ${card.lines.length ? `${card.lines.length} family line${card.lines.length === 1 ? '' : 's'} inside` : 'message inside'}`)}</div>

            {open && (
              <div style={{ background: '#FFFDF8', border: '1px solid #E8DEC9', borderRadius: 16, padding: '16px 18px', marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.45, color: '#2b1d12', whiteSpace: 'pre-wrap' }}>{card.message}</div>
                {card.lines.length > 0 && (
                  <div style={{ borderTop: '1px dashed #E8DEC9', marginTop: 12, paddingTop: 10 }}>
                    {card.lines.map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 13.5 }}>
                        <span style={{ width: 26, height: 26, borderRadius: '50%', background: l.kid ? '#FFF4E0' : '#E7EAFA', color: l.kid ? '#B8860B' : '#3E4DA0', fontWeight: 900, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{(l.name || '?')[0]}</span>
                        <div><div style={{ fontSize: 12, fontWeight: 800, color: '#5C6975' }}>{l.name}</div><div style={l.kid ? { fontStyle: 'italic', fontWeight: 700, color: '#6b4a1a' } : {}}>{l.text}</div></div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ textAlign: 'right', marginTop: 12 }}>
                  <div style={{ fontStyle: 'italic', fontWeight: 800, fontSize: 18, color: '#3D241A' }}>{sw ? 'Kwa upendo,' : 'With love,'} {card.signatureLine}</div>
                  {card.signatureRoster && <div style={{ fontSize: 11.5, color: '#5C6975' }}>{card.signatureRoster}</div>}
                </div>
              </div>
            )}

            <div id="thanks" style={{ background: '#fff', border: '1px solid #E8DEC9', borderRadius: 16, padding: '14px 16px' }}>
              {thanked ? (
                <div style={{ textAlign: 'center', fontSize: 14 }}>🙏 {sw ? `Asante, ${first}! Familia imepata ujumbe wako.` : `Thank you, ${first}! The family got your reply.`}</div>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#3E4DA0', marginBottom: 8 }}>{sw ? 'Tuma shukrani' : 'Send a thank-you'}</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10 }}>
                    {REACTIONS.map((r) => (
                      <button key={r} onClick={() => setReaction(reaction === r ? '' : r)} style={{ fontSize: 20, padding: '6px 12px', borderRadius: 999, border: `1px solid ${reaction === r ? '#5B6CC8' : '#E8DEC9'}`, background: reaction === r ? '#E7EAFA' : '#fff', cursor: 'pointer' }}>{r}</button>
                    ))}
                  </div>
                  <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 240))} rows={2} placeholder={sw ? 'Andika ujumbe… k.m. “Asante sana, nawapenda nyote!”' : 'Say thank you… e.g. “Asante sana, nawapenda nyote!”'}
                    style={{ width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #E8DEC9', padding: 10, fontSize: 13, fontFamily: 'inherit' }} />
                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <button onClick={sendThanks} disabled={sending || (!reaction && !text.trim())} style={{ ...btn('#5B6CC8'), opacity: sending || (!reaction && !text.trim()) ? .6 : 1 }}>{sending ? '…' : (sw ? 'Tuma kwa familia 💬' : 'Send to the family 💬')}</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div style={{ background: '#F0EBE3', padding: '12px 14px', fontSize: 11, color: '#5C6975', textAlign: 'center' }}>
        {sw ? 'Imetengenezwa kwa' : 'Made with'} <b style={{ color: '#1F2D3D' }}>KAYA</b> — {sw ? 'mtandao wa familia' : 'the family network'} · <a href="/?ref=card" style={{ color: '#3E4DA0' }}>{sw ? 'Kuhusu Kaya' : 'About Kaya · join the waitlist'}</a>
        {card?.honoree.contactId && !stopId && <> · <a href={`?stop=${encodeURIComponent(card.honoree.contactId)}`} style={{ color: '#5C6975' }}>{sw ? 'Sitisha salamu' : 'Stop these'}</a></>}
      </div>
    </div>
  );
}

function btn(bg: string, fg = '#fff', border = false): React.CSSProperties {
  return { background: bg, color: fg, border: border ? '1px solid #E8DEC9' : 0, borderRadius: 10, padding: '9px 14px', fontWeight: 900, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
}

function Panel({ emoji, title, body }: { emoji: string; title: string; body?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8DEC9', borderRadius: 16, padding: '28px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>{emoji}</div>
      <div style={{ fontWeight: 900, fontSize: 17, marginTop: 6 }}>{title}</div>
      {body && <div style={{ fontSize: 13, color: '#5C6975', marginTop: 4 }}>{body}</div>}
    </div>
  );
}
