/**
 * On-device face measurement. MediaPipe finds 478 face points in the browser;
 * the photo never leaves the phone for this step. From those points we measure
 * face length against forehead, cheekbone and jaw width and name the face shape.
 */
export type FaceShape = 'oval' | 'round' | 'square' | 'heart' | 'oblong' | 'diamond';

export interface Point { x: number; y: number; }
export interface FaceMeasure {
  face_shape: FaceShape;
  confidence: number;
  quality: 'good' | 'ok' | 'poor';
  notes: string[];
  ratios: { length_to_cheek: number; jaw_to_cheek: number; forehead_to_jaw: number };
  /** The four measured lines, in image pixels, so the UI can show its working. */
  lines: { id: 'length' | 'forehead' | 'cheek' | 'jaw'; a: Point; b: Point }[];
  width: number;
  height: number;
  /** From the hair model: current colour and length. Null if it could not run. */
  hair: { rgb: [number, number, number]; color: string; length: 'short' | 'medium' | 'long' } | null;
  beard: boolean;
  /** Skin tone from bare cheek skin, so the preview drawing looks like the customer. */
  skin: [number, number, number];
}

// MediaPipe face-mesh landmark indices
const TOP = 10, CHIN = 152;
const FOREHEAD: [number, number] = [54, 284];
const CHEEK: [number, number] = [234, 454];
const JAW: [number, number] = [172, 397];
const EYES: [number, number] = [33, 263];
const CHIN_PATCH = [152, 175, 199, 200, 148, 377, 176, 400];   // where a beard grows
const CHEEK_PATCH = [50, 280, 123, 352, 116, 345];              // bare cheek skin below the cheekbones
const SKIN_PATCH = [151, 9, 108, 337, 69, 299, 50, 280, 123, 352]; // forehead and cheekbones, clear of glasses lenses

let landmarker: Promise<any> | null = null;

/** MediaPipe's WebAssembly prints routine "INFO:" lines through console.error; keep the console honest. */
function quietInfo() {
  const orig = console.error;
  if ((orig as any).__aaina) return;
  const wrapped = (...args: any[]) => { if (typeof args[0] === 'string' && args[0].startsWith('INFO:')) return; orig.apply(console, args); };
  (wrapped as any).__aaina = true;
  console.error = wrapped;
}

function load() {
  quietInfo();
  return (landmarker ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe');
    return FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task' },
      runningMode: 'IMAGE',
      numFaces: 2,
    });
  })().catch(e => { landmarker = null; throw e; }));
}

let segmenter: Promise<any> | null = null;
function loadHair() {
  return (segmenter ??= (async () => {
    const { ImageSegmenter, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe');
    return ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/models/hair_segmenter.tflite' },
      runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
    });
  })().catch(e => { segmenter = null; throw e; }));
}

/** Start downloading the models early so measuring feels instant. */
export function warmUp() { load().catch(() => {}); loadHair().catch(() => {}); }

export async function measureFace(dataUrl: string): Promise<FaceMeasure | { error: string }> {
  let lm: any;
  try { lm = await load(); } catch { return { error: 'Face measuring could not start on this device.' }; }
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const res = lm.detect(img);
  const faces: { x: number; y: number }[][] = res.faceLandmarks ?? [];
  if (!faces.length) return { error: 'We could not find a clear face. Use a close-up of just you, facing the camera, in good light.' };
  if (faces.length > 1) return { error: 'We found more than one face. Please use a photo with just you.' };

  const W = img.naturalWidth, H = img.naturalHeight;
  const p = (i: number): Point => ({ x: faces[0][i].x * W, y: faces[0][i].y * H });
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  const top = p(TOP), chin = p(CHIN);
  // Point 10 sits below the hairline; real face length runs about 12% further up.
  const up = { x: top.x - (chin.x - top.x) * 0.12, y: top.y - (chin.y - top.y) * 0.12 };
  const length = d(up, chin);
  const fh = [p(FOREHEAD[0]), p(FOREHEAD[1])], ck = [p(CHEEK[0]), p(CHEEK[1])], jw = [p(JAW[0]), p(JAW[1])];
  const forehead = d(fh[0], fh[1]), cheek = d(ck[0], ck[1]), jaw = d(jw[0], jw[1]);

  const L = length / cheek, J = jaw / cheek, F = forehead / jaw, FC = forehead / cheek;
  const { shape, margin } = classify(L, J, F, FC);

  // Quality: face size in frame and head tilt (eye line)
  const eyes = [p(EYES[0]), p(EYES[1])];
  const tilt = Math.abs(Math.atan2(eyes[1].y - eyes[0].y, eyes[1].x - eyes[0].x) * 180 / Math.PI);
  const share = cheek / W;
  const quality: FaceMeasure['quality'] = tilt > 12 || share < 0.18 ? 'poor' : tilt > 6 || share < 0.28 ? 'ok' : 'good';

  const notes = [
    `Face length is ${L.toFixed(2)}× its width`,
    J >= 0.86 ? 'Strong, wide jawline' : J <= 0.74 ? 'Narrow, tapered jaw' : 'Balanced jawline',
  ];
  if (FC >= 0.93) notes.push('Forehead about as wide as cheekbones');
  const confidence = Math.max(0.5, Math.min(0.92, 0.62 + margin * 2.2 - (quality === 'poor' ? 0.15 : quality === 'ok' ? 0.05 : 0)));

  const px = pixels(img);
  const lum = (ids: number[]) => avg(ids.map(i => p(i)), px).reduce((a, v, k) => a + v * [0.299, 0.587, 0.114][k], 0);
  const beard = lum(CHIN_PATCH) < lum(CHEEK_PATCH) * 0.62;
  const skin = median(SKIN_PATCH.map(i => avg([p(i)], px)));
  const hair = await hairStats(img, px, { eyeY: Math.min(eyes[0].y, eyes[1].y), chin, length, cheekL: Math.min(ck[0].x, ck[1].x), cheekR: Math.max(ck[0].x, ck[1].x) });
  if (beard) notes.push('Beard');
  if (hair) notes.push(`${hair.color} hair`);

  return {
    face_shape: shape, confidence: Math.round(confidence * 100) / 100, quality, notes,
    ratios: { length_to_cheek: +L.toFixed(3), jaw_to_cheek: +J.toFixed(3), forehead_to_jaw: +F.toFixed(3) },
    lines: [
      { id: 'length', a: up, b: chin },
      { id: 'forehead', a: fh[0], b: fh[1] },
      { id: 'cheek', a: ck[0], b: ck[1] },
      { id: 'jaw', a: jw[0], b: jw[1] },
    ],
    width: W, height: H,
    hair, beard, skin,
  };
}

type Px = { data: Uint8ClampedArray; w: number; h: number };
function pixels(img: HTMLImageElement): Px {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}
/** Per-channel median, so a stray shadow, lens or strand of hair does not skew the colour. */
function median(cs: [number, number, number][]): [number, number, number] {
  const m = (k: number) => { const v = cs.map(c => c[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]); };
  return [m(0), m(1), m(2)];
}
/** Mean colour in a 7x7 patch around each point. */
function avg(pts: Point[], px: Px): [number, number, number] {
  const s = [0, 0, 0]; let n = 0;
  for (const q of pts) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = Math.round(q.x) + dx, y = Math.round(q.y) + dy;
    if (x < 0 || y < 0 || x >= px.w || y >= px.h) continue;
    const i = (y * px.w + x) * 4; s[0] += px.data[i]; s[1] += px.data[i + 1]; s[2] += px.data[i + 2]; n++;
  }
  return n ? [s[0] / n, s[1] / n, s[2] / n] : [0, 0, 0];
}
async function hairStats(img: HTMLImageElement, px: Px, f: { eyeY: number; chin: Point; length: number; cheekL: number; cheekR: number }): Promise<FaceMeasure['hair']> {
  let seg: any;
  try { seg = await loadHair(); } catch { return null; }
  let mask: Uint8Array | null = null, mw = 0, mh = 0;
  seg.segment(img, (r: any) => {
    const m = r.categoryMask;
    if (m) { mask = m.getAsUint8Array().slice(); mw = m.width; mh = m.height; }
    r.close?.();
  });
  if (!mask) return null;
  const mk: Uint8Array = mask;
  const sx = px.w / mw, sy = px.h / mh;
  // colour: hair pixels above the eyes (so a beard does not count)
  const s = [0, 0, 0]; let n = 0, lowest = 0;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (!mk[y * mw + x]) continue;
    const X = x * sx, Y = y * sy;
    if (Y < f.eyeY) {
      const i = (Math.round(Y) * px.w + Math.round(X)) * 4;
      s[0] += px.data[i]; s[1] += px.data[i + 1]; s[2] += px.data[i + 2]; n++;
    }
    // length: how far hair falls beside the face (outside the cheeks, so a beard does not count)
    const margin = (f.cheekR - f.cheekL) * 0.08;
    if ((X < f.cheekL - margin || X > f.cheekR + margin) && Y > lowest) lowest = Y;
  }
  if (n < 50) return null;
  const rgb: [number, number, number] = [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
  const below = (lowest - f.chin.y) / f.length;
  const length = below > 0.35 ? 'long' : below > -0.15 ? 'medium' : 'short';
  return { rgb, color: colorName(rgb), length };
}

export function colorName([r, g, b]: [number, number, number]): string {
  const l = 0.299 * r + 0.587 * g + 0.114 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
  if (l < 42) return 'Black';
  if (sat < 0.12 && l > 120) return 'Grey';
  if (r > g * 1.35 && r > 110) return 'Auburn';
  if (l < 75) return 'Dark brown';
  if (l < 120) return 'Brown';
  if (l < 165) return 'Light brown';
  return 'Blonde';
}

/** Rule of thumb stylists use, written as thresholds. `margin` = distance from the nearest boundary. */
export function classify(L: number, J: number, F: number, FC: number): { shape: FaceShape; margin: number } {
  if (L >= 1.5) return { shape: 'oblong', margin: L - 1.5 };
  if (FC <= 0.84 && J <= 0.78) return { shape: 'diamond', margin: Math.min(0.84 - FC, 0.78 - J) };
  if (F >= 1.22 && J <= 0.8) return { shape: 'heart', margin: Math.min(F - 1.22, 0.8 - J) };
  if (L < 1.28) return J >= 0.86 ? { shape: 'square', margin: J - 0.86 } : { shape: 'round', margin: Math.min(1.28 - L, 0.86 - J) };
  if (J >= 0.9) return { shape: 'square', margin: J - 0.9 };
  return { shape: 'oval', margin: Math.min(L - 1.28, 1.5 - L, 0.9 - J) };
}
