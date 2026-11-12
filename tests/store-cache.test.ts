import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataStore } from "@/lib/data/store";
import { loadWorkflowSettings } from "@/lib/data/workflow-settings";
import { DEFAULT_WORKFLOW } from "@/lib/domain/workflow";

vi.mock("server-only", () => ({}));

const cache = globalThis as unknown as { __nmuStore?: DataStore };
const previous = cache.__nmuStore;

afterEach(() => {
  cache.__nmuStore = previous;
  vi.unstubAllEnvs();
  vi.resetModules();
});

function configure(backend: string) {
  vi.stubEnv("DATA_BACKEND", backend);
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("AIRTABLE_TOKEN", "test-token");
  vi.stubEnv("AIRTABLE_BASE_ID", "test-base");
}

describe("data store hot-reload cache", () => {
  it.each(["memory", "airtable"])("replaces a pre-workflow %s store", async (backend) => {
    configure(backend);
    const legacy = { kind: backend } as DataStore;
    cache.__nmuStore = legacy;
    const { getStore } = await import("@/lib/data");
    const store = getStore();
    expect(store).not.toBe(legacy);
    expect(store.kind).toBe(backend);
    expect(typeof store.getWorkflowConfig).toBe("function");
    expect(typeof store.saveWorkflowConfig).toBe("function");
    if (backend === "memory") {
      await expect(loadWorkflowSettings(store)).resolves.toMatchObject({ config: DEFAULT_WORKFLOW, writable: true });
    }
    expect(getStore()).toBe(store);
  });

  it("preserves compatible stores and saved settings across module reloads", async () => {
    configure("memory");
    delete cache.__nmuStore;
    const store = (await import("@/lib/data")).getStore();
    await store.saveWorkflowConfig(DEFAULT_WORKFLOW);
    vi.resetModules();
    const reloaded = (await import("@/lib/data")).getStore();
    expect(reloaded).toBe(store);
    await expect(reloaded.getWorkflowConfig()).resolves.toEqual(DEFAULT_WORKFLOW);
  });

  it("does not reuse the previous backend after configuration changes", async () => {
    configure("memory");
    delete cache.__nmuStore;
    const { getStore } = await import("@/lib/data");
    const memory = getStore();
    configure("airtable");
    expect(getStore()).not.toBe(memory);
    expect(getStore().kind).toBe("airtable");
  });
});
