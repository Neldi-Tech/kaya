'use client';

// /workplan — role-branched, mirroring how /pantry/workplan branches
// parent vs helper:
//   • Kid    → their playful "My Workplan" timeline (tap-to-tick, points).
//   • Parent → child picker + KidWorkplanEditor (assign repeatable tasks
//     with real times, categories incl. Play, optional points).
//   • Helper → bounced to their own Workplan (/pantry/workplan).
//
// Part of the "My Day + Kids' Workplan" build (Phase 2). The Kids'
// Workplan engine here also feeds the kid "My Day" aggregator (Phase 3).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import KidWorkplanToday from '@/components/workplan/KidWorkplanToday';
import KidWorkplanEditor from '@/components/workplan/KidWorkplanEditor';
import {
  type KidWorkplanProof, type PauseInput,
  subscribeKidWorkplanProofs, reviewKidWorkplanProof,
  setFamilyWorkplanPause, pauseStatusLabel,
} from '@/lib/kidWorkplan';
import { updateFamily, readWorkplanProofMode } from '@/lib/firestore';
import { useLocale } from '@/lib/useLocale';
import PauseSheet from '@/components/workplan/PauseSheet';
import MeetingPrepCard from '@/components/meetings/MeetingPrepCard';
import {
  getMeetingSubmissionHistory, getAllMeetingSubmissionHistory,
  type SubmissionHistoryDoc,
} from '@/lib/meetingSubmissionHistory';
import { toDisplayDate } from '@/lib/dates';
import { PauseCircle } from 'lucide-react';

export default function WorkplanPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const role = profile?.role;

  // Helpers have their own Workplan surface — send them there.
  useEffect(() => {
    if (role === 'helper') router.replace('/pantry/workplan');
  }, [role, router]);

  if (!family || !profile) return null;
  if (role === 'helper') return null;

  // ── Kid view ──────────────────────────────────
  if (role === 'kid') {
    // Resolve the owning child robustly. profile.childId can be an EMPTY
    // STRING for some kid logins (a known gotcha — see business/new),
    // which would point the workplan at an invalid path and show empty.
    // Recover by matching the kid's sign-in email to a child record;
    // never silently fall back to children[0].
    const myEmail = profile.email?.toLowerCase() ?? '';
    const resolvedChildId =
      (profile.childId?.trim() || '') ||
      (myEmail ? (children.find((c) => (c.emailLower || c.email?.toLowerCase() || '') === myEmail)?.id ?? '') : '');
    if (!resolvedChildId) {
      return (
        <div className="mx-auto max-w-md w-full px-4 pt-6 pb-32 text-center">
          <div className="lg:hidden"><BackButton /></div>
          <div className="text-4xl mb-2">🗓️</div>
          <p className="font-extrabold text-[15px]" style={{ color: '#2D1B5E' }}>We couldn&apos;t find your plan</p>
          <p className="text-[12px] text-[#5C6975] mt-1">Ask a grown-up to link your account in Settings → Family.</p>
        </div>
      );
    }
    const me = children.find((c) => c.id === resolvedChildId);
    const name = me?.name ?? profile.displayName ?? 'friend';
    return (
      <KidWorkplanView
        familyId={family.id}
        childId={resolvedChildId}
        name={name}
        userUid={profile.uid}
        avatarEmoji={me?.avatarEmoji}
      />
    );
  }

  // ── Parent view ───────────────────────────────
  return <ParentWorkplan familyId={family.id} parentUid={profile.uid} />;
}

// Kid "My Workplan" with day navigation. Defaults to TODAY; the kid can
// scroll back/forward to see what's planned on other days (a parent may
// have assigned tasks for tomorrow). Ticking stays enabled only on today
// — KidWorkplanToday gates it via isToday; other days are view-only.
function KidWorkplanView({ familyId, childId, name, userUid, avatarEmoji }: {
  familyId: string;
  childId: string;
  name: string;
  userUid: string;
  avatarEmoji?: string;
}) {
  const [tab, setTab] = useState<'workplan' | 'submissions'>('workplan');
  const [offset, setOffset] = useState(0);
  const date = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }, [offset]);
  const PURPLE = '#9B5DE5';
  const rel = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : null;
  const dlabel = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      {/* Sunday-Meeting v2 (b2) prep card — surfaces here too because
          many families hide /my-day in kidModules. This is the kid
          surface they actually use. */}
      <MeetingPrepCard
        meId={userUid}
        role="kid"
        name={name.split(' ')[0]}
        childId={childId}
        avatarEmoji={avatarEmoji}
      />

      {/* Tabs — Workplan vs My Submissions (PR F). Keeps the meeting
          submission history out of the to-do list so neither crowds the
          other. */}
      <div className="flex gap-1.5 mb-3 rounded-full p-1" style={{ background: '#F0EBE3' }}>
        {([['workplan', '🗓️ Workplan'], ['submissions', '📒 My Submissions']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="flex-1 text-center font-black text-[12px] py-2 rounded-full transition-colors"
            style={tab === key
              ? { background: '#fff', color: '#1E120B', boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }
              : { color: '#9B8A72' }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'workplan' ? (
        <>
          {/* Day navigator — default today, scroll back/forward */}
          <div className="flex items-center gap-2 mb-2 rounded-2xl bg-white border-2 p-1.5" style={{ borderColor: '#F0E8FF' }}>
            <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Previous day"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] font-black active:scale-95" style={{ color: PURPLE }}>‹</button>
            <button type="button" onClick={() => setOffset(0)} className="flex-1 text-center leading-tight">
              <span className="block font-black text-[14px]" style={{ color: '#2D1B5E' }}>{rel ?? dlabel}</span>
              {rel && <span className="block text-[10px] font-bold" style={{ color: '#9B8AA8' }}>{dlabel}</span>}
            </button>
            <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Next day"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[20px] font-black active:scale-95" style={{ color: PURPLE }}>›</button>
          </div>
          {offset !== 0 && (
            <button type="button" onClick={() => setOffset(0)}
              className="mb-3 text-[11px] font-black px-3 py-1 rounded-full" style={{ background: '#F0E8FF', color: PURPLE }}>
              ↩ Back to today
            </button>
          )}
          <KidWorkplanToday familyId={familyId} childId={childId} childName={name} date={date} />
        </>
      ) : (
        <SubmissionHistoryView familyId={familyId} uid={userUid} />
      )}
    </div>
  );
}

// ── My Submissions (Sunday-Meeting v2 · PR F) ────────────────────────
// Read-only archive of what this member shared at past meetings —
// Gratitude / Appreciation / Goal per week, newest first. A keepsake the
// kid (or parent) can always look back on.
function SubmissionHistoryView({ familyId, uid }: { familyId: string; uid: string }) {
  const [doc, setDoc] = useState<SubmissionHistoryDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const PURPLE = '#9B5DE5';

  // 🫙 Surprise 2 — Family Gratitude Jar. Pool of every gratitude with
  // who/when. Parents/helpers can read the whole family's; a kid can only
  // read their own (rules), so we try family-wide and fall back to own.
  const [jar, setJar] = useState<Array<{ text: string; who: string; date: string }>>([]);
  const [jarPick, setJarPick] = useState<{ text: string; who: string; date: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMeetingSubmissionHistory(familyId, uid)
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch(() => { if (!cancelled) setDoc(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // Build the jar pool (family-wide when allowed; own otherwise).
    getAllMeetingSubmissionHistory(familyId)
      .then((docs) => {
        if (cancelled) return;
        const pool: Array<{ text: string; who: string; date: string }> = [];
        for (const d of docs) for (const e of d.entries || []) for (const g of e.gratitudes || []) {
          if (g) pool.push({ text: g, who: d.name || '', date: e.date });
        }
        setJar(pool);
      })
      .catch(() => { /* kid: family read denied — jar fills from own below */ });
    return () => { cancelled = true; };
  }, [familyId, uid]);

  // Fall back to own gratitudes for the jar if the family-wide read was
  // denied (kid) or returned nothing.
  useEffect(() => {
    if (jar.length > 0 || !doc) return;
    const own: Array<{ text: string; who: string; date: string }> = [];
    for (const e of doc.entries || []) for (const g of e.gratitudes || []) {
      if (g) own.push({ text: g, who: doc.name || '', date: e.date });
    }
    if (own.length) setJar(own);
  }, [doc, jar.length]);

  const shake = () => {
    if (jar.length === 0) return;
    // Avoid immediately repeating the same pick when there's more than one.
    let next = jar[Math.floor(jar.length * Math.random())];
    if (jar.length > 1 && jarPick && next.text === jarPick.text) {
      next = jar[(jar.indexOf(next) + 1) % jar.length];
    }
    setJarPick(next);
  };

  if (loading) {
    return <p className="text-center text-[13px] font-extrabold py-8" style={{ color: PURPLE }}>Loading your submissions…</p>;
  }

  const entries = doc?.entries || [];
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="text-4xl mb-2">📒</div>
        <p className="font-black text-[15px]" style={{ color: '#2D1B5E' }}>No submissions yet</p>
        <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
          Fill your meeting prep above — after each meeting it&apos;s saved here so you can always look back.
        </p>
      </div>
    );
  }

  const Row = ({ emoji, label, lines, tags }: { emoji: string; label: string; lines: string[]; tags?: (string | null)[] }) => {
    if (!lines || lines.length === 0) return null;
    const hasTags = !!tags && tags.some(Boolean);
    return (
      <div className="flex gap-2 text-[12.5px] mb-1.5">
        <span className="font-black uppercase tracking-wide text-[9.5px] w-[78px] flex-shrink-0 pt-[2px]" style={{ color: '#9B8A72' }}>
          {emoji} {label}
        </span>
        <span className="flex-1" style={{ color: '#3D241A' }}>
          {hasTags ? (
            // Per-line: each appreciation on its own line with its @tag.
            lines.map((ln, i) => (
              <span key={i} className="block">
                {tags?.[i] && <span className="font-extrabold" style={{ color: PURPLE }}>@{tags[i]} · </span>}
                {ln}
              </span>
            ))
          ) : (
            lines.join(' · ')
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 🫙 Surprise 2 — Family Gratitude Jar. Shake for a random
          throwback gratitude from the family's history. */}
      {jar.length > 0 && (
        <div className="rounded-2xl border-2 p-4 text-center" style={{ borderColor: '#D4A017', background: 'linear-gradient(180deg,#FFF8E7,#fff)' }}>
          <p className="font-black text-[11px] uppercase tracking-wide" style={{ color: '#B8860B' }}>
            🫙 Family Gratitude Jar
          </p>
          {jarPick ? (
            <div className="mt-2">
              <p className="text-[14px] font-extrabold italic leading-snug" style={{ color: '#3D241A' }}>
                &ldquo;{jarPick.text}&rdquo;
              </p>
              <p className="text-[11px] font-bold mt-1" style={{ color: '#9B8A72' }}>
                — {jarPick.who || 'you'}{jarPick.date ? ` · ${toDisplayDate(jarPick.date) || jarPick.date}` : ''}
              </p>
            </div>
          ) : (
            <p className="text-[12px] mt-1" style={{ color: '#5C6975' }}>
              {jar.length} gratitude{jar.length === 1 ? '' : 's'} saved. Give it a shake! ✨
            </p>
          )}
          <button
            type="button"
            onClick={shake}
            className="mt-3 inline-flex items-center gap-1.5 h-10 px-5 rounded-full font-black text-[12.5px] text-white transition-colors"
            style={{ background: '#D4A017' }}
          >
            🫙 {jarPick ? 'Shake again' : 'Shake the jar'}
          </button>
        </div>
      )}

      {entries.map((e, i) => (
        <div key={`${e.date}-${i}`} className="rounded-2xl bg-white border-2 p-3.5" style={{ borderColor: '#F0E8FF' }}>
          <p className="font-black text-[11px] uppercase tracking-wide mb-2" style={{ color: '#B8860B' }}>
            🗓️ {toDisplayDate(e.date) || e.date}
          </p>
          <Row emoji="🙏" label="Grateful" lines={e.gratitudes} />
          <Row
            emoji="💛"
            label="Appreciate"
            lines={e.appreciations}
            tags={e.appreciationTagNames ?? (e.appreciationTagName ? [e.appreciationTagName] : [])}
          />
          <Row emoji="🎯" label="Goal" lines={e.goals} />
        </div>
      ))}
    </div>
  );
}

function ParentWorkplan({ familyId, parentUid }: { familyId: string; parentUid: string }) {
  const { family, children } = useFamily();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && children.length > 0) setSelectedId(children[0].id);
  }, [children, selectedId]);

  const selected = children.find((c) => c.id === selectedId) ?? null;
  const childRefs = useMemo(() => children.map((c) => ({ id: c.id, name: c.name })), [children]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mb-1">Kids · Workplan</p>
      <h1 className="font-display text-2xl lg:text-[32px] font-black tracking-tight">Kids&apos; Workplan</h1>
      <p className="text-[12px] text-hive-muted mt-1 mb-4">
        Build a repeatable weekly plan for each child — with real times (school schedule), play, chores &amp; homework. Kids tick tasks off in their own playful view and earn any points you set.
      </p>

      {children.length === 0 ? (
        <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-8 text-center">
          <div className="text-4xl mb-2">👧</div>
          <p className="font-nunito font-extrabold text-[14px]">No kids yet</p>
          <p className="text-[12px] text-hive-muted mt-1">Add a child first, then build their workplan here.</p>
        </div>
      ) : (
        <>
          {/* Proof for points — A/B mode + review feed */}
          <ProofModeToggle familyId={familyId} family={family} />
          {/* All-kids holidays / pause (PR C) */}
          <FamilyPauseCard familyId={familyId} family={family} parentUid={parentUid} />
          <ProofsToReview familyId={familyId} parentUid={parentUid} children={childRefs} />

          {/* Child picker */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-4">
            {children.map((c) => {
              const on = c.id === selectedId;
              return (
                <button key={c.id} onClick={() => setSelectedId(c.id)}
                  className={`flex items-center gap-2 flex-shrink-0 rounded-hive-pill border-2 pl-1.5 pr-3 py-1.5 ${on ? 'border-hive-navy bg-hive-navy/5' : 'border-hive-line bg-hive-paper'}`}>
                  <KidAvatar child={c} size="sm" shape="circle" bgOpacity="20" />
                  <span className="font-nunito font-extrabold text-[13px]">{c.name}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <KidWorkplanEditor
              key={selected.id}
              familyId={familyId}
              childId={selected.id}
              childName={selected.name}
              parentUid={parentUid}
              allChildren={children.map((c) => ({ id: c.id, name: c.name }))}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── A/B mode toggle: how proof tasks award points ─────────────────
// 'approve' (default) — points wait for a parent OK. 'instant' — points
// land on submit, revocable via a later reject. Writes workplanProofMode
// on the family doc; the live family subscription reflects it.
function ProofModeToggle({ familyId, family }: { familyId: string; family: import('@/lib/firestore').Family | null }) {
  const mode = readWorkplanProofMode(family);
  const [busy, setBusy] = useState(false);

  const set = async (next: 'approve' | 'instant') => {
    if (next === mode || busy) return;
    setBusy(true);
    try { await updateFamily(familyId, { workplanProofMode: next }); }
    finally { setBusy(false); }
  };

  const Btn = ({ value, label, hint }: { value: 'approve' | 'instant'; label: string; hint: string }) => {
    const on = mode === value;
    return (
      <button type="button" onClick={() => set(value)} disabled={busy} aria-pressed={on}
        className={`flex-1 rounded-hive-lg border-2 px-3 py-2 text-left disabled:opacity-60 ${on ? 'border-hive-navy bg-hive-navy/5' : 'border-hive-line bg-hive-paper'}`}>
        <span className="block font-nunito font-extrabold text-[12px]">{on ? '✓ ' : ''}{label}</span>
        <span className="block text-[10px] text-hive-muted mt-0.5">{hint}</span>
      </button>
    );
  };

  return (
    <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-3 mb-4">
      <p className="text-[9px] font-black uppercase tracking-wider text-hive-muted mb-2">📸 Points for proof tasks</p>
      <div className="flex gap-2">
        <Btn value="approve" label="Approve first" hint="Points wait until you approve the proof." />
        <Btn value="instant" label="Instant + revoke" hint="Points land on submit; reject to claw back." />
      </div>
    </div>
  );
}

// ── All-kids holidays / pause (PR C) ──────────────────────────────
// Family-level pause: applies to EVERY child's plan on covered days,
// streak-safe. Writes Family.workplanPause; the live family sub reflects it.
function FamilyPauseCard({ familyId, family, parentUid }: {
  familyId: string;
  family: import('@/lib/firestore').Family | null;
  parentUid: string;
}) {
  const sw = useLocale() === 'sw';
  const pause = family?.workplanPause ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (p: PauseInput | null) => {
    setBusy(true);
    try { await setFamilyWorkplanPause(familyId, p, parentUid); setOpen(false); }
    finally { setBusy(false); }
  };
  const label = pauseStatusLabel(pause);
  return (
    <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-3 mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-wider text-hive-muted mb-0.5">🏖️ {sw ? 'Likizo za watoto wote' : 'All-kids holidays'}</p>
        {label ? (
          <p className="text-[12px] font-nunito font-extrabold truncate" style={{ color: '#0F1F44' }}>{label}{pause?.note ? ` · ${pause.note}` : ''}</p>
        ) : (
          <p className="text-[12px] text-hive-muted">{sw ? 'Hakuna likizo iliyowekwa' : 'No family pause set'}</p>
        )}
      </div>
      <button type="button" onClick={() => setOpen(true)}
        className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-hive-pill border-2 border-hive-line font-nunito font-extrabold text-[12px]" style={{ color: '#0F1F44' }}>
        <PauseCircle size={14} /> {label ? (sw ? 'Badilisha' : 'Manage') : (sw ? 'Simamisha wote' : 'Pause all')}
      </button>
      {open && (
        <PauseSheet
          title={sw ? 'Simamisha watoto wote' : "Pause all kids' plans"}
          scopeNote={sw ? 'Inahusu kila mtoto' : 'Applies to every child'}
          current={pause}
          sw={sw}
          busy={busy}
          onSave={save}
          onResume={() => save(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── "Proofs to review" feed ───────────────────────────────────────
// Fans out subscribeKidWorkplanProofs over every child and surfaces the
// PENDING ones (plus, in instant mode, lets a parent revoke an approved
// proof). Each row shows the kid, task note + media, and Approve/Reject
// — both gated behind a parent note (feedback shown to the kid).
function ProofsToReview({ familyId, parentUid, children }: {
  familyId: string;
  parentUid: string;
  children: { id: string; name: string }[];
}) {
  const { family } = useFamily();
  const mode = readWorkplanProofMode(family);
  // Merged proofs keyed by childId (each child's latest snapshot replaces
  // its own slice — avoids stale rows when one child's feed updates).
  const [byChild, setByChild] = useState<Record<string, KidWorkplanProof[]>>({});

  useEffect(() => {
    setByChild({});
    const unsubs = children.map((c) =>
      subscribeKidWorkplanProofs(familyId, c.id, (proofs) =>
        setByChild((prev) => ({ ...prev, [c.id]: proofs })),
      ),
    );
    return () => { unsubs.forEach((u) => u()); };
  }, [familyId, children]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of children) m.set(c.id, c.name);
    return m;
  }, [children]);

  // Flatten to rows the parent should act on: always PENDING; plus
  // APPROVED rows when the family is in instant mode (so a parent can
  // revoke). Newest first by submittedAt.
  const rows = useMemo(() => {
    const out: { childId: string; proof: KidWorkplanProof }[] = [];
    for (const [cid, proofs] of Object.entries(byChild)) {
      for (const p of proofs) {
        if (p.status === 'pending' || (mode === 'instant' && p.status === 'approved')) {
          out.push({ childId: cid, proof: p });
        }
      }
    }
    out.sort((a, b) => {
      const at = a.proof.submittedAt?.toMillis?.() ?? 0;
      const bt = b.proof.submittedAt?.toMillis?.() ?? 0;
      return bt - at;
    });
    return out;
  }, [byChild, mode]);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk mb-2">
        Proofs to review · {rows.length}
      </p>
      <div className="space-y-2">
        {rows.map(({ childId, proof }) => (
          <ProofReviewRow
            key={`${childId}_${proof.itemId}_${proof.date}`}
            familyId={familyId}
            parentUid={parentUid}
            childId={childId}
            childName={nameById.get(childId) ?? 'Kid'}
            proof={proof}
          />
        ))}
      </div>
    </div>
  );
}

function ProofReviewRow({ familyId, parentUid, childId, childName, proof }: {
  familyId: string;
  parentUid: string;
  childId: string;
  childName: string;
  proof: KidWorkplanProof;
}) {
  // Which decision's note box is open ('approve' | 'reject' | null).
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isApproved = proof.status === 'approved';

  const submit = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await reviewKidWorkplanProof({
        familyId, childId, itemId: proof.itemId, date: proof.date,
        decision: pending, note: note.trim(), reviewerUid: parentUid,
      });
      if (!r.ok) { setErr("Couldn't save — please try again."); return; }
      setPending(null);
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-nunito font-extrabold text-[13px]">{childName}</span>
        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg"
          style={isApproved ? { background: '#E9F8EC', color: '#2E7D32' } : { background: '#F3ECFF', color: '#7A4FD0' }}>
          {isApproved ? '✓ Approved' : '⏳ Pending'}{proof.pointsValue > 0 ? ` · +${proof.pointsValue}` : ''}
        </span>
      </div>

      {proof.note && <p className="text-[12px] font-bold text-hive-ink mb-2">“{proof.note}”</p>}

      {/* Media */}
      <div className="rounded-hive overflow-hidden border border-hive-line mb-2 bg-black/5">
        {proof.mediaType === 'video'
          ? <video src={proof.mediaUrl} controls className="w-full max-h-64 object-contain bg-black" />
          : <img src={proof.mediaUrl} alt={`${childName}'s proof`} className="w-full max-h-64 object-contain" />}
      </div>

      {err && <div className="mb-2 rounded-hive bg-red-50 border border-red-300 text-red-800 text-[11px] font-extrabold px-2.5 py-1.5">⚠ {err}</div>}

      {pending ? (
        <div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400}
            placeholder={pending === 'reject' ? 'What should they fix? (shown to your kid)' : 'Add a note for your kid (optional)'}
            className="w-full rounded-hive border border-hive-line bg-white text-[12px] font-bold p-2 focus:outline-none focus:border-hive-navy mb-2" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setPending(null); setNote(''); }} className="text-[12px] font-bold text-hive-muted px-2">Cancel</button>
            <button type="button" onClick={submit} disabled={busy}
              className="h-9 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px] disabled:opacity-50"
              style={{ background: pending === 'reject' ? '#D9534F' : '#2E8B57' }}>
              {busy ? 'Saving…' : pending === 'reject' ? 'Confirm reject' : 'Confirm approve'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => { setPending('reject'); setNote(''); }}
            className="h-9 px-4 rounded-hive-pill border border-hive-line font-nunito font-extrabold text-[12px] text-hive-rose">
            {isApproved ? 'Revoke' : 'Reject'}
          </button>
          {!isApproved && (
            <button type="button" onClick={() => { setPending('approve'); setNote(''); }}
              className="h-9 px-4 rounded-hive-pill text-white font-nunito font-extrabold text-[12px]" style={{ background: '#2E8B57' }}>
              Approve
            </button>
          )}
        </div>
      )}
    </div>
  );
}
