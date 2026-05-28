'use client';

// Kaya Guide — the floating, app-wide help bubble (everyone: kids + parents).
//
// A small button sits in the corner on every app screen. Tapping it opens a
// chat drawer where anyone can ask how the app works. It calls
// /api/guidance-chat, which adapts its tone to the asker's role and the screen
// they're on. Conversations are logged to Firestore (see lib/guide) so a
// parent can review what was asked. Degrades to a friendly note when the AI
// key isn't configured.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircleQuestion, X, Send, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { saveGuideChat, newConversationId, type GuideRole, type GuideTurn } from '@/lib/guide';

// Map the current route to a friendly section name the API uses for context.
// Longest prefixes first so e.g. /pulse/today resolves before a bare /pulse.
const MODULE_BY_PREFIX: Array<[string, string]> = [
  ['/hive', 'Kaya Hive'],
  ['/pulse', 'Kaya Pulse'],
  ['/sparks', 'Kaya Sparks'],
  ['/business', 'Business'],
  ['/messages', 'Messages'],
  ['/moments', 'Moments'],
  ['/pantry', 'Pantry'],
  ['/meetings', 'Family Meetings'],
  ['/workplan', 'Workplan'],
  ['/rate', 'Rate the day'],
  ['/rewards', 'Rewards'],
  ['/admin', 'Admin'],
  ['/settings', 'Settings'],
  ['/notifications', 'Notifications'],
  ['/home', 'Home'],
];

function moduleNameFor(pathname: string | null): string {
  if (!pathname) return 'Home';
  const hit = MODULE_BY_PREFIX.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : 'Home';
}

// First thing a kid vs. a parent sees — sets the right tone before they type.
function greetingFor(role: GuideRole, name: string, mod: string): string {
  const who = name ? `, ${name}` : '';
  if (role === 'kid') {
    return `Hi${who}! 🐝 I'm Kaya Guide. Ask me anything — like "how do I earn points?" or "what is the Hive?"`;
  }
  return `Hi${who} — I'm Kaya Guide. Ask me how anything in Kaya works. You're on ${mod} right now, so I'll assume questions are about it unless you say otherwise.`;
}

const STARTERS_KID = ['How do I earn points?', 'What is the Hive?', 'Where are my rewards?'];
const STARTERS_ADULT = ['How does rating the day work?', 'What is Kaya Pulse?', 'How do I invite family?'];

interface UiMsg extends GuideTurn { id: string }

export default function KayaGuide() {
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const pathname = usePathname();

  const role: GuideRole = isGuest ? 'guest' : ((profile?.role as GuideRole) || 'parent');
  const displayName = (profile?.displayName || '').split(' ')[0] || '';
  const moduleName = moduleNameFor(pathname);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const convoIdRef = useRef<string>('');
  const savedOnceRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const starters = role === 'kid' ? STARTERS_KID : STARTERS_ADULT;

  // Greeting + a fresh conversation id when the panel is first opened.
  useEffect(() => {
    if (open && messages.length === 0) {
      convoIdRef.current = newConversationId();
      savedOnceRef.current = false;
      setMessages([{ id: 'greet', role: 'assistant', content: greetingFor(role, displayName, moduleName) }]);
      setSuggestions(starters);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, messages.length, role, displayName, moduleName, starters]);

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    setError(null);
    setSuggestions([]);
    setDraft('');

    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', content };
    const next = [...messages, userMsg];
    setMessages(next);
    setLoading(true);

    // Drop the synthetic greeting before sending the wire transcript.
    const wire: GuideTurn[] = next
      .filter((m) => m.id !== 'greet')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/guidance-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: wire,
          context: { role, displayName, module: moduleName, familyName: family?.name },
        }),
      });
      const json = await res.json();
      if (json?.skipped) { setUnconfigured(true); return; }
      if (!res.ok) { setError(json?.error || 'Sorry, I could not answer that.'); return; }

      const reply: UiMsg = { id: `a-${Date.now()}`, role: 'assistant', content: json.message || '' };
      const withReply = [...next, reply];
      setMessages(withReply);
      setSuggestions(Array.isArray(json.suggestions) ? json.suggestions : []);

      // Best-effort: log the conversation for parent review.
      if (profile?.familyId && profile?.uid) {
        saveGuideChat({
          familyId: profile.familyId,
          conversationId: convoIdRef.current,
          uid: profile.uid,
          displayName: profile.displayName || '',
          role,
          module: moduleName,
          messages: withReply.filter((m) => m.id !== 'greet').map((m) => ({ role: m.role, content: m.content })),
          isFirst: !savedOnceRef.current,
        });
        savedOnceRef.current = true;
      }
    } catch {
      setError('Could not reach the guide. Check your connection.');
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, loading, role, displayName, moduleName, family?.name, profile?.familyId, profile?.uid, profile?.displayName]);

  // Don't render until we know who the user is (avoids a guest/parent flash).
  if (!profile && !isGuest) return null;

  const bubbleLabel = role === 'kid' ? 'Need help? Ask Kaya' : 'Help & guide';

  return (
    <>
      {/* Floating launcher — clears the mobile bottom nav (bottom-24) and sits
          comfortably on desktop. Hidden while the panel is open. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Kaya Guide help chat"
          className="fixed right-4 bottom-24 sm:bottom-6 z-[60] flex items-center gap-2 rounded-full bg-hive-honey text-white shadow-lg shadow-black/20 pl-3 pr-4 py-3 font-nunito font-black text-[13px] active:scale-95 transition-transform hover:bg-hive-honey-dk"
        >
          <MessageCircleQuestion className="w-5 h-5" />
          <span className="hidden sm:inline">{bubbleLabel}</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] sm:inset-auto sm:right-4 sm:bottom-6 flex flex-col">
          {/* Mobile scrim */}
          <div className="absolute inset-0 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />

          <div className="relative mt-auto sm:mt-0 flex h-[80vh] sm:h-[560px] w-full sm:w-[380px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-hive-navy text-white">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-hive-honey">
                  <Sparkles className="w-4 h-4 text-white" />
                </span>
                <div>
                  <div className="font-nunito font-black text-[14px] leading-tight">Kaya Guide</div>
                  <div className="text-[10px] opacity-70 leading-tight">Here to help you find your way</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5 rounded-full hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Transcript */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-kaya-cream/40">
              {messages.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-hive-navy text-white px-3 py-2 text-[13px] leading-snug'
                        : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-white border border-black/5 text-gray-800 px-3 py-2 text-[13px] leading-snug shadow-sm'
                    }
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm bg-white border border-black/5 px-3 py-2 text-[13px] text-gray-400 shadow-sm animate-pulse">
                    Kaya Guide is thinking…
                  </div>
                </div>
              )}

              {unconfigured && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-[12px] leading-snug">
                  The guide isn&apos;t switched on yet. A parent can enable it by adding an{' '}
                  <code className="bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code>.
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-[12px] leading-snug">
                  ⚠ {error}
                </div>
              )}
            </div>

            {/* Suggestion chips */}
            {suggestions.length > 0 && !loading && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1 bg-kaya-cream/40">
                {suggestions.map((s, i) => (
                  <button
                    key={`${i}-${s}`}
                    onClick={() => send(s)}
                    className="rounded-full border border-hive-honey/40 bg-white text-hive-honey-dk px-3 py-1 text-[11.5px] font-bold hover:bg-hive-honey/10 active:scale-95 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(draft); }}
              className="flex items-center gap-2 border-t border-black/5 bg-white px-3 py-2.5"
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={role === 'kid' ? 'Ask me anything…' : 'Ask how something works…'}
                className="flex-1 rounded-full bg-kaya-cream/60 px-4 py-2.5 text-[13px] outline-none focus:ring-2 focus:ring-hive-honey/40"
                maxLength={500}
              />
              <button
                type="submit"
                disabled={!draft.trim() || loading}
                aria-label="Send"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-hive-honey text-white disabled:opacity-40 active:scale-95 transition hover:bg-hive-honey-dk"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
