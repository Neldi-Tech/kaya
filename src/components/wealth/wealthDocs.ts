// Kaya Wealth · document upload + attach (PR3 · 2026-06-01).
//
// Uploads an enhanced scan to Storage and attaches it to its asset — adding
// a WealthMedia entry to the asset's media[] AND an immutable 'document_added'
// edit-log entry, in one batch (so the audit trail can't miss a doc).
//
// Storage path: families/{familyId}/wealth/{assetId}/{docId}.jpg
// (parent-only in storage.rules; the download URL is only discoverable via
//  the asset doc, which is itself visibility-gated in firestore.rules.)

import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { doc, collection, writeBatch, setDoc, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, Timestamp } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { isGuestActive } from '@/lib/mockFamily';
import type { WealthMedia, WealthAuthor } from '@/lib/wealth';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function uploadWealthDocument(args: {
  familyId: string;
  assetId: string;
  blob: Blob;
  label: string;
  enhanced: boolean;
  author: WealthAuthor;
}): Promise<WealthMedia | null> {
  if (isGuestActive()) return null;
  const id = newId();
  const path = `families/${args.familyId}/wealth/${args.assetId}/${id}.jpg`;
  const sref = storageRef(storage, path);
  await uploadBytes(sref, args.blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(sref);

  // Concrete Timestamp (not serverTimestamp) — Firestore forbids sentinel
  // values inside array elements (arrayUnion).
  const media: WealthMedia = {
    id,
    kind: 'scan',
    label: args.label.trim() || 'Document',
    storagePath: path,
    url,
    enhanced: args.enhanced,
    uploadedAt: Timestamp.now(),
  };

  const assetRef = doc(db, 'families', args.familyId, 'wealth_assets', args.assetId);
  const logRef = doc(collection(assetRef, 'editLog'));
  const batch = writeBatch(db);
  batch.update(assetRef, { media: arrayUnion(media), updatedAt: serverTimestamp() });
  batch.set(logRef, {
    ts: serverTimestamp(),
    authorId: args.author.uid,
    authorName: args.author.name,
    action: 'document_added',
    summary: `Document added — ${media.label}${args.enhanced ? ' (enhanced)' : ''}`,
  });
  await batch.commit();
  return media;
}

// ── Unfiled documents (general vault — scanned without attaching to an asset) ──
//
// Stored as an array on the parent-only config doc wealth_config/documents (the
// existing wealth_config rule covers it — no new rule). Blobs live under the
// existing storage path families/{f}/wealth/_unfiled/{id}.jpg (parent-only).

const UNFILED_ASSET = '_unfiled';

export interface WealthDocEntry {
  id: string;
  label: string;
  storagePath: string;
  url: string;
  enhanced: boolean;
  detectedType?: string;
  uploadedAt: Timestamp;
  authorId: string;
  authorName: string;
}

const docsRef = (familyId: string) => doc(db, 'families', familyId, 'wealth_config', 'documents');

export async function uploadUnfiledDocument(args: {
  familyId: string; blob: Blob; label: string; enhanced: boolean; author: WealthAuthor; detectedType?: string;
}): Promise<WealthDocEntry | null> {
  if (isGuestActive()) return null;
  const id = newId();
  const path = `families/${args.familyId}/wealth/${UNFILED_ASSET}/${id}.jpg`;
  const sref = storageRef(storage, path);
  await uploadBytes(sref, args.blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(sref);
  const entry: WealthDocEntry = {
    id, label: args.label.trim() || 'Document', storagePath: path, url,
    enhanced: args.enhanced, uploadedAt: Timestamp.now(),
    authorId: args.author.uid, authorName: args.author.name,
    ...(args.detectedType ? { detectedType: args.detectedType } : {}),
  };
  await setDoc(docsRef(args.familyId), { docs: arrayUnion(entry) }, { merge: true });
  return entry;
}

export function subscribeUnfiledDocs(familyId: string, cb: (docs: WealthDocEntry[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(docsRef(familyId),
    (snap) => {
      const arr = (snap.data()?.docs as WealthDocEntry[] | undefined) ?? [];
      cb([...arr].sort((a, b) => (b.uploadedAt?.toMillis?.() ?? 0) - (a.uploadedAt?.toMillis?.() ?? 0)));
    },
    // eslint-disable-next-line no-console
    (err) => { console.error('[wealth/docs] unfiled subscribe failed:', err); cb([]); },
  );
}

export async function deleteUnfiledDoc(familyId: string, entry: WealthDocEntry): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(docsRef(familyId), { docs: arrayRemove(entry) }, { merge: true });
  try { await deleteObject(storageRef(storage, entry.storagePath)); } catch { /* best-effort */ }
}
