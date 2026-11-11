import { z } from "zod/v4";

export const list = () => z.array(z.any());
export const numbers = () => z.array(z.number());
export const date = () => z.union([z.string(), z.number()]);
export const agg = () => z.enum(["sum", "avg", "count", "min", "max"]);

/** Reads `field` from a row, with dot paths; "" is the item itself, like @Filter. */
export function read(item: unknown, field: string): unknown {
  if (!field) return item;
  let cur: unknown = item;
  for (const key of field.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Equality by value: lists and objects compare item by item, and a number
 * matches its string form (ids from inputs are often strings).
 */
export function same(a: unknown, b: unknown): boolean {
  const pairs = new WeakMap<object, WeakSet<object>>();
  const pending: [unknown, unknown][] = [[a, b]];
  let work = 0;
  while (pending.length) {
    if (++work > 100_000) throw new RangeError("comparison length exceeds budget");
    const [left, right] = pending.pop()!;
    if (left === right) continue;
    const mixed = (typeof left === "number" && typeof right === "string") || (typeof left === "string" && typeof right === "number");
    if (mixed) { if (String(left) !== String(right)) return false; continue; }
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
    let seen = pairs.get(left);
    if (seen?.has(right)) continue;
    if (!seen) { seen = new WeakSet(); pairs.set(left, seen); }
    seen.add(right);
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    if (work + pending.length + keys.length > 100_000) throw new RangeError("comparison length exceeds budget");
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false;
      pending.push([(left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

/** A finite number or a thrown error, which the runtime turns into null. */
export function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error("result is not a finite number");
  return value;
}

export function toNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type Agg = "sum" | "avg" | "count" | "min" | "max";

/** Aggregates the numbers read from rows; count counts rows. */
export function aggregate(rows: unknown[], field: string | undefined, how: Agg): number {
  if (how === "count") return rows.length;
  const values = rows.map((r) => toNum(read(r, field ?? ""))).filter((v): v is number => v !== null);
  if (!values.length) return 0;
  switch (how) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

/** Groups items by a key in first-seen order. */
export function groups(rows: unknown[], key: string): Map<string | number, unknown[]> {
  const out = new Map<string | number, unknown[]>();
  for (const row of rows) {
    const raw = read(row, key);
    const k = typeof raw === "number" ? raw : raw == null || raw === "" ? "Unknown" : String(raw);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export const MAX_ITEMS = 10000;
