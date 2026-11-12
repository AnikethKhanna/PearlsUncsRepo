import { defineConfig } from "vitest/config";
import { sharedAliases } from "./scripts/vite-node.config";

// Runs against the Firebase Auth + Firestore emulators. Start them with:
//   npm run test:emulators      (starts the emulators, runs these tests, stops them)
export default defineConfig({
  resolve: { alias: sharedAliases },
  test: {
    include: ["tests/**/*.emulator.test.ts"],
    environment: "node",
    // The Admin SDK needs no Google credentials for the emulators; skip the slow cloud metadata probe.
    env: { METADATA_SERVER_DETECTION: "none" },
    // Tests share one emulator project and clear it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
