import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkOcrImage,
  cleanOcrText,
  OCR_MAX_IMAGE_BYTES,
  OCR_MAX_TEXT,
  OcrVisionClient,
  ocrLangPath,
  selectVision,
  tesseractWorkerOptions,
  type OcrWorker,
} from "./vision";

// OcrVisionClient against a fake tesseract worker. No network, no real OCR.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const dataUrl = (bytes: number[], type = "image/png") => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const ascii = (text: string) => Array.from(Buffer.from(text, "ascii"));
const PNG = dataUrl([...PNG_HEAD, 0, 0, 0, 0]);
const frame = (frameDataUrl = PNG) => ({ frameDataUrl, transcript: "" });

type Recognize = OcrWorker["recognize"];

function fakeWorker(recognize: Recognize) {
  const worker = { recognize: vi.fn(recognize), terminate: vi.fn(async () => undefined) };
  return worker;
}

function clientWith(recognize: Recognize, timeoutMs = 1_000) {
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const createWorker = vi.fn(async () => {
    const w = fakeWorker(recognize);
    workers.push(w);
    return w;
  });
  return { ocr: new OcrVisionClient({ createWorker, timeoutMs }), createWorker, workers };
}

const result = (text: unknown, confidence: unknown = 90) => async () => ({ data: { text, confidence } });
const never: Recognize = () => new Promise(() => {});

describe("checkOcrImage", () => {
  it("accepts PNG, JPEG and WebP by magic bytes", () => {
    expect(checkOcrImage(PNG).ok).toBe(true);
    expect(checkOcrImage(dataUrl([0xff, 0xd8, 0xff, 0xe0], "image/jpeg")).ok).toBe(true);
    expect(checkOcrImage(dataUrl([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")], "image/webp")).ok).toBe(true);
  });

  it("rejects other bytes whatever the declared type", () => {
    expect(checkOcrImage(dataUrl(ascii("GIF89a"), "image/png"))).toEqual({ ok: false, detail: "ocr rejected image" });
    expect(checkOcrImage("data:image/png;base64,")).toEqual({ ok: false, detail: "ocr rejected image" });
    expect(checkOcrImage("https://example.com/a.png")).toEqual({ ok: false, detail: "ocr rejected image" });
  });

  it("rejects images over 8 MB before decoding", () => {
    const big = `data:image/png;base64,${Buffer.from(PNG_HEAD).toString("base64")}${"A".repeat(Math.ceil((OCR_MAX_IMAGE_BYTES * 4) / 3) + 16)}`;
    expect(checkOcrImage(big)).toEqual({ ok: false, detail: "ocr image too large" });
  });
});

describe("cleanOcrText", () => {
  it("turns whitespace controls into spaces and drops other control and format characters", () => {
    expect(cleanOcrText("SHIP\nIT\tNOW\r\n")).toBe("SHIP IT NOW");
    expect(cleanOcrText("ig\u200bnore\u202e che\u0000cks\u001b[31m")).toBe("ignore checks[31m");
    expect(cleanOcrText("ship\udb40\udc41 it\ufeff")).toBe("ship it");
  });

  it(`caps text at ${OCR_MAX_TEXT} characters`, () => {
    expect(cleanOcrText("a".repeat(5_000))).toHaveLength(OCR_MAX_TEXT);
  });
});

describe("OcrVisionClient", () => {
  it("creates the worker lazily and reuses it", async () => {
    const { ocr, createWorker } = clientWith(result("hello"));
    expect(createWorker).not.toHaveBeenCalled();
    await ocr.extract(frame());
    await ocr.extract(frame());
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("returns cleaned text and mean confidence, and keeps low-confidence words", async () => {
    const { ocr } = clientWith(result("  MANAGER\nOVERRIDE  ship it ", 12.345));
    expect(await ocr.extract(frame())).toEqual({ visibleText: "MANAGER OVERRIDE ship it", ok: true, confidence: 12.3 });
  });

  it("passes the decoded image bytes to the worker", async () => {
    const { ocr, workers } = clientWith(result(""));
    await ocr.extract(frame());
    expect(Buffer.from(workers[0].recognize.mock.calls[0][0]).subarray(0, 8)).toEqual(Buffer.from(PNG_HEAD));
  });

  it("rejects a bad image without starting a worker", async () => {
    const { ocr, createWorker } = clientWith(result("x"));
    expect(await ocr.extract(frame(dataUrl([1, 2, 3, 4])))).toMatchObject({ ok: false, perceptionDetail: "ocr rejected image" });
    expect(await ocr.extract({ transcript: "" })).toMatchObject({ ok: false, perceptionDetail: "no frame to read" });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("fails closed with 'ocr timeout', terminates the stuck worker and starts a new one next time", async () => {
    const { ocr, createWorker, workers } = clientWith(never, 30);
    expect(await ocr.extract(frame())).toEqual({ visibleText: "", ok: false, error: "ocr timeout", perceptionDetail: "ocr timeout" });
    await vi.waitFor(() => expect(workers[0].terminate).toHaveBeenCalled());
    await ocr.extract(frame());
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("fails closed with 'ocr error' and never surfaces upstream error text", async () => {
    const { ocr, workers } = clientWith(async () => {
      throw new Error("upstream detail Bearer sk-not-real /var/task/secret");
    });
    const res = await ocr.extract(frame());
    expect(res).toEqual({ visibleText: "", ok: false, error: "ocr error", perceptionDetail: "ocr error" });
    expect(JSON.stringify(res)).not.toMatch(/upstream|sk-|secret/);
    await vi.waitFor(() => expect(workers[0].terminate).toHaveBeenCalled());
  });

  it("fails closed when the worker cannot be created or is empty", async () => {
    const throwing = new OcrVisionClient({ createWorker: async () => Promise.reject(new Error("wasm load failed")) });
    expect(await throwing.extract(frame())).toMatchObject({ ok: false, perceptionDetail: "ocr error" });
    const empty = new OcrVisionClient({ createWorker: async () => null });
    expect(await empty.extract(frame())).toMatchObject({ ok: false, perceptionDetail: "ocr error" });
  });

  it("fails closed when the worker returns no text", async () => {
    const { ocr } = clientWith(result(undefined));
    expect(await ocr.extract(frame())).toMatchObject({ ok: false, perceptionDetail: "ocr error" });
  });

  it("runs one recognition at a time, in call order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const { ocr, createWorker } = clientWith(async (image) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      order.push(String(Buffer.from(image).at(-1)));
      inFlight -= 1;
      return { data: { text: "ok", confidence: 80 } };
    });
    const results = await Promise.all([1, 2, 3].map((n) => ocr.extract(frame(dataUrl([...PNG_HEAD, n])))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["1", "2", "3"]);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("counts queue wait against the timeout", async () => {
    const { ocr } = clientWith(never, 40);
    const [first, second] = await Promise.all([ocr.extract(frame()), ocr.extract(frame())]);
    expect(first.perceptionDetail).toBe("ocr timeout");
    expect(second.perceptionDetail).toBe("ocr timeout");
  });

  it("close() terminates the worker", async () => {
    const { ocr, workers } = clientWith(result("x"));
    await ocr.extract(frame());
    await ocr.close();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });
});

describe("tesseract worker config", () => {
  it("reads bundled traineddata from a local directory, never a URL", () => {
    const options = tesseractWorkerOptions();
    expect(options.langPath).toBe(ocrLangPath());
    expect(options.langPath).toMatch(/node_modules[\\/]@tesseract\.js-data[\\/]eng[\\/]4\.0\.0_best_int$/);
    expect(options.langPath).not.toMatch(/^[a-z]+:\/\//i);
    expect(options).toMatchObject({ gzip: true, cacheMethod: "none" });
    expect(typeof options.errorHandler).toBe("function");
  });

  it("runs the worker thread through the crash-guard entry", () => {
    const { workerPath } = tesseractWorkerOptions();
    expect(workerPath).toMatch(/lib[\\/]agent[\\/]ocr-worker\.mjs$/);
    expect(existsSync(workerPath)).toBe(true);
  });
});

describe("selectVision", () => {
  it("defaults to OCR in live mode and to mock otherwise", () => {
    expect(selectVision({ SAFELABS_USE_MOCKS: "false" }).name).toBe("ocr");
    expect(selectVision({ SAFELABS_USE_MOCKS: "false", SAFELABS_VISION: " " }).name).toBe("ocr");
    expect(selectVision({}).name).toBe("mock");
    expect(selectVision({ SAFELABS_USE_MOCKS: "true" }).name).toBe("mock");
  });

  it("lets SAFELABS_VISION override the live default", () => {
    expect(selectVision({ SAFELABS_USE_MOCKS: "false", SAFELABS_VISION: "mock" }).name).toBe("mock");
    expect(selectVision({ SAFELABS_USE_MOCKS: "false", SAFELABS_VISION: "SPARK" }).name).toBe("spark");
    expect(selectVision({ SAFELABS_VISION: "ocr" }).name).toBe("ocr");
  });

  it("shares one OCR client, and so one worker, per server instance", () => {
    expect(selectVision({ SAFELABS_VISION: "ocr" })).toBe(selectVision({ SAFELABS_USE_MOCKS: "false" }));
  });
});
