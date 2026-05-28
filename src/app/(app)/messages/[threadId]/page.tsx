'use client';

// Kaya · Message thread. Family group or a 1:1 chat. Text + attachments
// (photo / video / document; voice arrives in M2). Messages are append-only.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Message, MessageThread, Attachment, ThreadMember,
  subscribeThread, subscribeMessages, sendMessage, markThreadRead, selfMember, threadHeader,
  seenByUids, readAtFor, otherMember, setTyping, typingNames, subscribePresence, lastSeenText, isOnline,
  messagePreview, setThreadTitle, messageableMembers, addThreadMember, removeThreadMember,
} from '@/lib/messaging';
import { notifyNewMessage } from '@/lib/notify';
import { uploadMessagePhoto, uploadMessageVideo, uploadMessageDocument, uploadMessageVoice } from '@/lib/messagingUpload';
import CameraCaptureSheet from '@/components/messaging/CameraCaptureSheet';
import type { Timestamp } from 'firebase/firestore';

// Curated, kid-friendly emoji set — no heavy picker dependency.
const EMOJIS = '😀 😄 😁 😆 😂 🤣 😊 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 🤗 🤔 😴 😮 😯 😢 😭 😤 😡 👍 👎 👏 🙌 🙏 👌 🤝 💪 ✌️ 🤞 👋 ❤️ 🧡 💛 💚 💙 💜 ✨ ⭐ 🌟 🔥 💯 🎉 🎊 🎁 🐝 🐶 🐱 🦄 🌈 🌸 🌻 ☀️ 🍯 🍅 🍎 🍌 🍓 🍕 🍪 🍦 ⚽ 🏀 🎮 📚 💰 🪙 🛒 ✅'.split(' ');

const clock = (t?: Timestamp): string => {
  const m = (t as Timestamp | undefined)?.toMillis?.();
  return m ? new Date(m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
};
const prettyBytes = (n?: number): string => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const mmss = (s?: number): string => {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60); const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const MAX_VOICE_SECONDS = 120;

export default function MessageThreadPage() {
  const params = useParams();
  const threadId = String(params?.threadId || '');
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId;
  const uid = profile?.uid || '';
  const familyName = (family as { name?: string } | null | undefined)?.name;

  const [thread, setThread] = useState<MessageThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  // 2026-05-27 — new camera-first attach paths. Open the same component in
  // two modes; the sheet handles capture + AI enhance + multi-page state.
  const [cameraMode, setCameraMode] = useState<'photo' | 'scan' | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [otherPresence, setOtherPresence] = useState<{ lastActiveAt?: Timestamp; showPresence: boolean }>({ showPresence: false });
  const [now, setNow] = useState(() => Date.now());

  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef(0);
  const cancelledRef = useRef(false);
  const typingSentRef = useRef(0);

  const me = useMemo(() => (profile?.uid ? selfMember(profile, children) : null), [profile, children]);
  const myShareReceipts = profile?.messagingPrivacy?.showReceipts !== false;
  const myShareTyping = profile?.messagingPrivacy?.showTyping !== false;
  const otherUid = useMemo(
    () => (thread?.kind === 'direct' ? thread.members?.find((m) => m.uid !== uid)?.uid : undefined),
    [thread?.id, thread?.kind, uid], // members are stable per thread
  );

  useEffect(() => {
    if (!familyId || !threadId) return;
    const u1 = subscribeThread(familyId, threadId, setThread);   // live `reads` → receipts
    const u2 = subscribeMessages(familyId, threadId, setMessages);
    return () => { u1(); u2(); };
  }, [familyId, threadId]);

  // Mark read whenever the latest message isn't mine (respecting my receipt choice).
  useEffect(() => {
    if (!familyId || !threadId || !uid || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.senderUid !== uid) markThreadRead(familyId, threadId, uid, myShareReceipts).catch(() => {});
  }, [familyId, threadId, uid, messages, myShareReceipts]);

  // Live presence of the other member (direct threads).
  useEffect(() => {
    if (!otherUid) { setOtherPresence({ showPresence: false }); return; }
    return subscribePresence(otherUid, setOtherPresence);
  }, [otherUid]);

  // Ticker so "typing…" / "last seen" expire + refresh on their own.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(iv);
  }, []);

  // Clear my typing marker when I leave the thread.
  useEffect(() => () => { if (familyId && uid) setTyping(familyId, threadId, uid, false).catch(() => {}); }, [familyId, threadId, uid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending.length]);

  // Stop recording + free the mic if we leave mid-record.
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const header = thread ? threadHeader(thread, uid, familyName) : { title: 'Messages', avatar: '💬' };
  const isGroup = thread?.kind === 'group';
  const isParent = profile?.role === 'parent';
  const isOwnGroup = thread?.createdByUid && thread.createdByUid === uid;
  // Parents can rename any group; an owner kid can rename their own custom
  // group (matches the design — they can't add/remove members without a fresh
  // approval, but renaming is allowed). Direct threads have no editable name.
  const canEditChatInfo = isGroup && (isParent || isOwnGroup);

  // "Edit chat info" sheet state.
  const [infoOpen, setInfoOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleErr, setTitleErr] = useState('');
  // Member curation (parent-only) — add/remove flow in the same sheet.
  const canCurateMembers = isGroup && isParent;
  const [addingMember, setAddingMember] = useState(false);
  const [allFamilyMembers, setAllFamilyMembers] = useState<ThreadMember[]>([]);
  const [memberBusy, setMemberBusy] = useState<string | null>(null); // uid being mutated
  const [memberErr, setMemberErr] = useState('');
  useEffect(() => {
    // Seed the input from the live thread.title (empty string for the family
    // chat default shows the auto label rather than overwriting it).
    setEditTitle(thread?.title || '');
  }, [thread?.title]);
  // Load the family roster lazily — only when a parent opens the add-picker.
  useEffect(() => {
    if (!familyId || !addingMember) return;
    let alive = true;
    messageableMembers(familyId, children).then((mem) => { if (alive) setAllFamilyMembers(mem); }).catch(() => {});
    return () => { alive = false; };
  }, [familyId, children, addingMember]);
  const saveTitle = async () => {
    if (!familyId || !thread || !canEditChatInfo) return;
    setSavingTitle(true); setTitleErr('');
    try {
      await setThreadTitle(familyId, thread.id, editTitle);
      setInfoOpen(false);
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : 'Could not save the name.');
    } finally {
      setSavingTitle(false);
    }
  };
  const onRemoveMember = async (m: ThreadMember) => {
    if (!familyId || !thread || !canCurateMembers) return;
    setMemberErr(''); setMemberBusy(m.uid);
    try { await removeThreadMember(familyId, thread.id, m.uid); }
    catch (e) { setMemberErr(e instanceof Error ? e.message : 'Could not remove.'); }
    finally { setMemberBusy(null); }
  };
  const onAddMember = async (m: ThreadMember) => {
    if (!familyId || !thread || !canCurateMembers) return;
    setMemberErr(''); setMemberBusy(m.uid);
    try { await addThreadMember(familyId, thread.id, m); setAddingMember(false); }
    catch (e) { setMemberErr(e instanceof Error ? e.message : 'Could not add.'); }
    finally { setMemberBusy(null); }
  };
  // Family roster minus members already in the thread = the add-picker list.
  const candidates = allFamilyMembers.filter((m) => !(thread?.memberUids ?? []).includes(m.uid));

  const addFiles = async (files: FileList | File[] | null, up: (f: File) => Promise<Attachment>) => {
    setAttachOpen(false);
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0) || !familyId) return;
    setError(''); setUploading(true);
    try {
      const out: Attachment[] = [];
      const arr: File[] = Array.isArray(files) ? files : Array.from(files);
      for (const f of arr) out.push(await up(f));
      setPending((p) => [...p, ...out.filter((a) => a.url)]);
    } catch (e: any) {
      setError(e?.message || 'Could not attach that file.');
    } finally { setUploading(false); }
  };

  // ── Voice notes (MediaRecorder) ──
  const stopRecTimer = () => { if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; } };
  const releaseStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };

  const startRecording = async () => {
    setAttachOpen(false); setEmojiOpen(false); setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice notes aren’t supported on this device.'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = []; cancelledRef.current = false;
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stopRecTimer(); releaseStream(); setRecording(false);
        if (cancelledRef.current) { cancelledRef.current = false; chunksRef.current = []; return; }
        const dur = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        chunksRef.current = [];
        setUploading(true);
        try {
          const att = await uploadMessageVoice(familyId!, threadId, blob, dur);
          if (att.url) setPending((p) => [...p, att]);
        } catch (e: any) { setError(e?.message || 'Could not save the voice note.'); }
        finally { setUploading(false); }
      };
      mr.start();
      recorderRef.current = mr;
      recStartRef.current = Date.now();
      setRecSeconds(0); setRecording(true);
      recTimerRef.current = setInterval(() => {
        const s = Math.round((Date.now() - recStartRef.current) / 1000);
        setRecSeconds(s);
        if (s >= MAX_VOICE_SECONDS && recorderRef.current?.state === 'recording') recorderRef.current.stop();
      }, 250);
    } catch {
      setError('Microphone permission is needed for voice notes.');
      releaseStream();
    }
  };
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };
  const cancelRecording = () => { cancelledRef.current = true; if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };

  const send = async () => {
    if (!familyId || !me || sending) return;
    if (!text.trim() && pending.length === 0) return;
    const sentText = text; const sentAttachments = pending;
    setSending(true); setError('');
    try {
      await sendMessage(familyId, threadId, { text, attachments: pending }, me);
      setText(''); setPending([]);
      typingSentRef.current = 0;
      if (myShareTyping) setTyping(familyId, threadId, uid, false).catch(() => {});
      // Notify the other members — in-app bell + push (best-effort).
      if (thread) {
        notifyNewMessage({
          familyId, threadId,
          recipientUids: (thread.memberUids || []).filter((u) => u !== uid),
          senderName: me.name,
          preview: messagePreview(sentText, sentAttachments),
          isGroup: thread.kind === 'group',
          groupTitle: thread.title,
        }).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || 'Could not send.');
    } finally { setSending(false); }
  };

  // Throttled typing signal (only if I share it).
  const onChangeText = (v: string) => {
    setText(v);
    if (!familyId || !myShareTyping) return;
    const t = Date.now();
    if (v.trim() && t - typingSentRef.current > 2500) { typingSentRef.current = t; setTyping(familyId, threadId, uid, true).catch(() => {}); }
  };

  const insertEmoji = (e: string) => { setText((t) => (t + e).slice(0, 2000)); inputRef.current?.focus(); };

  // Read receipt for my latest sent message (uses the per-thread `reads` map).
  const myLastMsg = useMemo(() => [...messages].reverse().find((m) => m.senderUid === uid), [messages, uid]);
  const receiptText = useMemo(() => {
    if (!thread || !myLastMsg) return '';
    const seen = seenByUids(thread, myLastMsg.createdAt, uid);
    if (thread.kind === 'group') {
      const others = (thread.memberUids || []).filter((u) => u !== uid);
      if (others.length === 0) return '';
      if (seen.length === 0) return 'Sent';
      return seen.length >= others.length ? 'Seen by all ✓✓' : `Seen by ${seen.length} ✓✓`;
    }
    const other = otherMember(thread, uid);
    if (other && seen.includes(other.uid)) { const t = clock(readAtFor(thread, other.uid)); return t ? `Seen ${t} ✓✓` : 'Seen ✓✓'; }
    return 'Sent ✓';
  }, [thread, myLastMsg, uid]);

  const Att = ({ a, mine }: { a: Attachment; mine: boolean }) => {
    if (a.kind === 'photo') {
      return (
        <button type="button" onClick={() => setZoom(a.url)} className="block rounded-[12px] overflow-hidden max-w-[220px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.url} alt="" className="w-full h-auto object-cover" />
        </button>
      );
    }
    if (a.kind === 'video') return <video src={a.url} controls playsInline className="rounded-[12px] max-w-[240px] bg-black" />;
    if (a.kind === 'voice') return (
      <div className="flex items-center gap-2">
        <span className="text-base shrink-0">🎤</span>
        <audio src={a.url} controls className="h-9 w-[190px]" />
        {a.durationSec ? <span className={`text-[10.5px] shrink-0 ${mine ? 'text-white/70' : 'text-kaya-sand'}`}>{mmss(a.durationSec)}</span> : null}
      </div>
    );
    // Tap a doc → open it in a new tab. The browser handles inline
    // viewing (PDF) or download (docx/xlsx/etc.) based on MIME type.
    // Force-fetching a blob and triggering `<a download>` (the previous
    // path) silently fails on iOS Safari / PWA contexts, which is why
    // taps appeared to do nothing.
    return (
      <a
        href={a.url}
        target="_blank"
        rel="noopener noreferrer"
        download={a.name || undefined}
        className={`flex items-center gap-2.5 rounded-[12px] p-2.5 max-w-[240px] text-left ${mine ? 'bg-white/15' : 'bg-kaya-warm'}`}>
        <span className="w-9 h-10 rounded-[6px] bg-white border border-kaya-warm-dark/40 flex items-center justify-center text-base shrink-0">📄</span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-bold truncate">{a.name || 'Document'}</span>
          <span className={`block text-[10.5px] ${mine ? 'text-white/70' : 'text-kaya-sand'}`}>{prettyBytes(a.sizeBytes)}</span>
        </span>
      </a>
    );
  };

  const typers = thread ? typingNames(thread, uid, now) : [];
  const typingLabel = typers.length === 0 ? ''
    : typers.length === 1 ? `${typers[0]} is typing…`
    : typers.length === 2 ? `${typers[0]} & ${typers[1]} are typing…`
    : 'Several people are typing…';
  const online = !isGroup && otherPresence.showPresence && isOnline(otherPresence.lastActiveAt, now);
  const headerSubtitle = typingLabel
    || (isGroup ? `${thread?.memberUids?.length || 0} members`
                : (otherPresence.showPresence && lastSeenText(otherPresence.lastActiveAt, now)) || 'Direct message · just you two');

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-6 flex flex-col" style={{ minHeight: '60vh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b border-kaya-warm-dark/50">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-[12px] bg-kaya-gold-light flex items-center justify-center text-xl overflow-hidden">
            {header.avatar.startsWith('http') || header.avatar.startsWith('data:')
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={header.avatar} alt="" className="w-full h-full object-cover" />
              : <span>{header.avatar}</span>}
          </div>
          {online && <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-pantry-leaf border-2 border-kaya-cream" title="Online" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-bold text-[15px] truncate">{header.title}</div>
          <div className={`text-[11px] truncate ${typingLabel ? 'text-pantry-leaf font-bold' : online ? 'text-pantry-leaf font-semibold' : 'text-kaya-sand'}`}>
            {headerSubtitle}
          </div>
        </div>
        {canEditChatInfo && (
          <button type="button" onClick={() => setInfoOpen((v) => !v)} aria-label="Edit chat info"
            className="w-9 h-9 rounded-full bg-white border border-kaya-warm-dark/50 text-kaya-chocolate text-base flex items-center justify-center hover:bg-kaya-warm transition shrink-0">
            ⚙
          </button>
        )}
      </div>

      {/* Edit chat info — rename + member list. Parents on any group; an owner
          kid on the group they created. Renaming the family chat to an empty
          string reverts to the auto "[Surname] Family" / "Family Chat" default. */}
      {infoOpen && thread && (
        <div className="bg-white border border-kaya-warm-dark/50 rounded-kaya p-4 mb-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-2">Edit chat info</div>
          <label htmlFor="rename-input" className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">Chat name</label>
          <input id="rename-input" value={editTitle} maxLength={60}
            onChange={(e) => { setEditTitle(e.target.value); setTitleErr(''); }}
            placeholder={thread.isFamilyChat ? 'Leave blank for the default' : 'Group name'}
            className="w-full h-11 px-3 bg-kaya-warm rounded-kaya-sm border border-kaya-warm-dark/40 text-[14px] font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/50" />
          <p className="text-[11px] text-kaya-sand mt-1.5">
            {thread.isFamilyChat
              ? 'Empty = use the family default name. Up to 60 characters.'
              : 'Up to 60 characters.'}
          </p>

          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-kaya-sand">Members</span>
            <span className="text-[11px] text-kaya-sand">{thread.members?.length ?? 0} in</span>
          </div>
          <div className="space-y-1 mt-1.5">
            {(thread.members || []).map((m) => {
              const isOnlyParent = thread.isFamilyChat && m.role === 'parent'
                && (thread.members || []).filter((x) => x.role === 'parent').length <= 1;
              return (
                <div key={m.uid} className="flex items-center gap-2 text-[12.5px] p-1.5 rounded-kaya-sm">
                  <span className="w-7 h-7 rounded-[8px] bg-kaya-gold-light flex items-center justify-center text-base overflow-hidden">
                    {m.avatar && (m.avatar.startsWith('http') || m.avatar.startsWith('data:'))
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                      : <span>{m.avatar || '👤'}</span>}
                  </span>
                  <span className="font-semibold flex-1 min-w-0 truncate">{m.name}</span>
                  <span className="text-kaya-sand capitalize text-[11px]">· {m.role}</span>
                  {canCurateMembers && !isOnlyParent && m.uid !== uid && (
                    <button type="button" onClick={() => onRemoveMember(m)} disabled={memberBusy === m.uid}
                      aria-label={`Remove ${m.name}`}
                      className="ml-1 w-6 h-6 rounded-full bg-white border border-kaya-warm-dark/40 text-hive-rose text-[12px] font-bold hover:bg-kaya-warm transition disabled:opacity-50">
                      {memberBusy === m.uid ? '…' : '×'}
                    </button>
                  )}
                  {canCurateMembers && isOnlyParent && (
                    <span className="text-[9.5px] text-kaya-sand font-bold uppercase tracking-wider ml-1">last parent</span>
                  )}
                </div>
              );
            })}
          </div>

          {canCurateMembers && (
            <div className="mt-2">
              {!addingMember ? (
                <button type="button" onClick={() => setAddingMember(true)}
                  className="w-full h-10 rounded-kaya-sm bg-white border border-dashed border-kaya-gold/60 text-kaya-chocolate font-display font-bold text-[12.5px] hover:bg-kaya-gold-light/30 transition">
                  ＋ Add a member
                </button>
              ) : (
                <div className="rounded-kaya-sm border border-kaya-warm-dark/40 bg-kaya-warm/40 p-2">
                  <div className="flex items-baseline justify-between mb-1.5 px-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-kaya-sand">Add who?</span>
                    <button type="button" onClick={() => setAddingMember(false)}
                      className="text-[11px] font-bold text-kaya-sand hover:text-kaya-chocolate">Cancel</button>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="text-[12px] text-kaya-sand text-center py-2">Everyone in the family is already in.</p>
                  ) : (
                    <div className="space-y-1">
                      {candidates.map((m) => (
                        <button key={m.uid} type="button" onClick={() => onAddMember(m)} disabled={memberBusy === m.uid}
                          className="w-full flex items-center gap-2 p-1.5 rounded-kaya-sm bg-white border border-kaya-warm-dark/30 hover:bg-kaya-warm text-left transition disabled:opacity-50">
                          <span className="w-7 h-7 rounded-[8px] bg-kaya-gold-light flex items-center justify-center text-base overflow-hidden">
                            {m.avatar && (m.avatar.startsWith('http') || m.avatar.startsWith('data:'))
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                              : <span>{m.avatar || '👤'}</span>}
                          </span>
                          <span className="font-semibold text-[12.5px] flex-1 truncate">{m.name}</span>
                          <span className="text-kaya-sand capitalize text-[11px]">· {m.role}</span>
                          <span className="text-kaya-gold-dk font-bold">+</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {memberErr && <p className="text-hive-rose text-[12px] font-bold mt-3">{memberErr}</p>}
          {titleErr && <p className="text-hive-rose text-[12px] font-bold mt-3">{titleErr}</p>}

          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => { setEditTitle(thread.title || ''); setInfoOpen(false); }}
              className="h-11 px-4 rounded-kaya-sm bg-white border border-kaya-warm-dark/50 text-kaya-chocolate font-display font-bold text-[12.5px] hover:bg-kaya-warm transition">
              Cancel
            </button>
            <button type="button" onClick={saveTitle} disabled={savingTitle}
              className="flex-1 h-11 rounded-kaya-sm bg-kaya-chocolate text-white font-display font-bold text-[12.5px] hover:brightness-110 transition disabled:opacity-50">
              {savingTitle ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 space-y-2">
        {messages.length === 0 && (
          <p className="text-[12.5px] text-kaya-sand text-center py-10">No messages yet — say hello 👋</p>
        )}
        {messages.map((m) => {
          const mine = m.senderUid === uid;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              {isGroup && !mine && <span className="text-[10px] font-bold text-kaya-chocolate/70 mb-0.5 ml-1">{m.senderName}</span>}
              <div className={`max-w-[80%] rounded-[15px] px-3 py-2 ${mine ? 'bg-kaya-chocolate text-white rounded-br-[5px]' : 'bg-white border border-kaya-warm-dark/50 rounded-bl-[5px]'}`}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="space-y-1.5 mb-1">{m.attachments.map((a, i) => <Att key={i} a={a} mine={mine} />)}</div>
                )}
                {m.text && <p className="text-[13px] leading-snug whitespace-pre-wrap break-words">{m.text}</p>}
              </div>
              <span className="text-[9.5px] text-kaya-sand mt-0.5 mx-1">
                {clock(m.createdAt)}
                {mine && m.id === myLastMsg?.id && receiptText ? ` · ${receiptText}` : ''}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Pending attachments */}
      {(pending.length > 0 || uploading) && (
        <div className="flex flex-wrap gap-2 py-2 border-t border-kaya-warm-dark/40 mt-2">
          {pending.map((a, i) => (
            <div key={i} className="relative">
              {a.kind === 'photo'
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={a.url} alt="" className="w-14 h-14 rounded-kaya-sm object-cover border border-kaya-warm-dark/40" />
                : <div className="w-14 h-14 rounded-kaya-sm bg-kaya-warm border border-kaya-warm-dark/40 flex flex-col items-center justify-center text-xl leading-none">
                    {a.kind === 'video' ? '🎬' : a.kind === 'voice' ? '🎤' : '📄'}
                    {a.kind === 'voice' && a.durationSec ? <span className="text-[9px] font-bold text-kaya-sand mt-0.5">{mmss(a.durationSec)}</span> : null}
                  </div>}
              <button type="button" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-hive-rose text-white text-[11px] flex items-center justify-center border-2 border-white">✕</button>
            </div>
          ))}
          {uploading && <div className="w-14 h-14 rounded-kaya-sm bg-kaya-warm flex items-center justify-center text-[10px] text-kaya-sand">…</div>}
        </div>
      )}

      {error && <p className="text-hive-rose text-[12px] font-bold py-1">{error}</p>}

      {/* Attach sheet — 2026-05-27: 4 → 6 tiles. Camera-first paths (Scan +
          Take photo with AI enhance) now sit alongside the existing Gallery
          (was "Photo") / Video / Voice / Document. */}
      {attachOpen && (
        <div className="grid grid-cols-3 gap-2 py-2.5 border-t border-kaya-warm-dark/40">
          {[
            { ic: '📄', label: 'Scan', sub: 'document', isNew: true, on: () => { setAttachOpen(false); setCameraMode('scan'); } },
            { ic: '📷', label: 'Take photo', sub: 'AI enhance', isNew: true, on: () => { setAttachOpen(false); setCameraMode('photo'); } },
            { ic: '🖼', label: 'Gallery', sub: undefined, isNew: false, on: () => photoRef.current?.click() },
            { ic: '🎬', label: 'Video', sub: undefined, isNew: false, on: () => videoRef.current?.click() },
            { ic: '🎤', label: 'Voice', sub: undefined, isNew: false, on: startRecording },
            { ic: '📎', label: 'File', sub: 'PDF, .docx', isNew: false, on: () => docRef.current?.click() },
          ].map((o) => (
            <button key={o.label} type="button" onClick={o.on}
              className={`relative flex flex-col items-center gap-1 py-3 rounded-kaya text-[11px] font-bold text-kaya-sand ${o.isNew ? 'bg-kaya-gold-light/40 border border-kaya-gold/60' : 'bg-white border border-kaya-warm-dark/50'}`}>
              {o.isNew && (
                <span className="absolute top-1 right-1.5 text-[8px] font-black uppercase tracking-wider bg-kaya-chocolate text-white px-1 py-0.5 rounded">New</span>
              )}
              <span className="text-2xl">{o.ic}</span>
              <span className="font-black text-kaya-chocolate">{o.label}</span>
              {o.sub && <span className="text-[9.5px] text-kaya-sand">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Camera capture sheet — full-screen overlay; same component for
          "Take photo" and "Scan", differs only in enhance pipeline + multi-
          page state. Sends through the existing addFiles → uploadMessagePhoto. */}
      <CameraCaptureSheet
        open={cameraMode !== null}
        mode={cameraMode ?? 'photo'}
        onClose={() => setCameraMode(null)}
        onConfirm={async (files) => {
          if (!familyId) return;
          // Re-use the same addFiles path so attachments queue + send like
          // every other photo. Each captured page becomes its own message
          // attachment in v1; PDF assembly follows in a later PR.
          await addFiles(files, (f) => uploadMessagePhoto(familyId, threadId, f));
        }}
      />

      {/* Emoji picker */}
      {emojiOpen && (
        <div className="py-2 border-t border-kaya-warm-dark/40 max-h-[168px] overflow-y-auto">
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => insertEmoji(e)}
                className="h-9 rounded-kaya-sm hover:bg-kaya-warm text-[20px] flex items-center justify-center transition-colors">{e}</button>
            ))}
          </div>
        </div>
      )}

      {/* Recording bar */}
      {recording && (
        <div className="flex items-center gap-3 py-2.5 border-t border-kaya-warm-dark/40">
          <span className="w-3 h-3 rounded-full bg-hive-rose animate-pulse shrink-0" />
          <span className="text-[13px] font-bold text-kaya-chocolate">Recording… {mmss(recSeconds)}</span>
          <span className="flex-1" />
          <button type="button" onClick={cancelRecording}
            className="h-9 px-3 rounded-full bg-white border border-kaya-warm-dark/60 text-kaya-sand text-[12px] font-bold">Cancel</button>
          <button type="button" onClick={stopRecording}
            className="h-9 px-4 rounded-full bg-kaya-chocolate text-white text-[12px] font-black">Stop &amp; attach</button>
        </div>
      )}

      {/* Composer */}
      <div className="sticky bottom-0 bg-kaya-cream pt-2 pb-3 flex items-center gap-2">
        <button type="button" onClick={() => { setAttachOpen((v) => !v); setEmojiOpen(false); }}
          className="w-10 h-10 rounded-full bg-white border border-kaya-warm-dark/60 text-kaya-chocolate text-lg flex items-center justify-center shrink-0">＋</button>
        <input ref={inputRef} value={text} onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message…" maxLength={2000}
          className="flex-1 h-11 px-4 bg-white rounded-full border border-kaya-warm-dark/60 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-kaya-gold/50" />
        <button type="button" onClick={() => { setEmojiOpen((v) => !v); setAttachOpen(false); }}
          aria-label="Emoji"
          className={`w-10 h-10 rounded-full border text-lg flex items-center justify-center shrink-0 transition-colors ${emojiOpen ? 'bg-kaya-gold-light border-kaya-gold-dark' : 'bg-white border-kaya-warm-dark/60'}`}>😊</button>
        <button type="button" onClick={send} disabled={sending || (!text.trim() && pending.length === 0)}
          className="w-11 h-11 rounded-full bg-kaya-chocolate text-white text-lg flex items-center justify-center shrink-0 disabled:opacity-40 hover:brightness-110 transition">➤</button>
      </div>

      <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files, (f) => uploadMessagePhoto(familyId!, threadId, f))} />
      <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => addFiles(e.target.files, (f) => uploadMessageVideo(familyId!, threadId, f))} />
      <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf" className="hidden" onChange={(e) => addFiles(e.target.files, (f) => uploadMessageDocument(familyId!, threadId, f))} />

      {zoom && (
        <div onClick={() => setZoom(null)} className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full rounded-kaya" />
        </div>
      )}
    </div>
  );
}
