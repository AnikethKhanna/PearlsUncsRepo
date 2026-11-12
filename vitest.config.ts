import { defineConfig } from "vitest/config";
import { sharedAliases } from "./scripts/vite-node.config";

// Unit tests: no network, no emulators. Emulator tests (*.emulator.test.ts)
// run separately with `npm run test:emulators` (see vitest.emulator.config.ts).
export default defineConfig({
  resolve: { alias: sharedAliases },
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.emulator.test.ts"], environment: "node" },
});
