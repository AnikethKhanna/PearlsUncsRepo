import "server-only";
import { AirtableClient } from "@/lib/airtable/client";
import { getAirtableConfig, getDataBackend } from "@/lib/config";
import { getFirebaseAdmin } from "@/lib/firebase/server";
import { AirtableStore } from "./airtable-store";
import { FirestoreStore } from "./firestore-store";
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
  // Exactly one backend is active, so the app never writes to two databases.
  g.__nmuStore =
    backend === "memory"
      ? new MemoryStore()
      : backend === "firestore"
        ? new FirestoreStore(getFirebaseAdmin().db)
        : new AirtableStore(new AirtableClient(getAirtableConfig()));
  return g.__nmuStore;
}
