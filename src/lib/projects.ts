// Kaya Business · Kids Projects (Phase 2 · Cluster B).
//
// A maker space "under" Kaya Business: kids design + build things (crafts, a
// gadget, art, a recipe), capture photos, get AI design help, and optionally
// share to Moments so the memories last. Projects are creative — no money —
// and can optionally link to a business.
//
// Layout: families/{f}/projects/{projectId}. Kids create + edit their own
// freely; adding a sibling collaborator + sharing to Moments need a parent OK
// (handled in the UI / B2). Photos live in Storage under the project.

import {
  collection, doc, getDoc, addDoc, updateDoc,
  query, where, onSnapshot, arrayUnion, arrayRemove,
  Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type ProjectStatus = 'idea' | 'building' | 'done';

export interface Project {
  id: string;
  ownerId: string;              // Child.id
  title: string;
  description?: string;
  category?: string;            // free-form: craft, build, art, code, recipe…
  status: ProjectStatus;
  photoUrls: string[];
  collaboratorIds?: string[];   // sibling kids — parent-gated add (B2)
  linkedBusinessId?: string;    // optional tie to a business
  sharedMomentPostId?: string;  // set once shared to Moments (B2)
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; emoji: string; pill: string }> = {
  idea:     { label: 'Idea',     emoji: '💡', pill: 'bg-[#FCEAD6] text-[#B25E16]' },
  building: { label: 'Building', emoji: '🔨', pill: 'bg-[#E8F0FF] text-[#3F7AAF]' },
  done:     { label: 'Done',     emoji: '🎉', pill: 'bg-[#E2F0E2] text-[#2F7D32]' },
};

const projectsCol = (familyId: string) => collection(db, 'families', familyId, 'projects');
const projectDoc = (familyId: string, projectId: string) => doc(db, 'families', familyId, 'projects', projectId);

export interface NewProjectInput {
  title: string;
  description?: string;
  category?: string;
  status?: ProjectStatus;
  linkedBusinessId?: string;
}

export async function createProject(
  familyId: string,
  input: NewProjectInput,
  actor: { uid: string; ownerId: string },
): Promise<string> {
  if (isGuestActive()) return 'guest-project';
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    ownerId: actor.ownerId,
    title: input.title.trim(),
    status: input.status || 'idea',
    photoUrls: [],
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
  };
  if (input.description?.trim()) data.description = input.description.trim();
  if (input.category?.trim()) data.category = input.category.trim();
  if (input.linkedBusinessId) data.linkedBusinessId = input.linkedBusinessId;
  const ref = await addDoc(projectsCol(familyId), data);
  return ref.id;
}

export async function updateProject(
  familyId: string,
  projectId: string,
  patch: Partial<Pick<Project, 'title' | 'description' | 'category' | 'status' | 'linkedBusinessId' | 'sharedMomentPostId'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(projectDoc(familyId, projectId), { ...patch, updatedAt: serverTimestamp() } as Record<string, unknown>);
}

export async function addProjectPhotoUrl(familyId: string, projectId: string, url: string): Promise<void> {
  if (isGuestActive() || !url) return;
  await updateDoc(projectDoc(familyId, projectId), { photoUrls: arrayUnion(url), updatedAt: serverTimestamp() });
}

export async function removeProjectPhotoUrl(familyId: string, projectId: string, url: string): Promise<void> {
  if (isGuestActive() || !url) return;
  await updateDoc(projectDoc(familyId, projectId), { photoUrls: arrayRemove(url), updatedAt: serverTimestamp() });
}

/** Parent-gated: add/remove a sibling collaborator (B2 wires the parent OK). */
export async function setProjectCollaborator(familyId: string, projectId: string, childId: string, add: boolean): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(projectDoc(familyId, projectId), {
    collaboratorIds: add ? arrayUnion(childId) : arrayRemove(childId),
    updatedAt: serverTimestamp(),
  });
}

export async function getProject(familyId: string, projectId: string): Promise<Project | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(projectDoc(familyId, projectId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Project) : null;
}

export function subscribeToProject(familyId: string, projectId: string, cb: (p: Project | null) => void): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(projectDoc(familyId, projectId), (s) => cb(s.exists() ? ({ id: s.id, ...s.data() } as Project) : null));
}

function sortByUpdatedDesc(rows: Project[]): Project[] {
  return rows.sort((a, b) => ((b.updatedAt as any)?.toMillis?.() ?? 0) - ((a.updatedAt as any)?.toMillis?.() ?? 0));
}

/** One kid's projects (incl. ones they collaborate on). Two equality-only
 *  subscriptions merged + client-sorted — no composite index. */
export function subscribeToKidProjects(familyId: string, kidId: string, cb: (projects: Project[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  let owned: Project[] = [];
  let collab: Project[] = [];
  const emit = () => {
    const map = new Map<string, Project>();
    [...owned, ...collab].forEach((p) => map.set(p.id, p));
    cb(sortByUpdatedDesc([...map.values()]));
  };
  const u1 = onSnapshot(query(projectsCol(familyId), where('ownerId', '==', kidId)), (s) => {
    owned = s.docs.map((d) => ({ id: d.id, ...d.data() } as Project)); emit();
  });
  const u2 = onSnapshot(query(projectsCol(familyId), where('collaboratorIds', 'array-contains', kidId)), (s) => {
    collab = s.docs.map((d) => ({ id: d.id, ...d.data() } as Project)); emit();
  });
  return () => { u1(); u2(); };
}

/** All family projects (parent overview). */
export function subscribeToFamilyProjects(familyId: string, cb: (projects: Project[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(projectsCol(familyId), (s) => cb(sortByUpdatedDesc(s.docs.map((d) => ({ id: d.id, ...d.data() } as Project)))));
}
