// Tiny disk cache: TTL-bound JSON entries, content-addressed by an md5 of the key.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function hashKey(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

interface Entry<T> {
  at: number;
  data: T;
}

/** Read a cached value if present and within `ttlMs`; otherwise null. */
export async function readCache<T>(dir: string, key: string, ttlMs: number): Promise<T | null> {
  try {
    const file = Bun.file(join(dir, hashKey(key) + ".json"));
    if (!(await file.exists())) return null;
    const entry = (await file.json()) as Entry<T>;
    if (Date.now() - entry.at > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function writeCache<T>(dir: string, key: string, data: T): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const entry: Entry<T> = { at: Date.now(), data };
    await Bun.write(join(dir, hashKey(key) + ".json"), JSON.stringify(entry));
  } catch {
    // Caching is best-effort; never fail a request because the cache write failed.
  }
}
