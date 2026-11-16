import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/node-api-worker/test/**/*.test.ts",
      "apps/web-hub/test/**/*.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});
