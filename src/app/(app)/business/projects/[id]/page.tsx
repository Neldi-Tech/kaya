'use client';

// Kaya Business · Kids Project detail. The maker workspace: the idea, build
// status, and a photo gallery you grow as you go. AI design help + share-to-
// Moments + collaborators are added in B2 (marked below).

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Project, ProjectStatus, PROJECT_STATUS_META,
  subscribeToProject, updateProject, addProjectPhotoUrl, removeProjectPhotoUrl,
  shareProjectToMoments, setProjectCollaborator,
} from '@/lib/projects';
import { readBusinessConfig } from '@/lib/business';
import { uploadProjectPhoto, deleteBusinessPhoto } from '@/lib/businessPhoto';
import AICoachCard from '@/components/business/AICoachCard';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params?.id || '');
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const familyId = profile?.familyId;
  const coachName = readBusinessConfig(family).coachName;

  const [project, setProject] = useState<Project | null>(null);
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!familyId || !projectId) return;
    return subscribeToProject(familyId, projectId, (p) => { setProject(p); setLoading(false); });
  }, [familyId, projectId]);

  const isParent = profile?.role === 'parent';
  const isOwner = profile?.role === 'kid' && profile?.childId === project?.ownerId;
  const canEdit = isParent || isOwner;

  const setStatus = async (status: ProjectStatus) => {
    if (!familyId) return;
    try { await updateProject(familyId, projectId, { status }); }
    catch (e: any) { setError(e?.message || 'Could not update.'); }
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !familyId) return;
    setError(''); setUploading(true);
    try {
      const url = await uploadProjectPhoto(familyId, projectId, f);
      if (url) await addProjectPhotoUrl(familyId, projectId, url);
    } catch (err: any) {
      setError(err?.message || 'Could not add the photo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (url: string) => {
    if (!familyId) return;
    try { await removeProjectPhotoUrl(familyId, projectId, url); void deleteBusinessPhoto(url); }
    catch (e: any) { setError(e?.message || 'Could not remove.'); }
  };

  const share = async () => {
    if (!familyId || !project || !profile?.uid) return;
    if (!project.photoUrls?.length) { setError('Add a photo first, then share it.'); return; }
    setSharing(true); setError('');
    try {
      const kidName = children.find((c) => c.id === project.ownerId)?.name || 'A kid';
      await shareProjectToMoments(familyId, project, { uid: profile.uid, name: profile.displayName || 'Parent' }, kidName);
    } catch (e: any) { setError(e?.message || 'Could not share.'); }
    finally { setSharing(false); }
  };

  const toggleCollaborator = async (childId: string, add: boolean) => {
    if (!familyId) return;
    try { await setProjectCollaborator(familyId, projectId, childId, add); }
    catch (e: any) { setError(e?.message || 'Could not update.'); }
  };

  if (loading) return <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center text-hive-muted text-sm">Loading…</div>;
  if (!project) {
    return (
      <div className="mx-auto max-w-md lg:max-w-3xl px-4 lg:px-8 pt-10 text-center">
        <div className="text-5xl mb-3">🔍</div>
        <p className="font-nunito font-extrabold">Project not found</p>
        <button onClick={() => router.push('/business/projects')} className="mt-4 text-hive-honey-dk font-nunito font-extrabold text-[13px] hover:underline">← Back to projects</button>
      </div>
    );
  }

  const st = PROJECT_STATUS_META[project.status];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">{st.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px] truncate">{project.title}</div>
          <div className="text-[11px] text-hive-honey-soft/80">{project.category || 'Project'}</div>
        </div>
        <span className={`text-[11px] font-nunito font-black px-2.5 py-1 rounded-hive-pill ${st.pill}`}>{st.label}</span>
      </div>

      {project.description && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <p className="text-[13px] text-hive-navy/80 leading-relaxed whitespace-pre-line">{project.description}</p>
        </div>
      )}

      {/* Status control */}
      {canEdit && (
        <div className="flex gap-2 mb-3">
          {(['idea', 'building', 'done'] as ProjectStatus[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`flex-1 h-10 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition ${project.status === s ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
              {PROJECT_STATUS_META[s].emoji} {PROJECT_STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}

      {/* Photo gallery */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-nunito font-extrabold text-[14px]">Photos</h3>
          <span className="text-[11px] text-hive-muted">{project.photoUrls?.length || 0}</span>
        </div>
        {project.photoUrls?.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {project.photoUrls.map((url) => (
              <div key={url} className="relative aspect-square rounded-hive overflow-hidden border border-hive-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="Project" className="w-full h-full object-cover" />
                {canEdit && (
                  <button onClick={() => removePhoto(url)} aria-label="Remove photo"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white text-[12px] flex items-center justify-center">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full h-11 rounded-hive border-2 border-dashed border-hive-honey bg-[#FFFBEE] text-[13px] font-nunito font-bold text-[#B25E16] disabled:opacity-50">
              {uploading ? 'Adding…' : '📷 Add a photo'}
            </button>
          </>
        )}
        {(!project.photoUrls || project.photoUrls.length === 0) && !canEdit && (
          <p className="text-[12px] text-hive-muted text-center py-3">No photos yet.</p>
        )}
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold mb-3">{error}</p>}

      {/* AI design help */}
      {canEdit && (
        <div className="mb-3">
          <AICoachCard
            loop="design"
            coachName={coachName}
            cta={`Ask ${coachName} for design help`}
            facts={{
              project: project.title,
              kind: project.category || 'project',
              status: PROJECT_STATUS_META[project.status].label,
              ...(project.description ? { idea: project.description } : {}),
              photos: project.photoUrls?.length || 0,
            }}
          />
        </div>
      )}

      {/* Teammates (parent-gated add) */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <h3 className="font-nunito font-extrabold text-[14px] mb-2">🤝 Teammates</h3>
        {(project.collaboratorIds?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2 mb-2">
            {project.collaboratorIds!.map((cid) => {
              const c = children.find((k) => k.id === cid);
              return <span key={cid} className="px-2.5 py-1 rounded-hive-pill bg-hive-cream text-[12px] font-nunito font-bold">{c?.avatarEmoji} {c?.name || 'Teammate'}</span>;
            })}
          </div>
        ) : (
          <p className="text-[12px] text-hive-muted mb-2">Just you for now.</p>
        )}
        {isParent ? (
          <div className="flex flex-wrap gap-2">
            {children.filter((c) => c.id !== project.ownerId).map((c) => {
              const on = project.collaboratorIds?.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggleCollaborator(c.id, !on)}
                  className={`px-3 py-1.5 rounded-hive-pill text-[12px] font-nunito font-extrabold border transition ${on ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`}>
                  {on ? '✓ ' : '+ '}{c.avatarEmoji} {c.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-hive-muted">Ask a parent to add a sibling teammate.</p>
        )}
      </div>

      {/* Share to Moments — parent OK (per the locked decision) */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
        <h3 className="font-nunito font-extrabold text-[14px] mb-1">📸 Share to Moments</h3>
        {project.sharedMomentPostId ? (
          <p className="text-[12.5px] text-[#2F7D32] font-nunito font-bold">✓ Shared to the family feed — the memory lasts!</p>
        ) : isParent ? (
          <>
            <p className="text-[12px] text-hive-muted mb-2">Post this project&apos;s photos to the family Moments feed.</p>
            <button onClick={share} disabled={sharing || !project.photoUrls?.length}
              className="w-full h-11 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[13px] disabled:opacity-40 hover:brightness-110 transition">
              {sharing ? 'Sharing…' : project.photoUrls?.length ? 'Share to Moments' : 'Add a photo first'}
            </button>
          </>
        ) : (
          <p className="text-[12px] text-hive-muted">Ask a parent to share your favourite photo to Moments. 💛</p>
        )}
      </div>
    </div>
  );
}
