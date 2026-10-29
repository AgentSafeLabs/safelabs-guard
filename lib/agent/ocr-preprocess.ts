// Extra reading passes for OcrVisionClient. The production pass uses
// tesseract.js's default page mode (6, "single uniform block") on the raw
// colour frame. That reads nothing from some frames (a dark sign on a
// wood-grain scene, a small sticker), garbage from others, and invents junk
// ("AT ym-") on frames with no text. The same frames read fine once they are
// greyscale and contrast-stretched, or cropped to the sign. Word recall over
// the 10 dev frames that carry text (scripts/diagnose-ocr.ts --with-other;
// h-* held-out files are never read):
//
//   production pass alone                                     51%
//   + greyscale/normalise, auto layout (psm 3)                80% on its own
//   + greyscale/normalise, sparse text (psm 11)               68% on its own
//   + crop to bright rectangles, greyscale/normalise          90% on its own
//   production + all three (what OcrVisionClient runs)        98%, ~0.5 s extra
//
// Passes only ever ADD text. The caller always runs the unmodified frame first
// and keeps its text, so nothing it read before can be lost. Never throws:
// when sharp is missing or the image cannot be decoded there are no extra
// passes and the client behaves exactly as it did.

export interface OcrPass {
  name: string;
  /** tesseract page segmentation mode: 3 = automatic layout, 11 = sparse text. */
  psm: 3 | 11;
  image: Buffer;
}

export type ExtraPasses = (bytes: Buffer) => Promise<OcrPass[]>;

/** Set SAFELABS_OCR_PASSES=off to read only the unmodified frame (the old behaviour). */
export function extraPassesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.SAFELABS_OCR_PASSES ?? "").trim().toLowerCase() !== "off";
}

/** Pixels brighter than this (0-255, on a 240 px wide copy) count as "sign". */
const LIGHT = 190;
/** A bright region must cover at least this share of the frame. */
const MIN_AREA = 0.008;
const MAX_REGIONS = 3;
const GRID_WIDTH = 240;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

/** 4-connected bright components of a grey raw buffer, largest first. */
export function brightBoxes(grey: Uint8Array, gw: number, gh: number): Box[] {
  const seen = new Uint8Array(gw * gh);
  const boxes: Box[] = [];
  for (let start = 0; start < gw * gh; start++) {
    if (seen[start] || grey[start] < LIGHT) continue;
    const stack = [start];
    seen[start] = 1;
    const box: Box = { x0: gw, y0: gh, x1: 0, y1: 0, area: 0 };
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % gw;
      const y = (p - x) / gw;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      box.area++;
      for (const q of [p - 1, p + 1, p - gw, p + gw]) {
        if (q < 0 || q >= gw * gh || seen[q] || grey[q] < LIGHT || Math.abs((q % gw) - x) > 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (box.area >= MIN_AREA * gw * gh) boxes.push(box);
  }
  return boxes.sort((a, b) => b.area - a.area).slice(0, MAX_REGIONS);
}

export const extraPasses: ExtraPasses = async (bytes) => {
  try {
    const { default: sharp } = await import("sharp");
    const base = () => sharp(bytes, { failOn: "none" }).removeAlpha().greyscale().normalise();
    const { width = 0, height = 0 } = await sharp(bytes, { failOn: "none" }).metadata();
    if (width < 16 || height < 16) return [];

    const passes: OcrPass[] = [
      { name: "grey+normalise", psm: 3, image: await base().png().toBuffer() },
      { name: "grey+normalise sparse", psm: 11, image: await base().png().toBuffer() },
    ];

    const gh = Math.max(1, Math.round((height / width) * GRID_WIDTH));
    const grey = await sharp(bytes, { failOn: "none" }).removeAlpha().greyscale().resize(GRID_WIDTH, gh).raw().toBuffer();
    const k = width / GRID_WIDTH;
    for (const b of brightBoxes(grey, GRID_WIDTH, gh)) {
      const padX = Math.round((b.x1 - b.x0 + 1) * k * 0.1);
      const padY = Math.round((b.y1 - b.y0 + 1) * k * 0.1);
      const left = Math.max(0, Math.round(b.x0 * k) - padX);
      const top = Math.max(0, Math.round(b.y0 * k) - padY);
      const region = {
        left,
        top,
        width: Math.min(width - left, Math.round((b.x1 - b.x0 + 1) * k) + 2 * padX),
        height: Math.min(height - top, Math.round((b.y1 - b.y0 + 1) * k) + 2 * padY),
      };
      if (region.width < 8 || region.height < 8) continue;
      passes.push({ name: "bright region", psm: 3, image: await base().extract(region).png().toBuffer() });
    }
    return passes;
  } catch {
    return [];
  }
};
