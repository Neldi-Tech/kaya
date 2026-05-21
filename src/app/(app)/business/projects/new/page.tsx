'use client';

// Kaya Business · new Kids Project. Kids start freely (creative sandbox).
// Photos + AI design help live on the project detail screen.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { ProjectStatus, createProject } from '@/lib/projects';

const CATEGORIES = ['Craft', 'Build', 'Art', 'Recipe', 'Code', 'Science', 'Other'];

export default function NewProjectPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { children } = useFamily();
  const { activeKidId } = useHive();
  const isParent = profile?.role === 'parent';

  const [forKid, setForKid] = useState<string | null>(activeKidId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('idea');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ownerId = isParent ? forKid : (profile?.childId ?? null);
  const canSubmit = title.trim().length > 1 && !!ownerId && !saving;

  const submit = async () => {
    if (!profile?.familyId || !ownerId) return;
    setError(''); setSaving(true);
    try {
      const id = await createProject(profile.familyId, {
        title: title.trim(), description: description.trim() || undefined,
        category: category || undefined, status,
      }, { uid: profile.uid, ownerId });
      router.push(id.startsWith('guest') ? '/business/projects' : `/business/projects/${id}`);
    } catch (e: any) {
      setError(e?.message || 'Could not create the project.');
      setSaving(false);
    }
  };

  const label = 'text-[11px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted mb-1.5 mt-3';
  const field = 'w-full h-11 px-3 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40';
  const chip = (active: boolean) =>
    `px-3 py-2 rounded-hive-pill text-[12.5px] font-nunito font-extrabold border transition ${active ? 'bg-hive-navy text-hive-honey border-transparent' : 'bg-hive-paper text-hive-muted border-hive-line'}`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-honey">
        <div className="text-[22px]">🎨</div>
        <div>
          <div className="font-nunito font-black text-[16px]">Start a project</div>
          <div className="text-[11px] text-hive-honey-soft/80">Make something — get AI help + snap photos as you go</div>
        </div>
      </div>

      {isParent && children.length > 0 && (
        <>
          <div className={label}>Whose project?</div>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <button key={c.id} onClick={() => setForKid(c.id)} className={chip(forKid === c.id)}>{c.avatarEmoji} {c.name}</button>
            ))}
          </div>
        </>
      )}

      <div className={label}>What are you making?</div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="e.g. A cardboard marble run" className={field} />

      <div className={label}>Kind (optional)</div>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCategory(category === c ? '' : c)} className={chip(category === c)}>{c}</button>
        ))}
      </div>

      <div className={label}>The idea (optional)</div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3}
        placeholder="What's your plan? What do you need?" className="w-full px-3 py-2 bg-hive-paper rounded-hive border border-hive-line text-[14px] focus:outline-none focus:ring-2 focus:ring-hive-honey/40" />

      <div className={label}>Where are you?</div>
      <div className="flex flex-wrap gap-2">
        {(['idea', 'building', 'done'] as ProjectStatus[]).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={chip(status === s)}>
            {s === 'idea' ? '💡 Idea' : s === 'building' ? '🔨 Building' : '🎉 Done'}
          </button>
        ))}
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

      <button onClick={submit} disabled={!canSubmit}
        className="w-full mt-5 h-12 rounded-hive bg-hive-navy text-hive-honey font-nunito font-black text-[14px] disabled:opacity-40 hover:brightness-110 active:scale-[0.99] transition">
        {saving ? 'Creating…' : 'Create project'}
      </button>
    </div>
  );
}
