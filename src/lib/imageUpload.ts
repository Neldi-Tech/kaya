// Client-side image processing so we can support "upload from device" for
// kid avatars without needing Firebase Storage (which would require Blaze
// plan). Resizes to a square, JPEG-encodes at quality 0.85, returns a
// data: URL. Result is small enough (~10–30KB) to store inline on the
// child document in Firestore.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on input
const TARGET_DIM = 256;
const TARGET_QUALITY = 0.85;

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That doesn’t look like an image file.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is too large — please pick something under 5 MB.');
  }

  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_DIM;
  canvas.height = TARGET_DIM;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');

  // Centre-crop to a square then scale to TARGET_DIM × TARGET_DIM.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_DIM, TARGET_DIM);

  return canvas.toDataURL('image/jpeg', TARGET_QUALITY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
