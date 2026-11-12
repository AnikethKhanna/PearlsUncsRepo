/**
 * Lets TypeScript scripts (and emulator tests) reuse the app's server modules:
 * resolves the "@/…" path alias and stubs the "server-only" marker, which
 * otherwise throws outside Next.js server components.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const sharedAliases = {
  "@": fileURLToPath(new URL("../src", import.meta.url)),
  "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)),
};

export default defineConfig({ resolve: { alias: sharedAliases } });
