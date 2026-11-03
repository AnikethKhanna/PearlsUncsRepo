import "server-only";
import { AirtableClient } from "@/lib/airtable/client";
import { getAirtableConfig, getDataBackend } from "@/lib/config";
import { AirtableStore } from "./airtable-store";
import { MemoryStore } from "./memory-store";
import type { DataStore } from "./store";

export type { DataStore } from "./store";

// Kept on globalThis so the dev server's hot reload doesn't reset the
// in-memory placeholder or the Airtable rate limiter.
const g = globalThis as unknown as { __nmuStore?: DataStore };

/** The app's data store. Server-only: Airtable credentials never reach the browser. */
export function getStore(): DataStore {
  if (g.__nmuStore) return g.__nmuStore;
  const backend = getDataBackend();
  g.__nmuStore =
    backend === "memory" ? new MemoryStore() : new AirtableStore(new AirtableClient(getAirtableConfig()));
  return g.__nmuStore;
}
