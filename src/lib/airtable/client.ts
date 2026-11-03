/**
 * Minimal Airtable REST client (no SDK dependency).
 *
 * - Only ever runs on the server: the token is passed in by the caller,
 *   which reads it from environment variables.
 * - Spaces requests to stay under Airtable's 5 requests/second/base limit
 *   and retries on HTTP 429 / 5xx.
 * - Never logs the token or record contents.
 *
 * API reference: https://airtable.com/developers/web/api/introduction
 */

export type AirtableFields = Record<string, unknown>;

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: AirtableFields;
}

export class AirtableError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly type?: string,
  ) {
    super(message);
    this.name = "AirtableError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AirtableClientOptions {
  token: string;
  baseId: string;
  fetch?: FetchLike;
  /** Minimum ms between requests. Default 220 (~4.5 req/s). */
  minIntervalMs?: number;
  /** Retry delays for 429/5xx. Default [1000, 2000, 4000]. */
  retryDelaysMs?: number[];
  apiUrl?: string;
}

const MAX_BATCH = 10; // Airtable allows at most 10 records per create/update request

export class AirtableClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly retryDelaysMs: number[];
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(opts: AirtableClientOptions) {
    this.token = opts.token;
    this.baseUrl = `${opts.apiUrl ?? "https://api.airtable.com"}/v0/${encodeURIComponent(opts.baseId)}`;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.minIntervalMs = opts.minIntervalMs ?? 220;
    this.retryDelaysMs = opts.retryDelaysMs ?? [1000, 2000, 4000];
  }

  /** Fetch all records matching the options (follows pagination). */
  async list(
    table: string,
    opts: { filterByFormula?: string; sort?: { field: string; direction?: "asc" | "desc" }[]; maxRecords?: number } = {},
  ): Promise<AirtableRecord[]> {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      const params = new URLSearchParams();
      if (opts.filterByFormula) params.set("filterByFormula", opts.filterByFormula);
      if (opts.maxRecords) params.set("maxRecords", String(opts.maxRecords));
      opts.sort?.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction ?? "asc");
      });
      if (offset) params.set("offset", offset);
      const qs = params.toString();
      const page = await this.request<{ records: AirtableRecord[]; offset?: string }>(
        "GET",
        `/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`,
      );
      records.push(...page.records);
      offset = page.offset;
    } while (offset);
    return records;
  }

  /** Fetch specific records by ID (in chunks, to keep URLs short). Missing IDs are skipped. */
  async findMany(table: string, ids: string[]): Promise<AirtableRecord[]> {
    const unique = [...new Set(ids)].filter((id) => /^rec[A-Za-z0-9]+$/.test(id));
    const results: AirtableRecord[] = [];
    for (const chunk of chunks(unique, 40)) {
      const formula = `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(",")})`;
      results.push(...(await this.list(table, { filterByFormula: formula })));
    }
    return results;
  }

  async get(table: string, id: string): Promise<AirtableRecord | null> {
    try {
      return await this.request<AirtableRecord>("GET", `/${encodeURIComponent(table)}/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof AirtableError && err.status === 404) return null;
      throw err;
    }
  }

  /** Create records, 10 per request. Returns created records in input order. */
  async create(table: string, fieldsList: AirtableFields[]): Promise<AirtableRecord[]> {
    const created: AirtableRecord[] = [];
    for (const chunk of chunks(fieldsList, MAX_BATCH)) {
      const res = await this.request<{ records: AirtableRecord[] }>("POST", `/${encodeURIComponent(table)}`, {
        records: chunk.map((fields) => ({ fields })),
        typecast: true,
      });
      created.push(...res.records);
    }
    return created;
  }

  /** Partially update records (PATCH), 10 per request. */
  async update(table: string, updates: { id: string; fields: AirtableFields }[]): Promise<AirtableRecord[]> {
    const updated: AirtableRecord[] = [];
    for (const chunk of chunks(updates, MAX_BATCH)) {
      const res = await this.request<{ records: AirtableRecord[] }>("PATCH", `/${encodeURIComponent(table)}`, {
        records: chunk,
        typecast: true,
      });
      updated.push(...res.records);
    }
    return updated;
  }

  private async throttle(): Promise<void> {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise((r) => (release = r));
    await prev;
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
    release();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.retryDelaysMs.length) {
        await sleep(this.retryDelaysMs[attempt]);
        continue;
      }
      let type: string | undefined;
      let message = `Airtable request failed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: { type?: string; message?: string } | string };
        if (typeof data.error === "string") type = data.error;
        else if (data.error) {
          type = data.error.type;
          if (data.error.message) message = `${message}: ${data.error.message}`;
        }
      } catch {
        /* body was not JSON */
      }
      throw new AirtableError(message, res.status, type);
    }
  }
}

/** Escape a string for use inside a double-quoted Airtable formula literal. */
export function formulaString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
