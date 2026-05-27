'use client';

// Kaya · Messages · new group chat. Same form for parents + kids; the submit
// path branches by role:
//   • Parent → createGroupThread() writes the thread doc directly. We redirect
//     into the new thread on success.
//   • Kid    → requestCreateGroupChat() opens a parent-approval request. The
//     thread is created server-side by the resolver on approve. The kid is
//     bounced back to /messages where the pending tile renders the wait.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  type ThreadMember,
  createGroupThread, messageableMembers, selfMember,
} from '@/lib/messaging';
import { requestCreateGroupChat } from '@/lib/hive';

function Avatar({ value, size = 'w-9 h-9' }: { value: string; size?: string }) {
  const isImg = value.startsWith('http') || value.startsWith('data:');
  return (
    <div className={`${size} rounded-[12px] bg-kaya-gold-light flex items-center justify-center text-lg shrink-0 overflow-hidden`}>
      {isImg
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={value} alt="" className="w-full h-full object-cover" />
        : <span>{value}</span>}
    </div>
  );
}

export default function NewGroupPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();
  const familyId = profile?.familyId;
  const uid = profile?.uid;
  const isKid = profile?.role === 'kid';

  const me = useMemo(() => (profile?.uid ? selfMember(profile, children) : null), [profile, children]);

  const [allMembers, setAllMembers] = useState<ThreadMember[]>([]);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!familyId) return;
    let alive = true;
    messageableMembers(familyId, children).then((mem) => { if (alive) setAllMembers(mem); }).catch(() => {});
    return () => { alive = false; };
  }, [familyId, children]);

  // Member picker scope:
  //  • Parent → show every family member with a login (parent / kid / helper).
  //  • Kid    → hide helpers (per design — kids can't pull non-family adults in
  //    without parent involvement). Parents in the list ARE selectable.
  const pickable = useMemo(() => {
    const list = allMembers.filter((m) => m.uid !== uid);
    return isKid ? list.filter((m) => m.role !== 'helper') : list;
  }, [allMembers, uid, isKid]);

  const togglePick = (uid2: string) => {
    setPicked((p) => ({ ...p, [uid2]: !p[uid2] }));
    setError('');
  };

  const selected = pickable.filter((m) => picked[m.uid]);
  const canSubmit = title.trim().length > 0 && selected.length >= 1 && !busy && !!familyId && !!me;

  const submit = async () => {
    if (!canSubmit || !familyId || !me) return;
    setBusy(true); setError('');
    try {
      if (isKid && profile?.childId) {
        await requestCreateGroupChat(
          familyId,
          profile.childId,
          title,
          // Always include the kid themselves in the proposed members — the
          // parent shouldn't have to remember to add them.
          [me, ...selected],
          profile.uid,
        );
        router.push('/messages');
        return;
      }
      // Parent path — create the thread directly + open it.
      const threadId = await createGroupThread(familyId, me, title, selected);
      router.push(`/messages/${threadId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the group.');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-[12px] bg-kaya-gold-light flex items-center justify-center text-xl">✨</div>
        <div>
          <h1 className="font-display font-extrabold text-[18px] leading-tight">Start a new group</h1>
          <p className="text-[12px] text-kaya-sand mt-0.5">
            {isKid ? 'A parent will review before it goes live.' : 'Name it, pick members, done.'}
          </p>
        </div>
      </div>

      <div className="bg-white border border-kaya-warm-dark/50 rounded-kaya p-4 mb-3">
        <label htmlFor="g-name" className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1.5">Group name</label>
        <input id="g-name" value={title} maxLength={60} onChange={(e) => { setTitle(e.target.value); setError(''); }}
          placeholder="e.g. Weekend planning"
          className="w-full h-11 px-3 bg-kaya-warm rounded-kaya-sm border border-kaya-warm-dark/40 text-[14px] font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/50" />
        <p className="text-[11px] text-kaya-sand mt-1.5">Max 60 characters.</p>
      </div>

      <div className="bg-white border border-kaya-warm-dark/50 rounded-kaya p-4 mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-2">Who's in?</div>
        {pickable.length === 0 ? (
          <p className="text-[12.5px] text-kaya-sand py-2">No other family members have a login yet.</p>
        ) : (
          <div className="space-y-1.5">
            {pickable.map((m) => {
              const on = !!picked[m.uid];
              return (
                <button key={m.uid} type="button" onClick={() => togglePick(m.uid)} aria-pressed={on}
                  className={`w-full flex items-center gap-3 p-2 rounded-kaya-sm border text-left transition-colors ${
                    on ? 'bg-kaya-gold-light/60 border-kaya-gold' : 'bg-white border-kaya-warm-dark/30 hover:bg-kaya-warm'
                  }`}>
                  <Avatar value={m.avatar || '👤'} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{m.name}</span>
                    <span className="block text-[11px] text-kaya-sand capitalize">{m.role}</span>
                  </span>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-black ${on ? 'bg-kaya-chocolate' : 'bg-transparent border-2 border-kaya-warm-dark/40'}`}>
                    {on ? '✓' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-kaya-sand mt-2">{selected.length} {selected.length === 1 ? 'person' : 'people'} picked{isKid ? ' (you\'re in by default)' : ''}.</p>
      </div>

      {error && <p className="text-hive-rose text-[12.5px] font-bold mb-2">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.push('/messages')} disabled={busy}
          className="h-11 px-4 rounded-kaya-sm bg-white border border-kaya-warm-dark/50 text-kaya-chocolate font-display font-bold text-[13px] hover:bg-kaya-warm transition disabled:opacity-50">
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={!canSubmit}
          className="flex-1 h-11 rounded-kaya-sm bg-kaya-chocolate text-white font-display font-bold text-[13px] hover:brightness-110 transition disabled:opacity-50">
          {busy ? (isKid ? 'Sending…' : 'Creating…') : (isKid ? 'Ask a parent ✨' : 'Create group')}
        </button>
      </div>
    </div>
  );
}
