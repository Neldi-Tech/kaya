'use client';

// /moments/albums/new — create a new album.
//
// Optional ?parent=<albumId> query param marks this as a sub-album
// flow. The access picker inherits the parent's constraints so the
// kid you hid the surprise from stays hidden in any sub-album too.

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Album, AlbumAccessMode, createAlbum, getAlbum,
  subscribeToTopLevelAlbums,
} from '@/lib/albums';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import {
  canCreateTopLevelAlbum, canCreateSubAlbum, canUseCustomAccess,
  resolvePlan,
} from '@/lib/keepsakeLimits';
import BackButton from '@/components/ui/BackButton';
import AccessPickerSheet from '@/components/moments/AccessPickerSheet';
import UpgradeCard from '@/components/moments/UpgradeCard';

export default function NewAlbumPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-kaya-sand">Loading…</div>}>
      <NewAlbumForm />
    </Suspense>
  );
}

function NewAlbumForm() {
  const search = useSearchParams();
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();

  const parentAlbumId = search?.get('parent') || null;
  const plan = resolvePlan(family?.plan);
  const customGate = canUseCustomAccess(plan);

  const [parentAlbum, setParentAlbum] = useState<Album | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [topLevelCount, setTopLevelCount] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessMode, setAccessMode] = useState<AlbumAccessMode>('all_family');
  const [accessList, setAccessList] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the parent album (if any) so the picker can enforce
  // inheritance. Also load family members for the picker, and the
  // current top-level album count for the gate.
  useEffect(() => {
    if (!profile?.familyId) return;
    void getFamilyMembers(profile.familyId).then(setMembers);
    if (parentAlbumId) {
      void getAlbum(profile.familyId, parentAlbumId).then(setParentAlbum);
    }
    // One-shot count via the live subscription — unsubscribe once we
    // have the first snapshot. (A getDocs would be simpler but this
    // reuses the existing query path that's already indexed.)
    const unsub = subscribeToTopLevelAlbums(profile.familyId, (list) => {
      setTopLevelCount(list.length);
      unsub();
    });
  }, [profile?.familyId, parentAlbumId]);

  // For a sub-album under a custom-access parent, default the
  // initial access to match the parent's list so the user only has
  // to narrow rather than start from zero.
  useEffect(() => {
    if (parentAlbum && parentAlbum.accessMode === 'custom') {
      setAccessMode('custom');
      setAccessList(parentAlbum.accessList);
    }
  }, [parentAlbum]);

  // Block top-level creation when free-tier cap is hit. For sub-
  // albums we ignore the top-level count and check the sub gate.
  const isSubAlbumFlow = !!parentAlbumId;
  const topLevelGate = canCreateTopLevelAlbum(plan, topLevelCount ?? 0);
  const subAlbumGate = canCreateSubAlbum(plan);
  const gate = isSubAlbumFlow ? subAlbumGate : topLevelGate;

  // Don't render the gate or form until we have the count — avoids
  // a flash of "Upgrade" before the snapshot resolves.
  if (!isSubAlbumFlow && topLevelCount === null) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <div className="text-center py-12 text-kaya-sand text-sm">Loading…</div>
      </div>
    );
  }

  if (!gate.allowed) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <h1 className="font-display text-2xl font-black tracking-tight mt-3 mb-4">
          {isSubAlbumFlow ? 'New sub-album' : 'New album'}
        </h1>
        <UpgradeCard
          reason={gate.reason || 'This needs a Family plan.'}
          ctaMode="notify"
          onNotify={() => alert('We\'ll email you when Family plan launches.')}
        />
      </div>
    );
  }

  const handleSave = async () => {
    setError(null);
    if (!profile?.familyId || !profile.uid) return;
    if (name.trim().length === 0) { setError('Give the album a name.'); return; }

    setSaving(true);
    try {
      const id = await createAlbum(profile.familyId, {
        name: name.trim(),
        description: description.trim(),
        parentAlbumId: parentAlbumId,
        accessMode,
        accessList: accessMode === 'custom' ? accessList : [],
        createdBy: profile.uid,
      });
      router.push(`/moments/albums/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create album.');
      setSaving(false);
    }
  };

  const accessLabel = accessMode === 'all_family'
    ? 'Whole family'
    : `${accessList.length} ${accessList.length === 1 ? 'person' : 'people'} selected`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <BackButton />

      <div className="mt-3 mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Keepsake</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">
          {isSubAlbumFlow ? 'New sub-album' : 'New album'}
        </h1>
        {parentAlbum && (
          <p className="text-sm text-kaya-sand mt-1">Inside <strong className="text-kaya-chocolate">{parentAlbum.name}</strong></p>
        )}
      </div>

      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 flex flex-col gap-4">
        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tanzania Trip '26"
            maxLength={60}
            className="w-full h-11 px-3 rounded-kaya-sm border border-kaya-warm-dark focus:border-kaya-chocolate focus:outline-none text-sm"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">
            Description <span className="text-kaya-sand-light font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short note — when, where, what made it memorable."
            maxLength={140}
            rows={2}
            className="w-full px-3 py-2 rounded-kaya-sm border border-kaya-warm-dark focus:border-kaya-chocolate focus:outline-none text-sm resize-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">Access</label>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-between p-3 rounded-kaya-sm border border-kaya-warm-dark hover:border-kaya-chocolate transition-colors"
          >
            <div className="text-left">
              <p className="font-display font-black text-sm text-kaya-chocolate">{accessLabel}</p>
              <p className="text-[11px] text-kaya-sand mt-0.5">
                {accessMode === 'all_family' ? 'Every family member sees this' : 'Only the chosen people'}
              </p>
            </div>
            <span className="text-kaya-sand text-lg">›</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-xs rounded-md p-3 mt-3">{error}</div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full h-12 mt-5 bg-kaya-chocolate text-kaya-gold-light rounded-kaya-sm font-display font-black text-sm hover:bg-kaya-chocolate-light transition-colors disabled:opacity-50"
      >
        {saving ? 'Creating…' : 'Create album'}
      </button>

      <AccessPickerSheet
        open={pickerOpen}
        members={members}
        parentAlbum={parentAlbum}
        initialMode={accessMode}
        initialList={accessList}
        customDisabled={!customGate.allowed}
        customDisabledReason={customGate.reason}
        onSave={(mode, list) => { setAccessMode(mode); setAccessList(list); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
