import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// tsconfig sets jsx: "preserve" for Next, which Vite cannot parse. Page tests
// need JSX compiled and the "@/" alias; existing tests are unaffected.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
