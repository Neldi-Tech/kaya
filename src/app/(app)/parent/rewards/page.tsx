'use client';

// /parent/rewards — Parents add, edit, retire and re-price the rewards
// kids spend points on. Categories are free-text per reward; the picker
// is seeded from DEFAULT_REWARD_CATEGORIES and unions in whatever the
// family has already typed. The kid-side /rewards page renders the same
// list grouped by category.

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  addReward, updateReward, deleteReward,
  DEFAULT_REWARD_CATEGORIES, DEFAULT_REWARD_CATEGORY,
  Reward,
} from '@/lib/firestore';
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
  const { profile, isGuest } = useAuth();
  const { rewards, refresh } = useFamily();

  // Inline edit state — one reward at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(blankDraft());

  // "Add new" form lives in a banner card so parents don't have to
  // hunt for a modal trigger.
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(blankDraft());

  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

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
      });
      await refresh();
      setAddDraft(blankDraft());
      setAdding(false);
      flash('Reward added.');
    } catch (e: any) {
      flash(e?.message || 'Add failed.');
    }
    setBusyId(null);
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

  const remove = async (r: Reward) => {
    if (isGuest || !profile?.familyId) return;
    if (!confirm(`Delete "${r.title}"? Past redemptions stay in history.`)) return;
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

      {/* Add new reward */}
      {!adding ? (
        <button
          onClick={() => { setAdding(true); setAddDraft(blankDraft()); }}
          disabled={isGuest}
          className="w-full mb-5 h-12 rounded-kaya bg-kaya-gold text-white font-bold text-sm hover:bg-kaya-gold-dark transition-colors disabled:opacity-50"
        >
          + Add a new reward
        </button>
      ) : (
        <div className="bg-white border-2 border-kaya-gold rounded-kaya-lg p-4 lg:p-5 mb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-gold mb-3">New reward</p>
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
              {busyId === '__add__' ? 'Adding…' : 'Add reward'}
            </button>
            <button
              onClick={() => { setAdding(false); setAddDraft(blankDraft()); }}
              className="h-10 px-4 rounded-kaya-sm bg-kaya-warm text-kaya-sand text-sm font-bold hover:bg-kaya-warm-dark"
            >
              Cancel
            </button>
          </div>
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
                            <button
                              onClick={() => remove(r)}
                              disabled={busyId === r.id}
                              className="h-8 px-3 rounded-kaya-sm bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 ml-auto disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
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
            value={draft.pointsCost}
            onChange={(e) => setDraft({ ...draft, pointsCost: Math.max(1, parseInt(e.target.value || '0', 10) || 0) })}
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
