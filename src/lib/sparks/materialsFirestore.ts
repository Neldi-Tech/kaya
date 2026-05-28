// Kaya Sparks · Materials CRUD + Storage upload.

'use client';

import {
  collection, doc, deleteDoc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc,
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import type { SparksMaterial } from './materials';

/** Sanitise a filename so we never write an arbitrary path. */
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

/** Path under Storage where a material's file lives. */
function materialFilePath(familyId: string, materialId: string, filename: string): string {
  return `families/${familyId}/sparks_materials/${materialId}/${safeFilename(filename)}`;
}

/** Upload a file to Storage under a material's folder. Returns the
 *  download URL. The caller is responsible for the Firestore write. */
export async function uploadMaterialFile(
  familyId: string,
  materialId: string,
  file: File,
): Promise<{ url: string; storedName: string; sizeBytes: number; mime: string }> {
  const storedName = safeFilename(file.name || 'material');
  const ref = storageRef(storage, materialFilePath(familyId, materialId, storedName));
  await uploadBytes(ref, file, { contentType: file.type || undefined });
  const url = await getDownloadURL(ref);
  return {
    url,
    storedName: file.name || storedName,
    sizeBytes: file.size,
    mime: file.type || 'application/octet-stream',
  };
}

/** Reserve a material id without writing the doc — used so the file
 *  upload + Firestore write can share the same id. */
export function newMaterialId(familyId: string): string {
  return doc(collection(db, 'families', familyId, 'sparks_materials')).id;
}

export interface CreateMaterialInput {
  id: string;       // reserved via newMaterialId
  title: string;
  subject: string;
  description?: string;
  kind: 'file' | 'link';
  file_url?: string;
  file_name?: string;
  file_size_bytes?: number;
  file_mime?: string;
  link_url?: string;
  shared_with: 'all_kids' | string[];
  uploaded_by: string;
  uploaded_by_name: string;
}

export async function createMaterial(familyId: string, input: CreateMaterialInput): Promise<void> {
  // Strip undefineds — Firestore rejects them on create.
  const data: Record<string, unknown> = {
    title: input.title,
    subject: input.subject,
    kind: input.kind,
    shared_with: input.shared_with,
    uploaded_by: input.uploaded_by,
    uploaded_by_name: input.uploaded_by_name,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
  if (input.description) data.description = input.description;
  if (input.kind === 'file') {
    if (input.file_url) data.file_url = input.file_url;
    if (input.file_name) data.file_name = input.file_name;
    if (typeof input.file_size_bytes === 'number') data.file_size_bytes = input.file_size_bytes;
    if (input.file_mime) data.file_mime = input.file_mime;
  } else if (input.kind === 'link') {
    if (input.link_url) data.link_url = input.link_url;
  }
  await setDoc(doc(db, 'families', familyId, 'sparks_materials', input.id), data);
}

export interface UpdateMaterialInput {
  title?: string;
  subject?: string;
  description?: string;
  shared_with?: 'all_kids' | string[];
}

export async function updateMaterial(
  familyId: string, materialId: string, input: UpdateMaterialInput,
): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: serverTimestamp() };
  if (input.title    !== undefined) patch.title       = input.title;
  if (input.subject  !== undefined) patch.subject     = input.subject;
  if (input.description !== undefined) patch.description = input.description;
  if (input.shared_with !== undefined) patch.shared_with = input.shared_with;
  await updateDoc(doc(db, 'families', familyId, 'sparks_materials', materialId), patch);
}

/** Delete a material doc + its stored file (file kind). Stored blob
 *  cleanup is best-effort — a missing storage object should NOT block
 *  the Firestore delete. */
export async function deleteMaterial(
  familyId: string, material: SparksMaterial,
): Promise<void> {
  if (material.kind === 'file' && material.file_name) {
    try {
      const ref = storageRef(storage, materialFilePath(familyId, material.id, material.file_name));
      await deleteObject(ref);
    } catch {
      // ignore — storage may be already deleted or path may differ
    }
  }
  await deleteDoc(doc(db, 'families', familyId, 'sparks_materials', material.id));
}

/** Subscribe to ALL materials in a family. The caller filters per kid
 *  using `visibleToKid()` from materials.ts. We can't push the share
 *  filter into the query because Firestore can't do "OR" across
 *  shared_with == 'all_kids' AND shared_with.array-contains kidId. */
export function subscribeMaterials(
  familyId: string,
  cb: (items: SparksMaterial[]) => void,
): () => void {
  const q = query(
    collection(db, 'families', familyId, 'sparks_materials'),
    orderBy('created_at', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    const items: SparksMaterial[] = [];
    snap.forEach((d) => {
      const data = d.data() as Omit<SparksMaterial, 'id'>;
      items.push({ ...data, id: d.id });
    });
    cb(items);
  });
}
