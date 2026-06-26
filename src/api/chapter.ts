// Chapter page lists for the reader.

import { apiGet, resolveAssetUrl } from "./client.ts";
import { readCache, writeCache } from "../utils/cache.ts";
import { CHAPTERS_CACHE } from "../utils/paths.ts";
import type { ReadChapter, Page } from "./types.ts";

const TTL = 60 * 60 * 1000; // 1 hour

interface ReadResponse {
  readChapter?: {
    id: string;
    title: string;
    scanlationMangaId: string;
    pages?: Array<{
      id: string;
      image: string;
      number: number;
      width: number;
      height: number;
      aspectRatio: number;
    }>;
  };
}

/** Fetch the resolved page list for a chapter. Cached 1h. */
export async function getChapterPages(mangaId: string, chapterId: string): Promise<ReadChapter> {
  const key = `read:${mangaId}:${chapterId}`;
  const cached = await readCache<ReadChapter>(CHAPTERS_CACHE, key, TTL);
  if (cached) return cached;

  const res = await apiGet<ReadResponse>("/api/read/chapter", { mangaId, chapterId });
  const rc = res.readChapter;
  if (!rc) throw new Error("Chapter has no readable pages.");

  const chapter: ReadChapter = {
    id: rc.id,
    title: rc.title,
    scanId: rc.scanlationMangaId,
    pages: (rc.pages ?? []).map(
      (p): Page => ({
        id: p.id,
        url: resolveAssetUrl(p.image),
        number: p.number,
        width: p.width,
        height: p.height,
        aspectRatio: p.aspectRatio,
      }),
    ),
  };
  await writeCache(CHAPTERS_CACHE, key, chapter);
  return chapter;
}
