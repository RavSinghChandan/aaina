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
}

// MediaPipe face-mesh landmark indices
const TOP = 10, CHIN = 152;
const FOREHEAD: [number, number] = [54, 284];
const CHEEK: [number, number] = [234, 454];
const JAW: [number, number] = [172, 397];
const EYES: [number, number] = [33, 263];

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

/** Start downloading the model early so measuring feels instant. */
export function warmUp() { load().catch(() => {}); }

export async function measureFace(dataUrl: string): Promise<FaceMeasure | { error: string }> {
  let lm: any;
  try { lm = await load(); } catch { return { error: 'Face measuring could not start on this device.' }; }
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const res = lm.detect(img);
  const faces: { x: number; y: number }[][] = res.faceLandmarks ?? [];
  if (!faces.length) return { error: 'We could not find a face. Face the camera in good light and try again.' };
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
  };
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
