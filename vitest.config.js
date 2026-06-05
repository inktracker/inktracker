import { defineConfig, defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.js"],
    // supplierCache.test.ts is a Deno test (uses `Deno.test` and
    // `https://deno.land/...` imports). The Node ESM loader can't
    // resolve `https:` URLs, so vitest fails the file at load time
    // and the run exits non-zero. Run that file with `deno test`
    // instead. Keep the rest of vitest's defaults intact.
    exclude: [
      ...defaultExclude,
      "supabase/functions/_shared/__tests__/supplierCache.test.ts",
    ],
  },
});
