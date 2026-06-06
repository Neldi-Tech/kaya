// Kaya · same-origin URL helpers for any stored file (photo / PDF / doc).
//
// Open + download route through /api/file so the device never touches the
// cross-origin Firebase Storage URL directly (which hijacks the iframe on iOS
// and CORS-blocks the download). Generalises the Sparks material-file helpers
// so every surface — receipts, Moments, proof, Wealth docs, etc. — is covered.

const STORAGE_HOST = 'https://firebasestorage.googleapis.com/';

/** True when `url` is a Firebase Storage URL the /api/file proxy will serve.
 *  Non-storage URLs (e.g. external links) are left untouched by callers. */
export function isProxyableStorageUrl(url: string | undefined | null): url is string {
  return !!url && url.startsWith(STORAGE_HOST);
}

/** Same-origin URL that serves the file for INLINE viewing (iframe / img). */
export function fileInlineUrl(fileUrl: string, name?: string): string {
  const q = new URLSearchParams({ url: fileUrl, mode: 'inline' });
  if (name) q.set('name', name);
  return `/api/file?${q.toString()}`;
}

/** Same-origin URL that serves the file as a DOWNLOAD (attachment). */
export function fileDownloadUrl(fileUrl: string, name?: string): string {
  const q = new URLSearchParams({ url: fileUrl, mode: 'download' });
  if (name) q.set('name', name);
  return `/api/file?${q.toString()}`;
}
