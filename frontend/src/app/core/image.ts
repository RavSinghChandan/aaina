/** Downscale an image on the device before upload: faster on salon Wi-Fi, smaller payloads. */
export async function fileToDataUrl(file: File, maxSide = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  return drawScaled(bitmap, bitmap.width, bitmap.height, maxSide);
}

export function videoFrameToDataUrl(video: HTMLVideoElement, maxSide = 1024, mirror = true): string {
  return drawScaled(video, video.videoWidth, video.videoHeight, maxSide, mirror);
}

function drawScaled(src: CanvasImageSource, w: number, h: number, maxSide: number, mirror = false): string {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
