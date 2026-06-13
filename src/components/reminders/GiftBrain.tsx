'use client';

// 🎁 Gift Brain (Kaya Reminders R2) — a year-round, per-person gift-idea stash
// surfaced ~2 weeks before someone's birthday/anniversary, tied to a kid's
// interests/aspirations. PARENTS-ONLY (the page mounts it only for parents) so
// it never spoils the surprise. Shows upcoming gift prompts + a manager to add
// ideas for any family kid or a free-typed person (a friend, a grandparent).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchGiftIdeas, saveGiftIdea, deleteGiftIdea, giftPromptsFor, relativeDays,
  GIFT_LEAD_DAYS, type GiftIdea, type ReminderOccurrence,
} from '@/lib/reminders';

const GIFT = '#C2588F';
const GIFT_DK = '#9E3D72';
const GIFT_SOFT = '#FBEAF3';

interface ChildLite { id: string; name: string; interests?: string[] }

export default function GiftBrain({ occurrences, children }: { occurrences: ReminderOccurrence[]; children: ChildLite[] }) {
  const { user } = useAuth();
  const [ideas, setIdeas] = useState<GiftIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      setIdeas(await fetchGiftIdeas(token));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const interestsByChildId = useMemo(
    () => Object.fromEntries((children || []).map((c) => [c.id, c.interests || []])),
    [children],
  );
  const prompts = useMemo(
    () => giftPromptsFor(occurrences, ideas, interestsByChildId),
    [occurrences, ideas, interestsByChildId],
  );

  async function addIdea(personName: string, text: string, linkedChildId?: string) {
    if (!user || !personName.trim() || !text.trim()) return;
    const token = await user.getIdToken();
    await saveGiftIdea(token, { personName: personName.trim(), text: text.trim(), linkedChildId });
    await load();
  }
  async function toggleDone(g: GiftIdea) {
    if (!user) return;
    const token = await user.getIdToken();
    await saveGiftIdea(token, { id: g.id, personName: g.personName, linkedChildId: g.linkedChildId, text: g.text, done: !g.done });
    await load();
  }
  async function remove(g: GiftIdea) {
    if (!user) return;
    const token = await user.getIdToken();
    await deleteGiftIdea(token, g.id);
    await load();
  }

  if (loading) return null;
  // Nothing to nudge and nothing saved → a slim entry to start a stash.
  const hasContent = prompts.length > 0 || ideas.length > 0;

  return (
    <div className="mb-5">
      <div className="rounded-kaya p-4 text-white" style={{ background: `linear-gradient(135deg,#1F2D3D,${GIFT} 160%)` }}>
        <div className="flex items-center justify-between">
          <div className="font-display font-extrabold flex items-center gap-2">🎁 Gift Brain</div>
          <button onClick={() => setManagerOpen(true)} className="text-[11px] font-extrabold rounded-full px-3 py-1.5 bg-white/15 hover:bg-white/25">
            {ideas.length > 0 ? `Manage (${ideas.length})` : '+ Add ideas'}
          </button>
        </div>

        {prompts.length === 0 ? (
          <div className="text-[12px] opacity-90 mt-2">
            {hasContent
              ? 'No birthdays in the next two weeks — your saved ideas are ready when they come up.'
              : `Save gift ideas year-round; Kaya nudges you ~${GIFT_LEAD_DAYS} days before each birthday.`}
          </div>
        ) : (
          <div className="space-y-2 mt-3">
            {prompts.map((p) => (
              <div key={`${p.occurrence.event.id}-${p.occurrence.dateKey}`} className="rounded-kaya-sm bg-white/12 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-base">{p.occurrence.event.type === 'anniversary' ? '💍' : '🎂'}</span>
                  <span className="text-[13px] font-extrabold">{p.personName}</span>
                  <span className="ml-auto text-[11px] font-extrabold" style={{ color: '#FBE38E' }}>{relativeDays(p.occurrence.daysAway, p.occurrence.dateKey)}</span>
                </div>
                {p.ideas.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.ideas.map((g) => (
                      <span key={g.id} className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-white/90" style={{ color: GIFT_DK }}>🎁 {g.text}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] opacity-90 mt-1.5">
                    No ideas saved yet{p.interests.length ? ` — they love ${p.interests.slice(0, 3).join(', ')}` : ''}.
                  </div>
                )}
                <QuickAdd onAdd={(text) => addIdea(p.personName, text, p.linkedChildId)} interests={p.interests} />
              </div>
            ))}
          </div>
        )}
      </div>

      {managerOpen && (
        <GiftManager
          ideas={ideas}
          children={children}
          onClose={() => setManagerOpen(false)}
          onAdd={addIdea}
          onToggleDone={toggleDone}
          onRemove={remove}
        />
      )}
    </div>
  );
}

function QuickAdd({ onAdd, interests }: { onAdd: (text: string) => void; interests: string[] }) {
  const [text, setText] = useState('');
  return (
    <div className="flex gap-1.5 mt-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text); setText(''); } }}
        placeholder={interests.length ? `e.g. ${interests[0]} gift…` : 'Save a gift idea…'}
        className="flex-1 rounded-kaya-sm px-2.5 py-1.5 text-[12px] font-medium text-kaya-chocolate bg-white"
      />
      <button
        onClick={() => { if (text.trim()) { onAdd(text); setText(''); } }}
        className="rounded-kaya-sm px-3 py-1.5 text-[12px] font-extrabold bg-white" style={{ color: GIFT_DK }}
      >
        + Save
      </button>
    </div>
  );
}

function GiftManager({
  ideas, children, onClose, onAdd, onToggleDone, onRemove,
}: {
  ideas: GiftIdea[];
  children: ChildLite[];
  onClose: () => void;
  onAdd: (personName: string, text: string, linkedChildId?: string) => void;
  onToggleDone: (g: GiftIdea) => void;
  onRemove: (g: GiftIdea) => void;
}) {
  const [pick, setPick] = useState<string>(children[0]?.id || 'other');
  const [otherName, setOtherName] = useState('');
  const [text, setText] = useState('');

  function submit() {
    const child = children.find((c) => c.id === pick);
    const personName = child ? child.name : otherName.trim();
    if (!personName || !text.trim()) return;
    onAdd(personName, text, child?.id);
    setText('');
  }

  // Group ideas by person for the list.
  const groups = ideas.reduce<Record<string, GiftIdea[]>>((acc, g) => {
    (acc[g.personName] = acc[g.personName] || []).push(g);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-kaya-cream w-full sm:max-w-md rounded-t-kaya-lg sm:rounded-kaya-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-kaya-cream border-b border-kaya-warm-dark px-4 py-3 flex items-center justify-between">
          <div className="font-display font-extrabold text-kaya-chocolate">🎁 Gift Brain</div>
          <button onClick={onClose} className="text-kaya-sand text-xl leading-none px-2">✕</button>
        </div>
        <div className="p-4 space-y-4">
          {/* Add */}
          <div className="rounded-kaya border border-kaya-warm-dark bg-white p-3 space-y-2">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand">Add a gift idea</div>
            <div className="flex gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} className="rounded-kaya-sm border border-kaya-warm-dark px-2 py-2 text-sm font-bold text-kaya-chocolate bg-white">
                {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="other">Someone else…</option>
              </select>
              {pick === 'other' && (
                <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Name (e.g. Grandma)"
                  className="flex-1 rounded-kaya-sm border border-kaya-warm-dark px-2.5 py-2 text-sm font-medium text-kaya-chocolate" />
              )}
            </div>
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                placeholder="Gift idea…" className="flex-1 rounded-kaya-sm border border-kaya-warm-dark px-2.5 py-2 text-sm font-medium text-kaya-chocolate" />
              <button onClick={submit} className="rounded-kaya-sm px-4 py-2 text-sm font-extrabold text-white" style={{ background: GIFT }}>Save</button>
            </div>
          </div>

          {/* List */}
          {Object.keys(groups).length === 0 ? (
            <div className="text-sm text-kaya-sand text-center py-6">No saved ideas yet. Stash them as you think of them all year. 🎁</div>
          ) : (
            Object.entries(groups).map(([person, list]) => (
              <div key={person}>
                <div className="text-[11px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: GIFT_DK }}>{person}</div>
                <div className="space-y-1.5">
                  {list.map((g) => (
                    <div key={g.id} className="flex items-center gap-2 bg-white rounded-kaya-sm border border-kaya-warm-dark px-3 py-2">
                      <button onClick={() => onToggleDone(g)} className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-extrabold text-white shrink-0"
                        style={g.done ? { background: '#3FAF6C' } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>
                        {g.done ? '✓' : ''}
                      </button>
                      <span className={`flex-1 text-sm font-bold ${g.done ? 'line-through text-kaya-sand' : 'text-kaya-chocolate'}`}>{g.text}</span>
                      <button onClick={() => onRemove(g)} className="text-kaya-sand text-sm px-1">🗑️</button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
