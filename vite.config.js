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
    // Source maps are required for the plugin to upload anything. With
    // filesToDeleteAfterUpload above, they don't end up in the public
    // bundle — only Sentry sees them.
    sourcemap: true,
  },
});
