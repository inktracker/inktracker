import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import path from "path";

// Use Vercel's commit SHA when present (CI builds) so Sentry releases
// match what's actually deployed. Fall back to "dev" for local builds.
const RELEASE = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

export default defineConfig({
  plugins: [
    react(),
    // Source map upload to Sentry. Silent no-op when SENTRY_AUTH_TOKEN
    // isn't set — local dev builds skip the upload entirely. CI builds
    // (Vercel) have the token and upload during the build step.
    //
    // Maps are deleted from the dist/ output after upload so they aren't
    // served publicly — Sentry hosts them and only its servers need them
    // to symbolicate stack traces.
    sentryVitePlugin({
      org: "biota-mfg",
      project: "inktracker-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: RELEASE },
      sourcemaps: {
        assets: "./dist/**",
        filesToDeleteAfterUpload: "./dist/**/*.map",
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Make the release SHA available to runtime code so Sentry.init can
  // tag events with the same release the source maps were uploaded under.
  define: {
    "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(RELEASE),
  },
  build: {
    // Only emit source maps when we have the Sentry token to upload + delete
    // them (filesToDeleteAfterUpload above). Without the token the plugin is
    // disabled and would NOT strip the .map files, so emitting them would ship
    // readable source to the public bundle (DEP-04). Gate emission on the token
    // so a no-token build (local, or CI missing the secret) ships no maps.
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? true : false,
    rollupOptions: {
      output: {
        // Split the stable, already-eager vendor libs into their own chunks so
        // an app-code-only deploy doesn't invalidate them in returning users'
        // browser cache. Only names libs that are already in the eager entry —
        // lazy-only libs (recharts, pdf-lib, jspdf) keep their natural async
        // chunks and must NOT be listed here or they'd become eager.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (id.includes("@supabase")) return "supabase-vendor";
          if (id.includes("@sentry")) return "sentry-vendor";
        },
      },
    },
  },
});
