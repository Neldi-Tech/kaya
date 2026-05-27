// Trigger a real file download from a remote URL (image, document, etc.).
//
// Using a plain `<a href=... target="_blank">` (or `<a download>` on a
// cross-origin URL) navigates the browser to the Firebase Storage URL,
// which is why users see `firebasestorage.googleapis.com` in the URL
// bar. Fetching the bytes and saving them via a synthetic blob URL
// keeps the storage domain hidden and gives the saved file a
// human-friendly name.

export async function downloadImage(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function suggestedPhotoFilename(uploadedAt?: { toDate?: () => Date } | null): string {
  const d = uploadedAt?.toDate?.() ?? new Date();
  const stamp = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `kaya-${stamp}.jpg`;
}
