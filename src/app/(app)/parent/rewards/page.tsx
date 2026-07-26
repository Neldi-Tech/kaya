'use client';

// /parent/rewards — Parents add, edit, retire and re-price the rewards
// kids spend points on. Categories are free-text per reward; the picker
// is seeded from DEFAULT_REWARD_CATEGORIES and unions in whatever the
// family has already typed. The kid-side /rewards page renders the same
// list grouped by category.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import CoachMark from '@/components/ui/CoachMark';
import NextUp from '@/components/ui/NextUp';
import RewardsWizard from '@/components/rewards/RewardsWizard';
import RewardsRulesCard from '@/components/settings/RewardsRulesCard';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useHive } from '@/contexts/HiveContext';
import {
  addReward, updateReward, deleteReward, addRewardsBatch,
  getRedemptions,
  DEFAULT_REWARD_CATEGORIES, DEFAULT_REWARD_CATEGORY,
  REWARD_LIBRARY, REWARD_LIBRARY_CATEGORIES,
  Reward, LibraryReward, Redemption,
} from '@/lib/firestore';
import { resolveApprovalRequest, getRewardProposals, type ApprovalRequest } from '@/lib/hive';
import BackButton from '@/components/ui/BackButton';

const fmt = (n: number) => n.toLocaleString('en-US');

type Draft = Omit<Reward, 'id'>;

const blankDraft = (): Draft => ({
  title: '',
  description: '',
  pointsCost: 25,
  icon: '🎁',
  active: true,
  category: DEFAULT_REWARD_CATEGORY,
});

export default function ParentRewardsPage() {
  const { profile, user, isGuest } = useAuth();
  const { family, rewards, children, refresh } = useFamily();
  const confirmAction = useConfirm();
  const { pendingApprovals } = useHive();

  // 💡 RWI PR-B — the kids' idea inbox. Pending ideas arrive real-time via
  // HiveContext; the all-time list feeds the scoreboard.
  const pendingIdeas = useMemo(
    () => pendingApprovals.filter((r) => r.type === 'reward_proposal'),
    [pendingApprovals],
  );
  const [allProposals, setAllProposals] = useState<ApprovalRequest[]>([]);
  const loadProposals = useCallback(async () => {
    if (!profile?.familyId) return;
    setAllProposals(await getRewardProposals(profile.familyId).catch(() => []));
  }, [profile?.familyId]);
  useEffect(() => { loadProposals(); }, [loadProposals, pendingIdeas.length]);
  const kidNameOf = useCallback(
    (id: string) => children.find((c) => c.id === id)?.name?.split(' ')[0] || 'Kid',
    [children],
  );
  // Approve flow: "Make it a reward" opens the normal add form PRE-FILLED;
  // saving creates the reward (with the 💡 credit) AND resolves the request.
  const [proposalFor, setProposalFor] = useState<ApprovalRequest | null>(null);
  const [proposalNote, setProposalNote] = useState('');
  // Decline flow: inline note (house rule — the kid always gets a note).
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [ideaBusy, setIdeaBusy] = useState(false);

  // Recent redemptions — fetched once when the page mounts and after
  // any operation that might have logged a new one. Limited to 25 so
  // the section stays compact; "View all" can come later if needed.
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const loadRedemptions = useCallback(async () => {
    if (!profile?.familyId) return;
    const list = await getRedemptions(profile.familyId, 25);
    setRedemptions(list);
  }, [profile?.familyId]);
  useEffect(() => { loadRedemptions(); }, [loadRedemptions]);

  // Inline edit state — one reward at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft());

  // "Add new" form lives in a banner card so parents don't have to
  // hunt for a modal trigger.
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(blankDraft());

  // Guided wizard for the First Week "Set up your first reward" item.
  // Auto-opens when the URL has ?wizard=1 (the checklist deep-links
  // here). The inline `adding` form above stays as a power-user path.
  const [wizardOpen, setWizardOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (searchParams?.get('wizard') === '1') {
      setWizardOpen(true);
      // Strip the query so a reload doesn't re-open it.
      router.replace('/parent/rewards');
    }
  }, [searchParams, router]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // Library picker — collapsed by default. Selection state is keyed by
  // library item title (titles in the library are stable + unique).
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySelected, setLibrarySelected] = useState<Set<string>>(new Set());
  const [libraryCategory, setLibraryCategory] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [importing, setImporting] = useState(false);

  // Titles the family already has — used to mark library items as
  // "already in your list" so parents don't double-import.
  const existingTitles = useMemo(
    () => new Set(rewards.map((r) => r.title.trim().toLowerCase())),
    [rewards]
  );

  const visibleLibrary = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return REWARD_LIBRARY.filter((r) => {
      if (libraryCategory && (r.category || DEFAULT_REWARD_CATEGORY) !== libraryCategory) return false;
      if (q && !r.title.toLowerCase().includes(q) && !r.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [libraryQuery, libraryCategory]);

  const toggleLibrarySelect = (title: string) => {
    setLibrarySelected((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const importSelected = async () => {
    if (isGuest || !profile?.familyId) return;
    const picks: LibraryReward[] = REWARD_LIBRARY.filter((r) => librarySelected.has(r.title));
    if (picks.length === 0) { flash('Tick some library items first.'); return; }
    setImporting(true);
    try {
      const skipped = picks.filter((r) => existingTitles.has(r.title.trim().toLowerCase())).length;
      const fresh = picks.filter((r) => !existingTitles.has(r.title.trim().toLowerCase()));
      const added = await addRewardsBatch(
        profile.familyId,
        fresh.map((r) => ({ ...r, active: true })),
      );
      await refresh();
      setLibrarySelected(new Set());
      if (skipped > 0) {
        flash(`Added ${added} reward${added === 1 ? '' : 's'} (skipped ${skipped} already in your list).`);
      } else {
        flash(`Added ${added} reward${added === 1 ? '' : 's'} from the library.`);
      }
    } catch (e: any) {
      flash(e?.message || 'Import failed.');
    }
    setImporting(false);
  };

  // Union of seed categories + anything already used. Keeps the dropdown
  // useful before any reward exists and growing as parents type new ones.
  const categories = useMemo(() => {
    const seeded = DEFAULT_REWARD_CATEGORIES.map((c) => c.name);
    const used = rewards.map((r) => r.category || DEFAULT_REWARD_CATEGORY);
    return Array.from(new Set([...seeded, ...used]));
  }, [rewards]);

  const iconFor = (name: string) =>
    DEFAULT_REWARD_CATEGORIES.find((c) => c.name === name)?.icon || '🏷️';

  const groupedRewards = useMemo(() => {
    const filtered = filterCategory
      ? rewards.filter((r) => (r.category || DEFAULT_REWARD_CATEGORY) === filterCategory)
      : rewards;
    const map = new Map<string, Reward[]>();
    for (const r of filtered) {
      const key = r.category || DEFAULT_REWARD_CATEGORY;
      const bucket = map.get(key) || [];
      bucket.push(r);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rewards, filterCategory]);

  const startEdit = (r: Reward) => {
    setEditingId(r.id);
    setEditDraft({
      title: r.title,
      description: r.description,
      pointsCost: r.pointsCost,
      icon: r.icon,
      active: r.active,
      category: r.category || DEFAULT_REWARD_CATEGORY,
    });
    setMessage('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(blankDraft());
  };

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 2400);
  };

  const validate = (d: Draft): string | null => {
    if (!d.title.trim()) return 'Reward needs a title.';
    if (d.pointsCost < 1) return 'Points cost must be at least 1.';
    if (!d.category?.trim()) return 'Pick or type a category.';
    return null;
  };

  const saveEdit = async (id: string) => {
    if (isGuest || !profile?.familyId) return;
    const err = validate(editDraft);
    if (err) { flash(err); return; }
    setBusyId(id);
    try {
      await updateReward(profile.familyId, id, {
        ...editDraft,
        title: editDraft.title.trim(),
        description: editDraft.description.trim(),
        category: editDraft.category?.trim() || DEFAULT_REWARD_CATEGORY,
        icon: editDraft.icon.trim() || '🎁',
      });
      await refresh();
      cancelEdit();
      flash('Saved.');
    } catch (e: any) {
      flash(e?.message || 'Save failed.');
    }
    setBusyId(null);
  };

  const saveAdd = async () => {
    if (isGuest || !profile?.familyId) return;
    const err = validate(addDraft);
    if (err) { flash(err); return; }
    setBusyId('__add__');
    try {
      await addReward(profile.familyId, {
        ...addDraft,
        title: addDraft.title.trim(),
        description: addDraft.description.trim(),
        category: addDraft.category?.trim() || DEFAULT_REWARD_CATEGORY,
        icon: addDraft.icon.trim() || '🎁',
        // 💡 RWI PR-B — the idea-by credit stays on the card forever.
        ...(proposalFor ? { ideaBy: { childId: proposalFor.kidId, name: kidNameOf(proposalFor.kidId) } } : {}),
      });
      // Approving an idea also resolves the kid's request (+ their 🔔 bell).
      if (proposalFor && user) {
        await resolveApprovalRequest(profile.familyId, proposalFor.id, 'approved', user.uid, undefined, proposalNote.trim() || undefined);
        await loadProposals();
      }
      await refresh();
      setAddDraft(blankDraft());
      setAdding(false);
      flash(proposalFor ? `🎉 ${kidNameOf(proposalFor.kidId)}’s idea is now a real reward!` : 'Reward added.');
      setProposalFor(null); setProposalNote('');
    } catch (e: any) {
      flash(e?.message || 'Add failed.');
    }
    setBusyId(null);
  };

  // 💡 RWI PR-B — inbox actions.
  const startFromIdea = (p: ApprovalRequest) => {
    setProposalFor(p);
    setProposalNote('');
    setAddDraft({
      ...blankDraft(),
      title: p.rewardTitle || '',
      pointsCost: p.rewardPointsCost || 25,
      category: p.proposedCategory?.trim() || DEFAULT_REWARD_CATEGORY,
    });
    setAdding(true);
    setEditingId(null);
  };
  const declineIdea = async (p: ApprovalRequest) => {
    if (isGuest || !profile?.familyId || !user || ideaBusy) return;
    setIdeaBusy(true);
    try {
      const note = declineNote.trim();
      await resolveApprovalRequest(profile.familyId, p.id, 'rejected', user.uid, note, note || undefined);
      await loadProposals();
      setDecliningId(null); setDeclineNote('');
      flash(`Sent back to ${kidNameOf(p.kidId)} with your note.`);
    } catch (e: any) {
      flash(e?.message || 'Could not send the reply.');
    }
    setIdeaBusy(false);
  };

  const toggleActive = async (r: Reward) => {
    if (isGuest || !profile?.familyId) return;
    setBusyId(r.id);
    try {
      await updateReward(profile.familyId, r.id, { active: !r.active });
      await refresh();
    } catch (e: any) {
      flash(e?.message || 'Update failed.');
    }
    setBusyId(null);
  };

  // 👨‍👩‍👧 RWD PR5 (R24) — family-goal creation.
  const [fgTitle, setFgTitle] = useState('');
  const [fgIcon, setFgIcon] = useState('🎪');
  const [fgTarget, setFgTarget] = useState('');
  const [fgMode, setFgMode] = useState<'equal' | 'open'>('equal');
  const [fgNote, setFgNote] = useState('');
  const [fgBusy, setFgBusy] = useState(false);
  const createFamilyGoal = async () => {
    if (isGuest || !profile?.familyId || fgBusy) return;
    const target = parseInt(fgTarget, 10);
    if (!fgTitle.trim() || !(target > 0)) return;
    setFgBusy(true);
    try {
      await addReward(profile.familyId, {
        title: fgTitle.trim(),
        description: 'A family goal — everyone chips in!',
        pointsCost: target,
        icon: fgIcon.trim() || '🎪',
        active: true,
        category: 'Family goals',
        kind: 'family',
        targetPoints: target,
        poolMode: fgMode,
        ...(fgNote.trim() ? { parentNote: fgNote.trim() } : {}),
        contributedTotal: 0,
        contributions: {},
      } as Omit<Reward, 'id'>);
      setFgTitle(''); setFgTarget(''); setFgNote('');
      flash('🎊 Family goal created — it’s live on the store!');
      await refresh();
    } catch (e: any) { flash(e?.message || 'Could not create the goal.'); }
    setFgBusy(false);
  };

  // 🔒 RWD PR4 (R21) — lock/unlock + optional auto-unlock date.
  const toggleLock = async (r: Reward) => {
    if (isGuest || !profile?.familyId) return;
    setBusyId(r.id);
    try {
      await updateReward(profile.familyId, r.id, r.locked
        ? ({ locked: false, unlockNotified: true } as Partial<Reward>)
        : ({ locked: true, unlockNotified: false } as Partial<Reward>));
      await refresh();
    } catch (e: any) { flash(e?.message || 'Update failed.'); }
    setBusyId(null);
  };
  // 🎂 RWD PR6 — per-reward minimum age (empty clears).
  const setMinAge = async (r: Reward, raw: string) => {
    if (isGuest || !profile?.familyId) return;
    const n = parseInt(raw, 10);
    const next = Number.isFinite(n) && n > 0 ? n : 0;
    if ((r.minAge ?? 0) === next) return;
    setBusyId(r.id);
    try {
      await updateReward(profile.familyId, r.id, { minAge: next } as Partial<Reward>);
      await refresh();
    } catch (e: any) { flash(e?.message || 'Update failed.'); }
    setBusyId(null);
  };

  const setLockDate = async (r: Reward, date: string) => {
    if (isGuest || !profile?.familyId) return;
    setBusyId(r.id);
    try {
      await updateReward(profile.familyId, r.id, { lockedUntil: date || '' } as Partial<Reward>);
      await refresh();
    } catch (e: any) { flash(e?.message || 'Update failed.'); }
    setBusyId(null);
  };

  const remove = async (r: Reward) => {
    if (isGuest || !profile?.familyId) return;
    const ok = await confirmAction({
      title: `Delete "${r.title}"?`,
      message: 'Past redemptions stay in history.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(r.id);
    try {
      await deleteReward(profile.familyId, r.id);
      await refresh();
      flash('Reward removed.');
    } catch (e: any) {
      flash(e?.message || 'Delete failed.');
    }
    setBusyId(null);
  };

  // Sync addDraft category to filter if a parent is browsing a category
  // and clicks Add — pre-fill makes the new reward land in that bucket.
  useEffect(() => {
    if (adding && filterCategory) {
      setAddDraft((d) => ({ ...d, category: filterCategory }));
    }
  }, [adding, filterCategory]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-4xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-bold uppercase tracking-[3px] text-kaya-gold">Parent · Kaya</p>
        <h1 className="font-display font-black text-3xl lg:text-[40px] mt-1">Manage rewards</h1>
        <p className="text-sm text-kaya-sand mt-2">
          Add new rewards, edit point costs, change categories or retire ones you&apos;re not using.
          Kids see the active rewards on the Rewards Store page, grouped by category.
        </p>
      </div>

      {/* ⚙️ Store rules — FIRST thing on the page (Elia couldn't find it
          below the list, 26-Jul): 🛡 floor + per-kid, ⚡ auto-approve,
          👨‍👩‍👧 family-goals age gate + per-reward 🎂 min ages live on the
          reward rows below. */}
      <div className="mb-4">
        <CollapsibleSection
          id="store-rules"
          remember
          icon="⚙️"
          title="Store rules — floor · auto-approve · ages"
          summary={family?.rewardsConfig?.minPointsFloor ? `🛡 ${family.rewardsConfig.minPointsFloor} pts protected` : 'tap to set up'}
        >
          <RewardsRulesCard />
        </CollapsibleSection>
      </div>

      {message && (
        <div className="bg-kaya-gold/10 border border-kaya-gold/30 rounded-kaya-sm p-3 mb-4 text-center text-sm font-semibold animate-slide-up">
          {message}
        </div>
      )}

      {/* Category overview + filter */}
      <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-4 lg:p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Categories</p>
          <p className="text-[11px] text-kaya-sand">{rewards.length} reward{rewards.length === 1 ? '' : 's'} total</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterCategory(null)}
            className={`h-8 px-3 rounded-full text-xs font-bold border transition-colors ${
              filterCategory === null
                ? 'bg-kaya-chocolate text-white border-transparent'
                : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
            }`}
          >
            All ({rewards.length})
          </button>
          {categories.map((cat) => {
            const count = rewards.filter((r) => (r.category || DEFAULT_REWARD_CATEGORY) === cat).length;
            const sel = filterCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(sel ? null : cat)}
                className={`h-8 px-3 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                  sel
                    ? 'bg-kaya-chocolate text-white border-transparent'
                    : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
                }`}
              >
                <span>{iconFor(cat)}</span>
                <span>{cat}</span>
                <span className={sel ? 'text-white/70' : 'text-kaya-sand-light'}>({count})</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-kaya-sand mt-3">
          To add a new category, just type its name in any reward&apos;s category field. It&apos;ll
          show up here automatically.
        </p>
      </div>

      {/* Add new reward / Browse library buttons */}
      {!adding && !libraryOpen && (
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            onClick={() => { setAdding(true); setAddDraft(blankDraft()); }}
            disabled={isGuest}
            className="h-12 rounded-kaya bg-kaya-gold text-white font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
          >
            + Add a new reward
          </button>
          <button
            onClick={() => { setLibraryOpen(true); setLibrarySelected(new Set()); setLibraryCategory(null); setLibraryQuery(''); }}
            disabled={isGuest}
            className="h-12 rounded-kaya bg-white border-2 border-kaya-gold text-kaya-chocolate font-bold text-sm hover:bg-kaya-gold/10 transition-colors disabled:opacity-50"
          >
            📚 Browse library
          </button>
        </div>
      )}

      {/* Browse-library picker — collapsed unless opened. */}
      {libraryOpen && (
        <div className="bg-white border-2 border-kaya-gold rounded-kaya-lg p-4 lg:p-5 mb-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-gold">Reward library</p>
              <p className="text-xs text-kaya-sand mt-1">
                {REWARD_LIBRARY.length} ready-made rewards across {REWARD_LIBRARY_CATEGORIES.length} categories.
                Tick what you like, hit import. Everything stays editable after.
              </p>
            </div>
            <button
              onClick={() => { setLibraryOpen(false); setLibrarySelected(new Set()); }}
              className="text-kaya-sand hover:text-kaya-chocolate text-2xl leading-none px-2"
              aria-label="Close library"
            >
              ×
            </button>
          </div>

          {/* Search + category filter */}
          <div className="flex flex-col lg:flex-row gap-2 mb-3">
            <input
              type="text"
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              placeholder="Search rewards…"
              className="flex-1 h-10 px-3 bg-kaya-warm/30 border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            />
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => setLibraryCategory(null)}
              className={`h-7 px-3 rounded-full text-[11px] font-bold border transition-colors ${
                libraryCategory === null
                  ? 'bg-kaya-chocolate text-white border-transparent'
                  : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
              }`}
            >
              All
            </button>
            {REWARD_LIBRARY_CATEGORIES.map((cat) => {
              const sel = libraryCategory === cat;
              const total = REWARD_LIBRARY.filter((r) => (r.category || DEFAULT_REWARD_CATEGORY) === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setLibraryCategory(sel ? null : cat)}
                  className={`h-7 px-3 rounded-full text-[11px] font-bold border transition-colors flex items-center gap-1 ${
                    sel
                      ? 'bg-kaya-chocolate text-white border-transparent'
                      : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-sand'
                  }`}
                >
                  <span>{iconFor(cat)}</span>{cat}<span className={sel ? 'text-white/70' : 'text-kaya-sand-light'}>({total})</span>
                </button>
              );
            })}
          </div>

          {/* Library item list — scrollable, capped height so the page
              never explodes into a wall of 60 cards. */}
          <div className="max-h-[480px] overflow-y-auto border border-kaya-warm-dark/60 rounded-kaya-sm divide-y divide-kaya-warm-dark/40">
            {visibleLibrary.length === 0 ? (
              <p className="p-5 text-center text-sm text-kaya-sand">No matches. Try clearing the search.</p>
            ) : (
              visibleLibrary.map((item) => {
                const already = existingTitles.has(item.title.trim().toLowerCase());
                const checked = librarySelected.has(item.title);
                return (
                  <label
                    key={item.title}
                    className={`flex items-center gap-3 p-3 transition-colors cursor-pointer ${
                      already ? 'opacity-50' : 'hover:bg-kaya-warm/20'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={already}
                      onChange={() => toggleLibrarySelect(item.title)}
                      className="w-5 h-5 accent-kaya-gold shrink-0"
                    />
                    <div className="w-10 h-10 rounded-[12px] bg-kaya-warm/60 flex items-center justify-center text-xl shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="font-bold text-sm leading-snug truncate">{item.title}</p>
                        {already && <span className="text-[10px] font-bold text-kaya-sand whitespace-nowrap">ALREADY ADDED</span>}
                      </div>
                      <p className="text-[11px] text-kaya-sand leading-snug">{item.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold text-kaya-gold">{fmt(item.pointsCost)} pts</span>
                        <span className="text-[10px] text-kaya-sand">· {item.category}</span>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-2 mt-4">
            <p className="text-xs text-kaya-sand flex-1">
              {librarySelected.size > 0
                ? `${librarySelected.size} selected`
                : 'Nothing selected yet'}
            </p>
            <button
              onClick={() => { setLibraryOpen(false); setLibrarySelected(new Set()); }}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-warm text-kaya-sand text-sm font-bold hover:bg-kaya-warm-dark"
            >
              Cancel
            </button>
            <button
              onClick={importSelected}
              disabled={importing || librarySelected.size === 0}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-gold text-white text-sm font-bold hover:bg-kaya-gold-dark disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${librarySelected.size || ''}`.trim()}
            </button>
          </div>
        </div>
      )}

      {/* 💡 RWI PR-B — ideas from the kids: inbox + scoreboard */}
      {(pendingIdeas.length > 0 || allProposals.length > 0) && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-gold">💡 Ideas from the kids</p>
            {pendingIdeas.length > 0 && (
              <span className="text-[10px] font-black text-white bg-kaya-rose rounded-full px-2 py-0.5" style={{ backgroundColor: '#E06A7B' }}>
                {pendingIdeas.length} new
              </span>
            )}
          </div>
          {pendingIdeas.length === 0 ? (
            <p className="text-[12.5px] text-kaya-sand">Inbox clear — new ideas from the kids land here.</p>
          ) : pendingIdeas.map((p) => (
            <div key={p.id} className="py-2.5 border-b border-dashed border-kaya-warm last:border-b-0">
              <p className="text-[13px] font-bold">
                💡 {p.rewardTitle} — {kidNameOf(p.kidId)}
                <span className="text-kaya-sand font-semibold">
                  {' '}· {p.rewardPointsCost ? `guessed ${fmt(p.rewardPointsCost)} pts` : 'let parents decide the points'}
                  {p.proposedCategory ? ` · ${p.proposedCategory}` : ''}
                </span>
              </p>
              {p.proposedWhy && <p className="text-[12px] italic text-kaya-sand mt-0.5">&ldquo;{p.proposedWhy}&rdquo;</p>}
              {decliningId === p.id ? (
                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  <input
                    value={declineNote}
                    onChange={(e) => setDeclineNote(e.target.value)}
                    maxLength={140}
                    placeholder={`A kind note for ${kidNameOf(p.kidId)} (why not this time)…`}
                    className="flex-1 min-w-[200px] h-9 px-3 rounded-kaya-sm border border-kaya-warm-dark text-[12px] focus:outline-none focus:border-kaya-gold"
                  />
                  <button onClick={() => void declineIdea(p)} disabled={ideaBusy}
                    className="h-9 px-3 rounded-kaya-sm bg-kaya-chocolate text-white text-[11.5px] font-bold disabled:opacity-50">
                    Send reply
                  </button>
                  <button onClick={() => { setDecliningId(null); setDeclineNote(''); }}
                    className="h-9 px-3 rounded-kaya-sm bg-kaya-warm text-kaya-sand text-[11.5px] font-bold">
                    Back
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <button onClick={() => startFromIdea(p)}
                    className="h-9 px-3.5 rounded-kaya-sm bg-kaya-gold text-white text-[11.5px] font-bold hover:bg-kaya-gold-dark">
                    ✅ Make it a reward
                  </button>
                  <button onClick={() => { setDecliningId(p.id); setDeclineNote(''); }}
                    className="h-9 px-3.5 rounded-kaya-sm bg-white border border-kaya-warm-dark text-kaya-sand text-[11.5px] font-bold hover:border-kaya-sand">
                    💬 Not this time
                  </button>
                </div>
              )}
            </div>
          ))}
          {allProposals.length > 0 && (
            <p className="text-[10.5px] text-kaya-sand font-semibold mt-2.5 pt-2 border-t border-dashed border-kaya-warm">
              📊 {Object.entries(allProposals.reduce((m, p) => {
                const k = kidNameOf(p.kidId);
                const cur = m[k] || { sent: 0, ok: 0 };
                m[k] = { sent: cur.sent + 1, ok: cur.ok + (p.status === 'approved' ? 1 : 0) };
                return m;
              }, {} as Record<string, { sent: number; ok: number }>))
                .map(([name, s]) => `${name} ${s.sent} sent · ${s.ok} became rewards ✅`)
                .join('  ·  ')}
            </p>
          )}
        </div>
      )}

      {/* Add-new inline form (shown when "Add a new reward" is clicked) */}
      {adding && (
        <div className="bg-white border-2 border-kaya-gold rounded-kaya-lg p-4 lg:p-5 mb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-gold mb-3">
            {proposalFor ? `New reward — from ${kidNameOf(proposalFor.kidId)}’s idea 💡` : 'New reward'}
          </p>
          {proposalFor?.proposedWhy && (
            <p className="text-[12px] italic text-kaya-sand mb-3 -mt-1">&ldquo;{proposalFor.proposedWhy}&rdquo; — {kidNameOf(proposalFor.kidId)}</p>
          )}
          <RewardForm
            draft={addDraft}
            setDraft={setAddDraft}
            categories={categories}
            iconFor={iconFor}
          />
          <div className="flex gap-2 mt-4">
            <button
              onClick={saveAdd}
              disabled={busyId === '__add__'}
              className="flex-1 h-10 rounded-kaya-sm bg-kaya-gold text-white text-sm font-bold hover:bg-kaya-gold-dark disabled:opacity-50"
            >
              {busyId === '__add__' ? 'Adding…' : proposalFor ? '✅ Approve idea & add reward' : 'Add reward'}
            </button>
            <button
              onClick={() => { setAdding(false); setAddDraft(blankDraft()); setProposalFor(null); setProposalNote(''); }}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-warm text-kaya-sand text-sm font-bold hover:bg-kaya-warm-dark"
            >
              Cancel
            </button>
          </div>
          {proposalFor && (
            <input
              value={proposalNote}
              onChange={(e) => setProposalNote(e.target.value)}
              maxLength={140}
              placeholder={`Note for ${kidNameOf(proposalFor.kidId)} (optional — goes with the 🔔 good news)…`}
              className="w-full h-9 px-3 mt-3 rounded-kaya-sm border border-kaya-warm-dark text-[12px] focus:outline-none focus:border-kaya-gold"
            />
          )}
        </div>
      )}

      {/* Reward list, grouped by category */}
      {rewards.length === 0 ? (
        <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-10 text-center">
          <p className="text-4xl mb-3">🎁</p>
          <p className="text-kaya-sand text-sm">No rewards yet. Add your first one above.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedRewards.map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-lg">{iconFor(cat)}</span>
                <h2 className="font-display font-extrabold text-base">{cat}</h2>
                <span className="text-[11px] text-kaya-sand font-semibold">· {items.length}</span>
              </div>
              <div className="space-y-3">
                {items.map((r) =>
                  editingId === r.id ? (
                    <div key={r.id} className="bg-white border-2 border-kaya-gold rounded-kaya-lg p-4 lg:p-5">
                      <RewardForm
                        draft={editDraft}
                        setDraft={setEditDraft}
                        categories={categories}
                        iconFor={iconFor}
                      />
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => saveEdit(r.id)}
                          disabled={busyId === r.id}
                          className="flex-1 h-10 rounded-kaya-sm bg-kaya-gold text-white text-sm font-bold hover:bg-kaya-gold-dark disabled:opacity-50"
                        >
                          {busyId === r.id ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="h-10 px-4 rounded-kaya-sm bg-kaya-warm text-kaya-sand text-sm font-bold hover:bg-kaya-warm-dark"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={r.id}
                      className={`bg-white border rounded-kaya p-4 ${
                        r.active ? 'border-kaya-warm-dark' : 'border-kaya-warm-dark/50 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-[14px] bg-kaya-warm/60 flex items-center justify-center text-2xl shrink-0">
                          {r.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-bold text-sm leading-snug break-words">{r.title}</p>
                              <p className="text-xs text-kaya-sand leading-snug mt-0.5 break-words">{r.description || <em className="opacity-70">No description</em>}</p>
                              {r.ideaBy && (
                                <p className="text-[10.5px] font-bold mt-0.5" style={{ color: '#6B3FE0' }}>💡 idea by {r.ideaBy.name}</p>
                              )}
                              {/* 💬 RWD PR2 (R16) — aggregated kid reactions for this reward. */}
                              {(() => {
                                const fb = redemptions.filter((d) => d.rewardId === r.id && d.feedback);
                                if (fb.length === 0) return null;
                                const c = (k: string) => fb.filter((d) => d.feedback!.reaction === k).length;
                                const parts = [c('loved') && `😍×${c('loved')}`, c('ok') && `🙂×${c('ok')}`, c('meh') && `😕×${c('meh')}`].filter(Boolean);
                                const verdict = c('loved') >= fb.length / 2 ? 'kids love this one' : c('meh') > c('loved') ? 'might need a rethink' : 'mixed reviews';
                                return <p className="text-[11px] font-semibold mt-1">{parts.join(' · ')} <span className="text-kaya-sand">— {verdict}</span></p>;
                              })()}
                            </div>
                            <span className="text-xs font-bold text-kaya-gold whitespace-nowrap shrink-0">
                              {fmt(r.pointsCost)} pts
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <button
                              onClick={() => startEdit(r)}
                              disabled={busyId === r.id}
                              className="h-8 px-3 rounded-kaya-sm bg-kaya-warm text-kaya-chocolate text-xs font-bold hover:bg-kaya-warm-dark disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => toggleActive(r)}
                              disabled={busyId === r.id}
                              className={`h-8 px-3 rounded-kaya-sm text-xs font-bold transition-colors disabled:opacity-50 ${
                                r.active
                                  ? 'bg-white border border-kaya-warm-dark text-kaya-sand hover:border-kaya-sand'
                                  : 'bg-kaya-gold/15 border border-kaya-gold/40 text-kaya-gold hover:bg-kaya-gold/25'
                              }`}
                            >
                              {r.active ? 'Hide from kids' : 'Show to kids'}
                            </button>
                            {/* 🔒 RWD PR4 (R21) — lock: still VISIBLE to kids (greyed,
                                'Coming soon' + countdown), unlike Hide. */}
                            <button
                              onClick={() => toggleLock(r)}
                              disabled={busyId === r.id}
                              className={`h-8 px-3 rounded-kaya-sm text-xs font-bold border transition-colors disabled:opacity-50 ${
                                r.locked
                                  ? 'bg-kaya-warm border-kaya-warm-dark text-kaya-chocolate'
                                  : 'bg-white border-kaya-warm-dark text-kaya-sand hover:border-kaya-sand'
                              }`}
                            >
                              {r.locked ? '🔓 Unlock now' : '🔒 Lock (coming soon)'}
                            </button>
                            <button
                              onClick={() => remove(r)}
                              disabled={busyId === r.id}
                              className="h-8 px-3 rounded-kaya-sm bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 ml-auto disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                          {/* 🎂 RWD PR6 — age to unlock: younger kids see it 🔒 "from age N". */}
                          <div className="flex items-center gap-2 mt-2">
                            <label className="text-[11px] text-kaya-sand font-bold">🎂 Min age</label>
                            <input
                              type="number" min={0} max={25}
                              defaultValue={r.minAge ?? ''}
                              onBlur={(e) => setMinAge(r, e.target.value)}
                              placeholder="all"
                              className="h-8 w-20 px-2 rounded-kaya-sm border border-kaya-warm-dark/70 text-xs font-semibold text-right"
                            />
                            <span className="text-[10.5px] text-kaya-sand">empty = all ages · younger kids see it greyed 🔒 &ldquo;opens from age N&rdquo;, keep saving, and it opens by itself on their birthday · no birthday on file = no age limit</span>
                          </div>
                          {r.locked && (
                            <div className="flex items-center gap-2 mt-2">
                              <label className="text-[11px] text-kaya-sand font-bold">Auto-unlock on</label>
                              <input
                                type="date"
                                value={r.lockedUntil || ''}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setLockDate(r, e.target.value)}
                                className="h-8 px-2 rounded-kaya-sm border border-kaya-warm-dark/70 text-xs font-semibold"
                              />
                              <span className="text-[10.5px] text-kaya-sand">empty = until you unlock · kids see it greyed with a countdown</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 👨‍👩‍👧 New family goal (RWD PR5 · R24) — everyone chips in; the age
          gate (⚙️ Store rules at the top) decides who's included. */}
      <div className="mt-8 mb-4 bg-white border-2 border-kaya-gold/40 rounded-kaya p-4">
        <h2 className="font-display font-extrabold text-lg mb-1">👨‍👩‍👧 New family goal</h2>
        <p className="text-[11.5px] text-kaya-sand mb-3">A big reward the kids earn TOGETHER — equal shares, or an open pool where volunteers carry more. Who&apos;s included follows the age gate in Settings → 🎁 Rewards rules.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input value={fgTitle} onChange={(e) => setFgTitle(e.target.value)} placeholder="Goal name (e.g. Funfair day)" className="h-10 px-3 rounded-kaya-sm border border-kaya-warm-dark/70 text-sm font-semibold" />
          <div className="flex gap-2">
            <input value={fgIcon} onChange={(e) => setFgIcon(e.target.value)} placeholder="🎪" maxLength={4} className="h-10 w-16 px-2 rounded-kaya-sm border border-kaya-warm-dark/70 text-center text-lg" aria-label="Goal icon" />
            <input type="number" min={1} value={fgTarget} onChange={(e) => setFgTarget(e.target.value)} placeholder="Team target (pts)" className="h-10 flex-1 px-3 rounded-kaya-sm border border-kaya-warm-dark/70 text-sm font-semibold" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {(['equal', 'open'] as const).map((m) => (
            <button key={m} onClick={() => setFgMode(m)} className={`h-9 px-4 rounded-full text-[12px] font-bold border ${fgMode === m ? 'bg-kaya-chocolate text-white border-transparent' : 'bg-white text-kaya-sand border-kaya-warm-dark'}`}>
              {m === 'equal' ? '⚖️ Equal shares' : '🚀 Open pool (volunteers can carry more)'}
            </button>
          ))}
        </div>
        <input value={fgNote} onChange={(e) => setFgNote(e.target.value)} placeholder="Your advice to the team (optional) — e.g. 'Steady beats big!'" maxLength={140} className="w-full h-10 px-3 rounded-kaya-sm border border-kaya-warm-dark/70 text-sm mb-2" />
        <button onClick={createFamilyGoal} disabled={fgBusy || !fgTitle.trim() || !(parseInt(fgTarget, 10) > 0)} className="h-10 px-5 rounded-kaya-sm bg-kaya-gold text-white text-[13px] font-bold hover:bg-kaya-gold-dark disabled:opacity-50">
          {fgBusy ? 'Creating…' : 'Create family goal 🎊'}
        </button>
      </div>

      {/* Recent redemptions — denormalised title so this still reads
          correctly after a parent renames or deletes the underlying
          reward. Limited to 25 most-recent to keep the section calm. */}
      <div className="mt-8 mb-4">
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h2 className="font-display font-extrabold text-lg">Recent redemptions</h2>
          <button
            onClick={loadRedemptions}
            className="text-[11px] font-bold text-kaya-gold hover:text-kaya-gold-dark"
          >
            Refresh
          </button>
        </div>
        {redemptions.length === 0 ? (
          <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya p-6 text-center">
            <p className="text-2xl mb-2">📜</p>
            <p className="text-xs text-kaya-sand">
              No redemptions yet. They&apos;ll show up here as kids spend points.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya divide-y divide-kaya-warm-dark/40">
            {redemptions.map((r) => {
              const child = children.find((c) => c.id === r.childId);
              const when = r.createdAt?.toDate
                ? r.createdAt.toDate().toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })
                : '';
              return (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0"
                    style={{ backgroundColor: (child?.houseColor || '#C4B89A') + '33' }}
                  >
                    {child?.avatarEmoji || '👤'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">
                      <span className="font-bold">{child?.name || 'Someone'}</span>
                      <span className="text-kaya-sand"> redeemed </span>
                      <span className="font-semibold">{r.rewardTitle}</span>
                    </p>
                    <p className="text-[11px] text-kaya-sand mt-0.5">
                      {when}
                      {r.status === 'rejected' && ' · ✕ declined'}
                      {r.approvedBy === 'auto' && ' · ⚡ auto'}
                    </p>
                    {/* 💬 RWD PR2 (R16) — the kid's reaction, right in the feed. */}
                    {r.feedback && (
                      <p className="text-[11px] font-semibold mt-0.5">
                        {r.feedback.reaction === 'loved' ? '😍 Loved it' : r.feedback.reaction === 'ok' ? '🙂 It was OK' : '😕 Could be better'}
                        {r.feedback.text && <span className="text-kaya-sand italic"> — &ldquo;{r.feedback.text}&rdquo;</span>}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-bold text-kaya-gold whitespace-nowrap shrink-0">
                    −{fmt(r.pointsSpent)} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {redemptions.length === 25 && (
          <p className="text-[11px] text-kaya-sand mt-2 text-center">Showing the 25 most recent.</p>
        )}
      </div>
      <NextUp from="rewards" />
      <CoachMark
        pageId="rewards"
        uid={profile?.uid || ''}
        title="What can kids earn?"
        body="These are the rewards kids work toward — ice cream, extra story, sleepover. Tap “Add reward” for the guided 3-step wizard, or use the inline form for power-user adds."
      />
      <RewardsWizard
        open={wizardOpen}
        familyId={profile?.familyId || ''}
        onClose={() => setWizardOpen(false)}
        onSaved={() => { refresh(); flash('Reward added 🎁'); }}
      />
    </div>
  );
}

// ── Shared form for both add + edit ─────────────────────────────────
function RewardForm({
  draft, setDraft, categories, iconFor,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  categories: string[];
  iconFor: (name: string) => string;
}) {
  // Free-text category input with a datalist. Lets parents type a brand
  // new category or pick an existing one — same field, no extra "manage
  // categories" UI to maintain.
  const [categoryInput, setCategoryInput] = useState(draft.category || '');
  useEffect(() => { setCategoryInput(draft.category || ''); }, [draft.category]);

  // Points as a free string so a parent can clear the field completely and
  // type fresh (a forced Math.max(1,…) used to snap '' back to 1 and the next
  // digit appended to it). Draft only updates on a valid number; blur restores
  // the last good value if left empty.
  const [pointsInput, setPointsInput] = useState(String(draft.pointsCost));
  useEffect(() => { setPointsInput(String(draft.pointsCost)); }, [draft.pointsCost]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[80px_1fr] gap-3">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1">Icon</span>
          <input
            type="text"
            value={draft.icon}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
            maxLength={2}
            className="w-full h-12 px-3 bg-kaya-warm/40 border border-kaya-warm-dark rounded-kaya-sm text-center text-2xl focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            placeholder="🎁"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1">Title</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="e.g. Ice cream trip"
            className="w-full h-12 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1">Description</span>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="What the reward includes — optional but helps kids understand."
          rows={2}
          className="w-full px-3 py-2 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1">Points cost</span>
          <input
            type="number"
            value={pointsInput}
            onChange={(e) => {
              const raw = e.target.value;
              setPointsInput(raw);
              const n = parseInt(raw, 10);
              if (Number.isFinite(n) && n >= 1) setDraft({ ...draft, pointsCost: n });
            }}
            onBlur={() => { if (!pointsInput.trim()) setPointsInput(String(draft.pointsCost)); }}
            min={1}
            step={5}
            className="w-full h-12 px-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-center font-display font-black text-xl focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-kaya-sand mb-1">Category</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg pointer-events-none">
              {iconFor(categoryInput.trim() || DEFAULT_REWARD_CATEGORY)}
            </span>
            <input
              type="text"
              list="reward-category-options"
              value={categoryInput}
              onChange={(e) => {
                setCategoryInput(e.target.value);
                setDraft({ ...draft, category: e.target.value });
              }}
              placeholder="Type or pick…"
              className="w-full h-12 pl-10 pr-3 bg-white border border-kaya-warm-dark rounded-kaya-sm text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
            />
            <datalist id="reward-category-options">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </label>
      </div>

      <label className="flex items-center gap-3 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          className="w-5 h-5 accent-kaya-gold"
        />
        <span className="text-sm font-semibold">Show this reward to kids</span>
      </label>
    </div>
  );
}
