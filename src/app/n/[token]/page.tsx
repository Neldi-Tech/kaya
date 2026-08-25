'use client';

// Timeline 2.0 · 💌 public note page (design v2 innovation #6).
//
// No login, no app shell — grandparents open this straight from the
// email. Shows the one note that was deliberately sent (the token doc
// is a self-contained projection; the journal is never read) and takes
// a one-tap 💛 reply that lands back on that very day of the kid's
// journal. ?stop=<contactId> = the People-Book opt-out flow.

import { useEffect, useMemo, useState } from 'react';
import { notePalette, type NoteTheme } from '@/lib/noteCards';

interface PublicNote {
  kidName: string; surfaceLabel: string; dateLabel: string;
  feeling: string | null; text: string; theme: NoteTheme;
  familyName: string; contactId: string | null; contactName: string | null;
  thanksCount: number;
}

const REACTIONS = ['💛', '🙏', '😂', '🥹', '👏', '🎉'];

export default function PublicNotePage() {
  const [token, setToken] = useState('');
  const [stopId, setStopId] = useState('');
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'expired'>('loading');
  const [note, setNote] = useState<PublicNote | null>(null);
  const [reaction, setReaction] = useState('💛');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    const parts = window.location.pathname.split('/');
    const t = parts[parts.indexOf('n') + 1] || '';
    setToken(t);
    setStopId(new URLSearchParams(window.location.search).get('stop') || '');
    (async () => {
      try {
        const res = await fetch(`/api/notes/public?token=${encodeURIComponent(t)}`);
        if (res.status === 410) { setState('expired'); return; }
        if (!res.ok) { setState('missing'); return; }
        setNote(await res.json() as PublicNote);
        setState('ok');
      } catch { setState('missing'); }
    })();
  }, []);

  const p = useMemo(() => notePalette(note?.theme ?? 'classic'), [note?.theme]);

  const sendThanks = async () => {
    if (busy || sent) return;
    setBusy(true);
    try {
      const res = await fetch('/api/notes/public', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, action: 'thanks', reaction, text: text.trim() || undefined }),
      });
      if (res.ok) setSent(true);
    } finally { setBusy(false); }
  };

  const doStop = async () => {
    if (busy || stopped) return;
    setBusy(true);
    try {
      const res = await fetch('/api/notes/public', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, action: 'stop', contactId: stopId }),
      });
      if (res.ok) setStopped(true);
    } finally { setBusy(false); }
  };

  if (state === 'loading') {
    return <div className="min-h-screen grid place-items-center bg-[#FBF6EA] text-[#5A6488] text-sm">…</div>;
  }
  if (state !== 'ok' || !note) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#FBF6EA] px-6 text-center">
        <div>
          <div className="text-[40px] mb-2">💌</div>
          <p className="text-[15px] font-bold text-[#0F1F44] m-0">
            {state === 'expired' ? 'This note link has expired.' : 'This note could not be found.'}
          </p>
          <p className="text-[12.5px] text-[#5A6488] mt-1">Ask the family to send it again from Kaya.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBF6EA] py-8 px-4" style={{ fontFamily: 'Nunito, Avenir Next, sans-serif' }}>
      <div className="mx-auto max-w-[440px]">
        <div className="text-center text-[12px] font-extrabold text-[#5A6488] mb-3">
          💌 The {note.familyName} family shared this with you via <span className="text-[#C05299] font-black">Kaya</span>
        </div>

        {/* the note card */}
        <div className="rounded-3xl shadow-[0_16px_36px_rgba(122,46,92,0.22)] overflow-hidden"
          style={{ background: p.bg, border: `2.5px solid ${p.edge}` }}>
          <div className="px-6 pt-6 flex items-center gap-3">
            <span className="text-[38px] leading-none">{note.feeling || '📝'}</span>
            <div>
              <div className="font-black text-[18px]" style={{ color: p.name }}>{note.kidName} · {note.surfaceLabel}</div>
              <div className="font-bold text-[12px]" style={{ color: p.date }}>{note.dateLabel}</div>
            </div>
          </div>
          <div className="mx-6 my-3 h-[3px] w-[130px] rounded-full" style={{ background: p.rule }} />
          <div className="px-6 pb-5 text-[15.5px] leading-[1.8] italic whitespace-pre-wrap"
            style={{ color: p.text, fontFamily: 'Lato, Georgia, serif' }}>
            “{note.text}”
          </div>
          <div className="px-6 py-4 flex justify-between text-[11px] font-extrabold"
            style={{ color: p.footer, borderTop: `1.5px solid ${p.edge}` }}>
            <span>Made with <span style={{ color: p.brand, fontWeight: 900 }}>Kaya</span> 💛</span>
            <span>ourkaya.com</span>
          </div>
        </div>

        {/* reply */}
        {!stopId && (
          <div className="mt-5 rounded-2xl bg-white border-[1.5px] border-[#EDE6DA] p-4">
            {sent ? (
              <div className="text-center py-2">
                <div className="text-[30px]">{reaction}</div>
                <p className="font-black text-[15px] text-[#0F1F44] m-0 mt-1">Sent!</p>
                <p className="text-[12.5px] text-[#5A6488] mt-1 m-0">
                  Your reply is pinned to that very page of {note.kidName}&apos;s journal.
                </p>
              </div>
            ) : (
              <>
                <div className="font-black text-[14px] text-[#0F1F44] mb-2">Send back a little love</div>
                <div className="flex gap-1.5 mb-2.5">
                  {REACTIONS.map((r) => (
                    <button key={r} type="button" onClick={() => setReaction(r)}
                      className={`flex-1 rounded-xl border-[1.5px] py-2 text-[20px] ${
                        reaction === r ? 'border-[#C05299] bg-[#FBEAF4]' : 'border-[#EDE6DA] bg-white'
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={240}
                  placeholder="Add a few words (optional)…"
                  className="w-full rounded-xl border border-[#EDE6DA] bg-[#FFFBF5] px-3 py-2.5 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[#C05299]/30" />
                <button type="button" onClick={sendThanks} disabled={busy}
                  className="mt-2.5 w-full rounded-xl bg-[#C05299] py-3 font-black text-[14px] text-white disabled:opacity-60">
                  {busy ? '…' : `Send ${reaction} to ${note.kidName}`}
                </button>
              </>
            )}
          </div>
        )}

        {/* opt-out flow */}
        {stopId && note.contactId === stopId && (
          <div className="mt-5 rounded-2xl bg-white border-[1.5px] border-[#EDE6DA] p-4 text-center">
            {stopped ? (
              <p className="text-[13.5px] font-bold text-[#0F1F44] m-0">✋ Done — no more notes will be sent to you.</p>
            ) : confirmStop ? (
              <>
                <p className="text-[13.5px] font-bold text-[#0F1F44] m-0 mb-2.5">Stop receiving notes from the {note.familyName} family?</p>
                <button type="button" onClick={doStop} disabled={busy}
                  className="rounded-xl bg-[#0F1F44] px-5 py-2.5 font-black text-[13px] text-white disabled:opacity-60">
                  {busy ? '…' : 'Yes, stop these notes'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmStop(true)}
                className="text-[12px] font-extrabold text-[#5A6488] underline underline-offset-2">
                ✋ Stop receiving these notes
              </button>
            )}
          </div>
        )}

        {!stopId && note.contactId && (
          <div className="mt-4 text-center">
            <button type="button" onClick={() => { setStopId(note.contactId as string); }}
              className="text-[11px] text-[#8B93A9] underline underline-offset-2">
              Stop receiving these notes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
