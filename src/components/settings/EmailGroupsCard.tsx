'use client';

// 📮 Email groups (Reminders v4, approved 04-Jul-2026) — parents build named
// recipient bundles (Family / Grandparents / Helpers…) once, then pick them
// as one-tap chips in every reminder "EMAIL TO — PICK + ADD" panel. Groups
// live on the family doc (`family.emailGroups`, parent-writable like
// gamesConfig — no rules change). Members are stored by uid and resolved to
// their live Kaya email at use-time; outside addresses are stored plain.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  getFamilyMembers, updateFamily, type UserProfile,
} from '@/lib/firestore';
import type { EmailGroup } from '@/lib/reminders';

// Reminders accent — same scoped indigo as /reminders (approved v3 mock).
const CAL = '#5B6CC8';
const CAL_DK = '#3E4DA0';
const CAL_SOFT = '#E7EAFA';

const EMOJI_PRESETS = ['👨‍👩‍👧', '👵', '🤝', '💛', '🏠', '🎉'];

function newGroupId(): string {
  return `g_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

interface DraftGroup {
  id: string;
  name: string;
  emoji: string;
  memberUids: string[];
  externalEmails: string[];
}

function toDraft(g: EmailGroup): DraftGroup {
  return {
    id: g.id, name: g.name, emoji: g.emoji || '👨‍👩‍👧',
    memberUids: g.memberUids || [], externalEmails: g.externalEmails || [],
  };
}

export default function EmailGroupsCard() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const familyId = profile?.familyId;

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [draft, setDraft] = useState<DraftGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [extInput, setExtInput] = useState('');

  const groups: EmailGroup[] = useMemo(() => family?.emailGroups || [], [family?.emailGroups]);

  useEffect(() => {
    if (!familyId) return;
    getFamilyMembers(familyId)
      .then((ms) => setMembers(ms.filter((m) => !!m.email)))
      .catch(() => setMembers([]));
  }, [familyId]);

  async function persist(next: EmailGroup[]) {
    if (!familyId || saving) return;
    setSaving(true);
    try { await updateFamily(familyId, { emailGroups: next }); } catch { /* card re-renders from context */ }
    setSaving(false);
  }

  function saveDraft() {
    if (!draft || !draft.name.trim()) return;
    const clean: EmailGroup = {
      id: draft.id,
      name: draft.name.trim().slice(0, 40),
      emoji: draft.emoji || '👨‍👩‍👧',
      memberUids: draft.memberUids,
      externalEmails: draft.externalEmails,
    };
    const next = groups.some((g) => g.id === clean.id)
      ? groups.map((g) => (g.id === clean.id ? clean : g))
      : [...groups, clean];
    persist(next);
    setDraft(null);
    setExtInput('');
  }

  function removeGroup(id: string) {
    persist(groups.filter((g) => g.id !== id));
    if (draft?.id === id) setDraft(null);
  }

  function addExternal() {
    const email = extInput.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !draft) return;
    if (!draft.externalEmails.includes(email)) {
      setDraft({ ...draft, externalEmails: [...draft.externalEmails, email] });
    }
    setExtInput('');
  }

  // Starter suggestion — one tap creates "👨‍👩‍👧 Family" with every member
  // who has a Kaya email (approved default #3). Only offered while empty.
  const showStarter = groups.length === 0 && !starterDismissed && members.length > 0 && !draft;
  function createStarter() {
    persist([{
      id: newGroupId(), name: 'Family', emoji: '👨‍👩‍👧',
      memberUids: members.filter((m) => m.role !== 'helper').map((m) => m.uid),
      externalEmails: [],
    }]);
  }

  function memberSummary(g: EmailGroup): string {
    const names = (g.memberUids || [])
      .map((uid) => members.find((m) => m.uid === uid)?.displayName)
      .filter(Boolean) as string[];
    const all = [...names, ...(g.externalEmails || [])];
    const count = all.length;
    const shown = all.slice(0, 4).join(' · ');
    return `${shown}${count > 4 ? ' …' : ''} — ${count} ${count === 1 ? 'person' : 'people'}`;
  }

  if (!familyId) return null;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📮</span>
        <h2 className="font-display font-extrabold text-kaya-chocolate">Email groups</h2>
      </div>
      <p className="text-[12px] text-kaya-sand mb-3">
        Bundle people you often notify together. Groups appear as one-tap chips wherever you pick email recipients (Reminders → 📧 Email to).
      </p>

      {showStarter && (
        <div className="rounded-kaya border border-dashed p-3 mb-3 flex items-center gap-2.5" style={{ borderColor: CAL, background: CAL_SOFT }}>
          <span className="text-xl">👨‍👩‍👧</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-extrabold text-kaya-chocolate">Start with a “Family” group?</div>
            <div className="text-[11px] text-kaya-sand">Everyone in the family with a Kaya email — ready in one tap.</div>
          </div>
          <button onClick={createStarter} disabled={saving} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white shrink-0" style={{ background: CAL }}>✓ Create it</button>
          <button onClick={() => setStarterDismissed(true)} className="rounded-kaya-sm px-2.5 py-1.5 text-xs font-bold text-kaya-sand bg-white border border-kaya-warm-dark shrink-0">✕</button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="space-y-2 mb-3">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-2.5 rounded-kaya border border-kaya-warm-dark px-3 py-2.5">
              <span className="text-xl shrink-0">{g.emoji || '👨‍👩‍👧'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-extrabold text-kaya-chocolate truncate">{g.name}</div>
                <div className="text-[11px] text-kaya-sand truncate">{memberSummary(g)}</div>
              </div>
              <button onClick={() => { setDraft(toDraft(g)); setExtInput(''); }} className="rounded-kaya-sm px-2.5 py-1.5 text-[11px] font-bold text-kaya-sand bg-kaya-warm shrink-0">✏️ Edit</button>
              <button onClick={() => removeGroup(g.id)} disabled={saving} className="rounded-kaya-sm px-2 py-1.5 text-[11px] font-bold text-red-500 bg-white border border-red-200 shrink-0">🗑️</button>
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="rounded-kaya border p-3" style={{ borderColor: CAL, background: '#FDFCFA' }}>
          <div className="text-[10.5px] font-extrabold uppercase tracking-wide mb-2" style={{ color: CAL_DK }}>
            {groups.some((g) => g.id === draft.id) ? '✏️ Edit group' : '＋ New group'}
          </div>

          <div className="flex gap-2 mb-2.5">
            <div className="flex gap-1">
              {EMOJI_PRESETS.map((e) => (
                <button key={e} onClick={() => setDraft({ ...draft, emoji: e })}
                  className="w-8 h-8 rounded-kaya-sm border text-base flex items-center justify-center"
                  style={draft.emoji === e ? { borderColor: CAL, background: CAL_SOFT } : { borderColor: '#E8DEC9', background: '#fff' }}>
                  {e}
                </button>
              ))}
            </div>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Group name — e.g. Grandparents"
              className="flex-1 min-w-0 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-sm font-bold text-kaya-chocolate"
            />
          </div>

          <div className="text-[10.5px] font-extrabold uppercase tracking-wide text-kaya-sand mb-1.5">Who’s in it</div>
          <div className="rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 mb-2.5 max-h-44 overflow-y-auto">
            {members.length === 0 && <div className="text-[11px] text-kaya-sand py-1">No family emails on file yet.</div>}
            {members.map((m) => {
              const on = draft.memberUids.includes(m.uid);
              return (
                <button key={m.uid}
                  onClick={() => setDraft({
                    ...draft,
                    memberUids: on ? draft.memberUids.filter((u) => u !== m.uid) : [...draft.memberUids, m.uid],
                  })}
                  className="w-full flex items-center gap-2 py-1.5 text-left">
                  <span className="w-[17px] h-[17px] rounded-[5px] flex items-center justify-center text-[10px] font-extrabold text-white shrink-0"
                    style={on ? { background: CAL } : { background: '#fff', border: '1.5px solid #E8DEC9' }}>
                    {on ? '✓' : ''}
                  </span>
                  <span className="text-[12.5px] font-bold text-kaya-chocolate">{m.displayName}</span>
                  <span className="ml-auto text-[10.5px] text-kaya-sand truncate max-w-[45%]">{m.email}</span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 mb-2">
            <input
              value={extInput}
              onChange={(e) => setExtInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal(); } }}
              placeholder="grandma@example.com"
              className="flex-1 rounded-kaya-sm border border-kaya-warm-dark bg-white px-2.5 py-1.5 text-xs font-medium text-kaya-chocolate"
            />
            <button onClick={addExternal} className="rounded-kaya-sm px-3 py-1.5 text-xs font-extrabold text-white" style={{ background: CAL }}>+ Add</button>
          </div>
          {draft.externalEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {draft.externalEmails.map((email) => (
                <span key={email} className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-1" style={{ background: CAL_SOFT, color: CAL_DK }}>
                  ✉️ {email}
                  <button onClick={() => setDraft({ ...draft, externalEmails: draft.externalEmails.filter((e) => e !== email) })} className="opacity-60 hover:opacity-100">✕</button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1" />
            <button onClick={() => { setDraft(null); setExtInput(''); }} className="rounded-kaya-sm px-3 py-2 text-xs font-bold text-kaya-sand bg-white border border-kaya-warm-dark">Cancel</button>
            <button onClick={saveDraft} disabled={saving || !draft.name.trim()} className="rounded-kaya-sm px-4 py-2 text-xs font-extrabold text-white disabled:opacity-60" style={{ background: CAL }}>
              {saving ? 'Saving…' : 'Save group'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setDraft({ id: newGroupId(), name: '', emoji: '👨‍👩‍👧', memberUids: [], externalEmails: [] }); setExtInput(''); }}
          className="rounded-kaya px-4 py-2.5 text-sm font-extrabold text-white"
          style={{ background: CAL }}
        >
          ＋ New group
        </button>
      )}
    </div>
  );
}
