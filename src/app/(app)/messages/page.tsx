'use client';

// Kaya · Messages (in-app, family-only). Chats list: the Family Group pinned
// on top, then your direct threads (newest first). "New message" opens a
// member picker that starts/opens a 1:1 thread. Family-only by design — the
// member list is exactly the family's user accounts.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  MessageThread, ThreadMember, subscribeThreads, messageableMembers,
  ensureGroupThread, ensureDirectThread, selfMember, threadHeader, isUnread,
  GROUP_THREAD_ID,
} from '@/lib/messaging';
import type { Timestamp } from 'firebase/firestore';

function relTime(t?: Timestamp): string {
  const m = (t as Timestamp | undefined)?.toMillis?.();
  if (!m) return '';
  const diff = Date.now() - m;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Date(m).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Avatar({ value, size = 'w-11 h-11' }: { value: string; size?: string }) {
  const isImg = value.startsWith('http') || value.startsWith('data:');
  return (
    <div className={`${size} rounded-[13px] bg-kaya-gold-light flex items-center justify-center text-xl shrink-0 overflow-hidden`}>
      {isImg
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={value} alt="" className="w-full h-full object-cover" />
        : <span>{value}</span>}
    </div>
  );
}

export default function MessagesPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();
  const familyId = profile?.familyId;
  const uid = profile?.uid;

  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const me = useMemo(() => (profile?.uid ? selfMember(profile, children) : null), [profile, children]);

  useEffect(() => {
    if (!familyId || !uid) return;
    return subscribeThreads(familyId, uid, setThreads);
  }, [familyId, uid]);

  // Load members + keep the family group thread current (idempotent merge).
  useEffect(() => {
    if (!familyId || !uid) return;
    let alive = true;
    messageableMembers(familyId, children).then((mem) => {
      if (!alive) return;
      setMembers(mem);
      if (mem.length > 0) ensureGroupThread(familyId, mem).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [familyId, uid, children]);

  const group = threads.find((t) => t.id === GROUP_THREAD_ID);
  const directs = threads.filter((t) => t.kind === 'direct');
  const others = members.filter((m) => m.uid !== uid);

  const startDirect = async (other: ThreadMember) => {
    if (!familyId || !me || busy) return;
    setBusy(true);
    try {
      const id = await ensureDirectThread(familyId, me, other);
      router.push(`/messages/${id}`);
    } finally { setBusy(false); }
  };

  const Row = ({ thread }: { thread: MessageThread }) => {
    const { title, avatar } = threadHeader(thread, uid || '');
    const unread = isUnread(thread, uid || '');
    return (
      <button type="button" onClick={() => router.push(`/messages/${thread.id}`)}
        className={`w-full flex items-center gap-3 p-3 rounded-kaya border text-left transition-colors ${
          thread.id === GROUP_THREAD_ID ? 'border-kaya-gold bg-kaya-gold-light/40' : 'border-kaya-warm-dark/50 bg-white hover:bg-kaya-warm'
        }`}>
        <Avatar value={avatar} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13.5px] truncate ${unread ? 'font-display font-bold' : 'font-semibold'}`}>{title}</span>
            {thread.id === GROUP_THREAD_ID && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-kaya-gold/40 text-kaya-chocolate">all</span>}
          </div>
          <div className={`text-[12px] truncate mt-0.5 ${unread ? 'text-kaya-chocolate font-semibold' : 'text-kaya-sand'}`}>
            {thread.lastText || 'No messages yet'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-kaya-sand">{relTime(thread.lastAt)}</span>
          {unread && <span className="w-2.5 h-2.5 rounded-full bg-hive-rose" />}
        </div>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display font-extrabold text-[20px] flex items-center gap-2">💬 Messages</h1>
          <p className="text-[12px] text-kaya-sand mt-0.5">Your family, safely inside Kaya · nobody from outside</p>
        </div>
        <button type="button" onClick={() => setPicking((v) => !v)}
          className="h-10 px-4 rounded-kaya-sm bg-kaya-chocolate text-white font-display font-bold text-[13px] hover:brightness-110 transition">
          {picking ? 'Close' : '＋ New'}
        </button>
      </div>

      {picking && (
        <div className="bg-white border border-kaya-warm-dark/60 rounded-kaya p-3 mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-2">Message someone</div>
          {others.length === 0 ? (
            <p className="text-[12.5px] text-kaya-sand py-2">No other family members have a login yet.</p>
          ) : (
            <div className="space-y-1.5">
              {others.map((m) => (
                <button key={m.uid} type="button" disabled={busy} onClick={() => startDirect(m)}
                  className="w-full flex items-center gap-3 p-2 rounded-kaya-sm hover:bg-kaya-warm text-left disabled:opacity-50 transition-colors">
                  <Avatar value={m.avatar || '💬'} size="w-9 h-9" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{m.name}</span>
                    <span className="block text-[11px] text-kaya-sand capitalize">{m.role}</span>
                  </span>
                  <span className="text-kaya-sand">›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {group && <Row thread={group} />}
        {directs.length > 0 && (
          <div className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand pt-3 pb-1 px-1">Direct messages</div>
        )}
        {directs.map((t) => <Row key={t.id} thread={t} />)}
        {!group && directs.length === 0 && (
          <p className="text-[13px] text-kaya-sand text-center py-10">No chats yet — tap <b>＋ New</b> to message a family member.</p>
        )}
      </div>
    </div>
  );
}
