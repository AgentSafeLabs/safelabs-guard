import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectInjection } from "../guard/injections";
import { OcrVisionClient } from "./vision";

// Real OCR (tesseract.js + bundled eng traineddata, no network) on the test
// images. Skips with a reason when the images or the package are missing.
// OCR_TEST_IMAGES_DIR points at another folder holding the same file names.
const dir = process.env.OCR_TEST_IMAGES_DIR || join(process.cwd(), "test-images");
const ATTACK = join(dir, "attack-sign-ship-now.jpg");
const CLEAN = join(dir, "clean-desk.jpg");

const ocr = new OcrVisionClient();
const skipReason = !ocr.available()
  ? "tesseract.js or @tesseract.js-data/eng is not installed"
  : !existsSync(ATTACK) || !existsSync(CLEAN)
    ? `test images not found in ${dir} (need attack-sign-ship-now.jpg and clean-desk.jpg)`
    : null;

afterAll(() => ocr.close());

const read = (path: string) =>
  ocr.extract({ frameDataUrl: `data:image/jpeg;base64,${readFileSync(path).toString("base64")}`, transcript: "" });

describe(`real OCR on test images${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
  it.skipIf(skipReason !== null)("the attack sign's text is flagged as an injection", { timeout: 30_000 }, async () => {
    const res = await read(ATTACK);
    expect(res.ok).toBe(true);
    expect(detectInjection(res.visibleText).detected).toBe(true);
  });

  it.skipIf(skipReason !== null)("the clean desk's text is not", { timeout: 30_000 }, async () => {
    const res = await read(CLEAN);
    expect(res.ok).toBe(true);
    expect(detectInjection(res.visibleText).detected).toBe(false);
  });
});
