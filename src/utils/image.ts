// Image download + on-disk caching (content-addressed by source URL).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hashKey } from "./cache.ts";
import { fetchBinary } from "../api/client.ts";

/**
 * Download an image to a content-addressed cache file and return its local path.
 * Returns null if the download fails (caller renders a placeholder).
 * Re-uses the cached file on subsequent calls, which is what makes paging feel instant.
 */
export async function cacheImage(dir: string, url: string): Promise<string | null> {
  const path = join(dir, hashKey(url) + ".img");
  if (await Bun.file(path).exists()) return path;
  const buf = await fetchBinary(url);
  if (!buf || buf.byteLength === 0) return null;
  try {
    await mkdir(dir, { recursive: true });
    await Bun.write(path, buf);
  } catch {
    return null;
  }
  return path;
}

/** Best-effort local path for an already-cached image (no download). */
export function cachedImagePath(dir: string, url: string): string {
  return join(dir, hashKey(url) + ".img");
}
