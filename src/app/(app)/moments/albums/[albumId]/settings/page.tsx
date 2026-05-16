'use client';

// /moments/albums/[albumId]/settings — manage an album.
//
// Rename, edit description, change access, delete. The parent album
// (if any) drives access-inheritance enforcement. Only the album's
// author or a parent in the family can mutate — UI mirrors the rule
// so unauthorized users see a read-only "view" state.

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Album, AlbumAccessMode, getAlbum, updateAlbumMeta, updateAlbumAccess,
  deleteAlbum,
} from '@/lib/albums';
import { getFamilyMembers, UserProfile } from '@/lib/firestore';
import { canUseCustomAccess, resolvePlan } from '@/lib/keepsakeLimits';
import BackButton from '@/components/ui/BackButton';
import AccessPickerSheet from '@/components/moments/AccessPickerSheet';

export default function AlbumSettingsPage() {
  const params = useParams<{ albumId: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();

  const [album, setAlbum] = useState<Album | null>(null);
  const [parentAlbum, setParentAlbum] = useState<Album | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessMode, setAccessMode] = useState<AlbumAccessMode>('all_family');
  const [accessList, setAccessList] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = resolvePlan(family?.plan);
  const customGate = canUseCustomAccess(plan);
  const isParent = profile?.role === 'parent';
  const canEdit = album && (isParent || album.createdBy === profile?.uid);

  useEffect(() => {
    if (!profile?.familyId || !params?.albumId) return;
    void getFamilyMembers(profile.familyId).then(setMembers);
    void getAlbum(profile.familyId, params.albumId).then(async (a) => {
      if (a) {
        setAlbum(a);
        setName(a.name);
        setDescription(a.description || '');
        setAccessMode(a.accessMode);
        setAccessList(a.accessList);
        if (a.parentAlbumId) {
          const p = await getAlbum(profile.familyId, a.parentAlbumId);
          setParentAlbum(p);
        }
      }
      setLoaded(true);
    });
  }, [profile?.familyId, params?.albumId]);

  if (!loaded) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <div className="text-center py-12 text-kaya-sand text-sm">Loading…</div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <p className="text-center py-12 text-kaya-sand text-sm">Album not found.</p>
      </div>
    );
  }

  const handleSaveMeta = async () => {
    if (!canEdit || !profile?.familyId) return;
    setSaving(true);
    setError(null);
    try {
      await updateAlbumMeta(profile.familyId, album.id, {
        name: name.trim() || album.name,
        description: description.trim(),
      });
      // Save access separately so a mode flip without rename still works.
      if (accessMode !== album.accessMode ||
          accessList.length !== album.accessList.length ||
          accessList.some((u) => !album.accessList.includes(u))) {
        await updateAlbumAccess(profile.familyId, album.id, accessMode, accessList);
      }
      router.push(`/moments/albums/${album.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !profile?.familyId) return;
    setSaving(true);
    try {
      await deleteAlbum(profile.familyId, album);
      router.push('/moments/albums');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
      setSaving(false);
    }
  };

  const accessLabel = accessMode === 'all_family'
    ? 'Whole family'
    : `${accessList.length} ${accessList.length === 1 ? 'person' : 'people'}`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <BackButton />

      <div className="mt-3 mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Settings</p>
        <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">{album.name}</h1>
      </div>

      {!canEdit && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs rounded-md p-3 mb-3">
          Only the album's creator or a parent can edit these settings.
        </div>
      )}

      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 flex flex-col gap-4">
        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={!canEdit}
            className="w-full h-11 px-3 rounded-kaya-sm border border-kaya-warm-dark focus:border-kaya-chocolate focus:outline-none text-sm disabled:bg-kaya-warm disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={140}
            rows={2}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-kaya-sm border border-kaya-warm-dark focus:border-kaya-chocolate focus:outline-none text-sm resize-none disabled:bg-kaya-warm disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-[11px] font-display font-black uppercase tracking-wider text-kaya-sand mb-1.5">Access</label>
          <button
            type="button"
            onClick={() => canEdit && setPickerOpen(true)}
            disabled={!canEdit}
            className="w-full flex items-center justify-between p-3 rounded-kaya-sm border border-kaya-warm-dark hover:border-kaya-chocolate transition-colors disabled:opacity-60"
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

      <div className="flex flex-col gap-2 mt-5">
        <button
          onClick={handleSaveMeta}
          disabled={!canEdit || saving}
          className="h-12 bg-kaya-chocolate text-kaya-gold-light rounded-kaya-sm font-display font-black text-sm hover:bg-kaya-chocolate-light transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>

        {canEdit && (
          confirmDelete ? (
            <div className="bg-red-50 border border-red-300 rounded-kaya-sm p-3">
              <p className="text-xs text-red-900 mb-3 font-bold">
                Delete <strong>{album.name}</strong>? All {album.photoCount} photos and any sub-albums will be removed permanently.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 h-10 bg-white border border-kaya-warm-dark rounded-kaya-sm text-xs font-display font-black hover:bg-kaya-warm"
                >Cancel</button>
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="flex-1 h-10 bg-red-700 text-white rounded-kaya-sm text-xs font-display font-black hover:bg-red-800 disabled:opacity-50"
                >{saving ? 'Deleting…' : 'Delete album'}</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="h-11 bg-white border border-red-300 text-red-700 rounded-kaya-sm font-display font-bold text-xs hover:bg-red-50 transition-colors"
            >
              Delete album
            </button>
          )
        )}
      </div>

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
