/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server-side OCR (lib/agent/vision.ts). Loaded with Node's require at
  // runtime instead of being bundled: tesseract.js spawns a worker thread
  // and loads its WASM core from its own files.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core"],
  // The worker entry, WASM core and traineddata are found at runtime, so
  // file tracing cannot see them. Bundle them into the turn route.
  // tesseract.js 7.0.0 passes a boolean to getCore(), so it loads the
  // non-LSTM cores even with OEM.LSTM_ONLY; the LSTM cores are included too
  // in case that is fixed. The worker picks relaxed-SIMD, SIMD or plain at
  // runtime, so all three variants are needed.
  outputFileTracingIncludes: {
    "/api/agent/turn": [
      "./lib/agent/ocr-worker.mjs",
      "./node_modules/tesseract.js/src/**/*.js",
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js-core/package.json",
      "./node_modules/tesseract.js-core/index.js",
      "./node_modules/tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}{,-lstm}.{js,wasm}",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
      "./node_modules/{bmp-js,is-url,node-fetch,regenerator-runtime,wasm-feature-detect,zlibjs,whatwg-url,tr46,webidl-conversions}/**/*",
    ],
  },
};

export default nextConfig;
