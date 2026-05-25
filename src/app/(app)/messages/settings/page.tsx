'use client';

// Kaya · Messages → Privacy choices (per user). Control what you share:
// online/last-seen, typing, and read receipts. Each saves immediately.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { setMessagingPrivacy } from '@/lib/messaging';

export default function MessagingSettingsPage() {
  const { profile } = useAuth();
  const uid = profile?.uid;

  const [presence, setPresence] = useState(true);
  const [typing, setTyping] = useState(true);
  const [receipts, setReceipts] = useState(true);
  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current || !profile) return;
    loadedRef.current = true;
    const p = profile.messagingPrivacy || {};
    setPresence(p.showPresence !== false);
    setTyping(p.showTyping !== false);
    setReceipts(p.showReceipts !== false);
  }, [profile]);

  const persist = async (next: { showPresence: boolean; showTyping: boolean; showReceipts: boolean }) => {
    if (!uid) return;
    setSaving(true);
    try { await setMessagingPrivacy(uid, next); } finally { setSaving(false); }
  };

  const Row = ({ on, set, keyName, title, desc }: { on: boolean; set: (v: boolean) => void; keyName: 'presence' | 'typing' | 'receipts'; title: string; desc: string }) => (
    <button type="button"
      onClick={() => {
        const v = !on; set(v);
        persist({
          showPresence: keyName === 'presence' ? v : presence,
          showTyping: keyName === 'typing' ? v : typing,
          showReceipts: keyName === 'receipts' ? v : receipts,
        });
      }}
      className="w-full flex items-center justify-between gap-3 bg-white border border-kaya-warm-dark rounded-kaya p-4 text-left">
      <span className="min-w-0">
        <span className="block font-bold text-[14px]">{title}</span>
        <span className="block text-[11px] text-kaya-sand mt-0.5 leading-relaxed">{desc}</span>
      </span>
      <span className={`w-[46px] h-[26px] rounded-full relative shrink-0 transition-colors ${on ? 'bg-pantry-leaf' : 'bg-kaya-warm-dark'}`}>
        <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[23px]' : 'left-[3px]'}`} />
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <h1 className="font-display font-extrabold text-[20px] flex items-center gap-2">🔒 Message privacy</h1>
      <p className="text-[12px] text-kaya-sand mt-0.5 mb-4">Choose what you share with your family in chat. {saving ? '· Saving…' : ''}</p>

      <div className="space-y-3">
        <Row on={presence} set={setPresence} keyName="presence" title="Show when I'm online"
          desc="Family can see if you're active now, or your last-seen time." />
        <Row on={typing} set={setTyping} keyName="typing" title="Show when I'm typing"
          desc="Family see “typing…” while you write a message." />
        <Row on={receipts} set={setReceipts} keyName="receipts" title="Send read receipts"
          desc="Family see when you've read their message. You'll still see theirs." />
      </div>

      <p className="text-[10.5px] text-kaya-sand mt-4 leading-relaxed">
        These are your choices and only affect what others see about you. Turning one off keeps everything working for you — it just hides that signal from others.
      </p>
    </div>
  );
}
