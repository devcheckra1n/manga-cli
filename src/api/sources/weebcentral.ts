// Weeb Central (weebcentral.com) source — an HTMX site (no JSON API), so we scrape
// its HTML fragments. It has a large, current scanlation library (e.g. Berserk up
// to the latest chapter), which makes it a strong backup for titles MangaDex has
// delicensed.

import { httpText } from "../client.ts";
import { readCache, writeCache } from "../../utils/cache.ts";
import { MANGA_CACHE, SEARCH_CACHE, CHAPTERS_CACHE } from "../../utils/paths.ts";
import type { DiscoveryItem, Filters, MangaInfo, ReadChapter, SearchResult, Source } from "../types.ts";

const BASE = "https://weebcentral.com";
const HEADERS = { Referer: BASE + "/" };
const TTL = 60 * 60 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Parse weebcentral series cards (used by search + discovery fragments). */
function parseSeries(html: string): SearchResult[] {
  const coverById = new Map<string, string>();
  for (const m of html.matchAll(/src="(https:\/\/[^"]*\/cover\/[^"]*\/([A-Z0-9]{10,})\.[a-z]+)"/g)) {
    coverById.set(m[2], m[1]);
  }
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /href="https:\/\/weebcentral\.com\/series\/([A-Z0-9]{10,})\/[^"]*"[^>]*>([^<]{1,160})</g,
  )) {
    const id = m[1];
    const title = decodeEntities(m[2]);
    if (!title || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      poster: coverById.get(id) ?? `https://temp.compsci88.com/cover/normal/${id}.webp`,
      type: "Manga",
      isAdult: false,
      source: "weebcentral",
    });
  }
  return out;
}

async function fragment(path: string): Promise<string> {
  return httpText(BASE + path, { headers: HEADERS });
}

export const weebcentral: Source = {
  id: "weebcentral",
  label: "Weeb Central (weebcentral.com)",
  available: true,

  async search(query): Promise<SearchResult[]> {
    const key = `wc:search:${query}`;
    const hit = await readCache<SearchResult[]>(SEARCH_CACHE, key, 10 * 60 * 1000);
    if (hit) return hit;
    const params = new URLSearchParams({
      text: query,
      sort: "Best Match",
      order: "Descending",
      official: "Any",
      display_mode: "Full Display",
    });
    const html = await fragment(`/search/data?${params.toString()}`);
    const results = parseSeries(html).slice(0, 24);
    await writeCache(SEARCH_CACHE, key, results);
    return results;
  },

  async discovery(kind, page): Promise<DiscoveryItem[]> {
    const path =
      kind === "recentlyAdded"
        ? `/recently-added/${page + 1}`
        : kind === "recentlyUpdated"
          ? `/latest-updates/${page + 1}`
          : `/hot-series`;
    return parseSeries(await fragment(path)).slice(0, 32);
  },

  // No public genre listing; let another source provide genres.
  async filters(): Promise<Filters> {
    return { genres: [], tags: [], types: [], statuses: [] };
  },
  async browse(): Promise<SearchResult[]> {
    return [];
  },

  async info(seriesId): Promise<MangaInfo> {
    const key = `wc:info:${seriesId}`;
    const hit = await readCache<MangaInfo>(MANGA_CACHE, key, TTL);
    if (hit) return hit;

    const page = await fragment(`/series/${seriesId}`);
    const titleMatch = page.match(/<title>([^<]+?)(?:\s*\|\s*Weeb Central)?<\/title>/i);
    const title = titleMatch ? decodeEntities(titleMatch[1]) : "Untitled";
    const longStrip = /\b(Manhwa|Manhua|Webtoon|Long Strip)\b/i.test(page);

    // Strip the inline SVG icons first — they're huge and contain `#color` codes
    // that would otherwise be mistaken for "# 122"-style chapter labels.
    const list = (await fragment(`/series/${seriesId}/full-chapter-list`)).replace(/<svg[\s\S]*?<\/svg>/g, "");
    const raw: Array<{ id: string; number: number }> = [];
    const seen = new Set<string>();
    // Labels look like "Chapter 385", "Episode 5", or "# 122".
    for (const m of list.matchAll(
      /href="https:\/\/weebcentral\.com\/chapters\/([A-Z0-9]{10,})"[\s\S]{0,600}?>\s*(?:Chapter\s+|Episode\s+|#\s*)([0-9]+(?:\.[0-9]+)?)\s*</g,
    )) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      raw.push({ id, number: parseFloat(m[2]) });
    }
    raw.sort((a, b) => a.number - b.number);

    const info: MangaInfo = {
      id: seriesId,
      title,
      type: longStrip ? "Manhwa" : "Manga",
      forceStrip: longStrip,
      chapters: raw.map((ch, i) => ({
        id: ch.id,
        title: `Chapter ${ch.number}`,
        number: ch.number,
        index: i,
        pageCount: 0,
        scanId: "",
      })),
    };
    await writeCache(MANGA_CACHE, key, info);
    return info;
  },

  async pages(_seriesId, chapterId): Promise<ReadChapter> {
    const key = `wc:pages:${chapterId}`;
    const hit = await readCache<ReadChapter>(CHAPTERS_CACHE, key, TTL);
    if (hit) return hit;
    const html = await fragment(`/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`);
    const urls: string[] = [];
    for (const m of html.matchAll(/src="(https:\/\/[^"]+\.(?:webp|jpg|jpeg|png|avif))"/gi)) {
      urls.push(m[1]);
    }
    const out: ReadChapter = {
      id: chapterId,
      title: "",
      scanId: "",
      pages: urls.map((url, i) => ({ id: `${chapterId}-${i}`, url, number: i, width: 0, height: 0, aspectRatio: 1 })),
    };
    await writeCache(CHAPTERS_CACHE, key, out);
    return out;
  },

  async related(): Promise<DiscoveryItem[]> {
    return [];
  },
};
