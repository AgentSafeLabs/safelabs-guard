// Worker-thread entry for tesseract.js (workerPath in lib/agent/vision.ts).
//
// tesseract.js sets `worker.onerror` on a Node worker_threads Worker, which
// Node ignores, so an uncaught error in this thread (a WASM abort, a missing
// core file) would surface as an unhandled 'error' event and crash the whole
// server process. Exit the thread instead: the pending OCR call then times out
// in OcrVisionClient and the turn fails closed.
process.on("uncaughtException", () => process.exit(1));
process.on("unhandledRejection", () => process.exit(1));

await import("tesseract.js/src/worker-script/node/index.js");
