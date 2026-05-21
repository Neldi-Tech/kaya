'use client';

// Kaya Business · Kids Project detail. The maker workspace: the idea, build
// status, and a photo gallery you grow as you go. AI design help + share-to-
// Moments + collaborators are added in B2 (marked below).

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  Project, ProjectStatus, PROJECT_STATUS_META,
  subscribeToProject, updateProject, addProjectPhotoUrl, removeProjectPhotoUrl,
} from '@/lib/projects';
import { uploadProjectPhoto, deleteBusinessPhoto } from '@/lib/businessPhoto';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params?.id || '');
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [project, setProject] = useState<Project | null>(null);
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

      {/* Coming next (B2) */}
      <div className="bg-[#F4ECD8] border border-hive-line rounded-hive p-4">
        <div className="text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5">Coming next</div>
        <p className="text-[13px] text-hive-navy/80 leading-relaxed">
          🤖 AI design help · 🤝 invite a sibling · 📸 share your best photo to Moments — landing in the next update.
        </p>
      </div>
    </div>
  );
}
