// Kaya Wealth · document upload + attach (PR3 · 2026-06-01).
//
// Uploads an enhanced scan to Storage and attaches it to its asset — adding
// a WealthMedia entry to the asset's media[] AND an immutable 'document_added'
// edit-log entry, in one batch (so the audit trail can't miss a doc).
//
// Storage path: families/{familyId}/wealth/{assetId}/{docId}.jpg
// (parent-only in storage.rules; the download URL is only discoverable via
//  the asset doc, which is itself visibility-gated in firestore.rules.)

import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, collection, writeBatch, serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore';
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
