// Kaya Sparks · same-origin URL helpers for a material file.
//
// Open + download both route through /api/sparks/material-file so the kid's
// device never touches the cross-origin Firebase Storage URL directly
// (which breaks iframe-open on iOS and CORS-blocks the download — see the
// route file for the full why).

/** Same-origin URL that serves the file for INLINE viewing (iframe / img). */
export function materialInlineUrl(fileUrl: string, name?: string): string {
  const q = new URLSearchParams({ url: fileUrl, mode: 'inline' });
  if (name) q.set('name', name);
  return `/api/sparks/material-file?${q.toString()}`;
}

/** Same-origin URL that serves the file as a DOWNLOAD (attachment). */
export function materialDownloadUrl(fileUrl: string, name?: string): string {
  const q = new URLSearchParams({ url: fileUrl, mode: 'download' });
  if (name) q.set('name', name);
  return `/api/sparks/material-file?${q.toString()}`;
}
