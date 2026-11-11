/**
 * A tiny in-process imitation of the Airtable REST API, for tests only.
 * It supports exactly the requests AirtableClient makes, enforces Airtable's
 * 10-records-per-write limit, and maintains inverse link fields the way
 * Airtable does, so the AirtableStore can be exercised end to end.
 */
import type { AirtableRecord } from "@/lib/airtable/client";

export interface InverseLink {
  table: string;
  field: string;
  otherTable: string;
  otherField: string;
}

export class FakeAirtable {
  tables = new Map<string, Map<string, AirtableRecord>>();
  requests: { method: string; table: string; count?: number }[] = [];
  private seq = 1;

  constructor(private readonly inverseLinks: InverseLink[] = []) {}

  seed(table: string, fields: Record<string, unknown>, id?: string): string {
    const rec = { id: id ?? this.newId(), fields: structuredClone(fields) };
    this.table(table).set(rec.id, rec);
    this.syncInverse(table, rec, {});
    return rec.id;
  }

  get(table: string, id: string) {
    return this.table(table).get(id);
  }

  all(table: string) {
    return [...this.table(table).values()];
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const [, , , rawTable, id] = u.pathname.split("/"); // /v0/{base}/{table}/{id?}
    const table = decodeURIComponent(rawTable);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (!(init?.headers as Record<string, string>)?.Authorization?.startsWith("Bearer "))
      return json({ error: { type: "AUTHENTICATION_REQUIRED" } }, 401);

    if (method === "GET" && id) {
      this.requests.push({ method, table });
      const rec = this.table(table).get(id);
      return rec ? json(rec) : json({ error: "NOT_FOUND" }, 404);
    }
    if (method === "GET") {
      this.requests.push({ method, table });
      let records = this.all(table);
      const formula = u.searchParams.get("filterByFormula");
      if (formula) records = records.filter((r) => evalFormula(formula, r));
      const max = Number(u.searchParams.get("maxRecords") ?? 0);
      if (max) records = records.slice(0, max);
      return json({ records });
    }
    if (method === "POST" || method === "PATCH") {
      const items = body.records as { id?: string; fields: Record<string, unknown> }[];
      this.requests.push({ method, table, count: items.length });
      if (items.length > 10) return json({ error: { type: "INVALID_REQUEST", message: "Too many records" } }, 422);
      const out = items.map((item) => {
        if (method === "POST") {
          const rec = { id: this.newId(), fields: clean(item.fields) };
          this.table(table).set(rec.id, rec);
          this.syncInverse(table, rec, {});
          return rec;
        }
        const rec = this.table(table).get(item.id!);
        if (!rec) throw new Error(`PATCH of unknown record ${item.id}`);
        const before = structuredClone(rec.fields);
        rec.fields = clean({ ...rec.fields, ...item.fields });
        this.syncInverse(table, rec, before);
        return rec;
      });
      return json({ records: structuredClone(out) });
    }
    if (method === "DELETE") {
      const ids = u.searchParams.getAll("records[]");
      this.requests.push({ method, table, count: ids.length });
      if (ids.length > 10) return json({ error: { type: "INVALID_REQUEST", message: "Too many records" } }, 422);
      for (const rid of ids) {
        if (!this.table(table).has(rid)) return json({ error: "NOT_FOUND" }, 404);
        this.table(table).delete(rid);
        // Like Airtable: links pointing at a deleted record disappear everywhere.
        for (const t of this.tables.values())
          for (const rec of t.values())
            for (const [k, v] of Object.entries(rec.fields))
              if (Array.isArray(v) && v.includes(rid)) rec.fields[k] = v.filter((x) => x !== rid);
      }
      return json({ records: ids.map((rid) => ({ id: rid, deleted: true })) });
    }
    return json({ error: "NOT_SUPPORTED" }, 400);
  };

  private table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }
  private newId() {
    return `rec${String(this.seq++).padStart(14, "0")}`;
  }
  private syncInverse(table: string, rec: AirtableRecord, before: Record<string, unknown>) {
    for (const link of this.inverseLinks) {
      if (link.table !== table) continue;
      const prev = new Set((before[link.field] as string[]) ?? []);
      const next = new Set((rec.fields[link.field] as string[]) ?? []);
      for (const otherId of next) if (!prev.has(otherId)) {
        const other = this.table(link.otherTable).get(otherId);
        if (other) other.fields[link.otherField] = [...((other.fields[link.otherField] as string[]) ?? []), rec.id];
      }
      for (const otherId of prev) if (!next.has(otherId)) {
        const other = this.table(link.otherTable).get(otherId);
        if (other) other.fields[link.otherField] = ((other.fields[link.otherField] as string[]) ?? []).filter((x) => x !== rec.id);
      }
    }
  }
}

function clean(fields: Record<string, unknown>) {
  // Airtable drops null / empty values
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Supports only the formula shapes the app generates. */
function evalFormula(formula: string, r: AirtableRecord): boolean {
  let m = /^OR\((.*)\)$/.exec(formula);
  if (m) return [...m[1].matchAll(/RECORD_ID\(\)='(rec\w+)'/g)].some((x) => x[1] === r.id);
  m = /^LOWER\(TRIM\(\{(.+)\}\)\)="(.*)"$/.exec(formula);
  if (m) return String(r.fields[m[1]] ?? "").trim().toLowerCase() === m[2];
  m = /^\{(.+)\}$/.exec(formula);
  if (m) return !!r.fields[m[1]];
  throw new Error(`FakeAirtable cannot evaluate formula: ${formula}`);
}
