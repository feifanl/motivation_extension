// Upload pipeline: reject > 10 MB, downscale to a long edge, re-encode JPEG
// q=0.85, return a data URL small enough for storage.local. Wallpaper uses the
// default 2560px edge; pins pass a smaller edge to keep many images bounded.
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2560;
const QUALITY = 0.85;

export async function fileToDataUrl(file: File, maxEdge = MAX_EDGE): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error('Image too large (max 10 MB).');
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d');
  if (!cx) {
    bitmap.close();
    throw new Error('Canvas unavailable.');
  }
  cx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', QUALITY);
}
