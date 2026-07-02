// MangaKatana (mangakatana.com) source — a plain HTML site we scrape. Replaces
// the old mangadot stub. Chapter pages hide the real image list in a JS array
// (with decoy arrays alongside it), so we pick the longest one.

import { httpText } from "../client.ts";
import { readCache, writeCache } from "../../utils/cache.ts";
import { MANGA_CACHE, SEARCH_CACHE, CHAPTERS_CACHE } from "../../utils/paths.ts";
import type { DiscoveryItem, Filters, MangaInfo, ReadChapter, SearchResult, Source } from "../types.ts";

const BASE = "https://mangakatana.com";
const HEADERS = { Referer: BASE + "/" };
const TTL = 60 * 60 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Manga id = the path after /manga/, e.g. "berserk.1087". */
function idFromUrl(url: string): string {
  return url.replace(/^https?:\/\/mangakatana\.com\/manga\//, "").replace(/\/.*$/, "");
}

function parseSearchItems(html: string): SearchResult[] {
  // A unique exact match 302s straight to the manga page (which has an
  // <h1 class="heading">); return just that title rather than its "related" widget.
  const h1 = html.match(/<h1 class="heading">([^<]+)<\/h1>/);
  const canon = html.match(/<link rel="canonical" href="(https:\/\/mangakatana\.com\/manga\/[^"]+)"/);
  if (h1 && canon) {
    const cover = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    return [
      { id: idFromUrl(canon[1]), title: decodeEntities(h1[1]), poster: cover, type: "Manga", isAdult: false, source: "mangakatana" },
    ];
  }
  // Otherwise it's a results list: only the result cards carry `data-id`
  // (sidebar/latest widgets use a plain `<div class="item">`).
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(
    /<div class="item" data-genre="[^"]*" data-id="\d+"([\s\S]*?)<h3 class="title">\s*<a[^>]*href="(https:\/\/mangakatana\.com\/manga\/[^"]+)"[^>]*>([^<]+)<\/a>/g,
  )) {
    const id = idFromUrl(m[2]);
    if (seen.has(id)) continue;
    seen.add(id);
    const cover = m[1].match(/<img[^>]+src="(https:\/\/mangakatana\.com\/imgs\/[^"]+)"/)?.[1];
    out.push({ id, title: decodeEntities(m[3]), poster: cover, type: "Manga", isAdult: false, source: "mangakatana" });
  }
  return out;
}

export const mangakatana: Source = {
  id: "mangakatana",
  label: "MangaKatana (mangakatana.com)",
  available: true,

  async search(query): Promise<SearchResult[]> {
    const key = `mk:search:${query}`;
    const hit = await readCache<SearchResult[]>(SEARCH_CACHE, key, 10 * 60 * 1000);
    if (hit) return hit;
    const html = await httpText(`${BASE}/?search=${encodeURIComponent(query)}&search_by=book_name`, { headers: HEADERS });
    const results = parseSearchItems(html).slice(0, 24);
    await writeCache(SEARCH_CACHE, key, results);
    return results;
  },

  // Discovery/genres come from other sources; MangaKatana is a search+read backend.
  async discovery(): Promise<DiscoveryItem[]> {
    return [];
  },
  async filters(): Promise<Filters> {
    return { genres: [], tags: [], types: [], statuses: [] };
  },
  async browse(): Promise<SearchResult[]> {
    return [];
  },

  async info(mangaId): Promise<MangaInfo> {
    const key = `mk:info:${mangaId}`;
    const hit = await readCache<MangaInfo>(MANGA_CACHE, key, TTL);
    if (hit) return hit;

    const page = await httpText(`${BASE}/manga/${mangaId}`, { headers: HEADERS });
    const title = decodeEntities(page.match(/<h1 class="heading">([^<]+)<\/h1>/)?.[1] ?? "Untitled");
    // The page is noisy (sidebars, recommendations), so we don't auto-detect
    // long-strip here — readers can toggle it with `w`.
    const longStrip = false;

    const raw: Array<{ seg: string; number: number }> = [];
    const seen = new Set<string>();
    for (const m of page.matchAll(
      /href="https:\/\/mangakatana\.com\/manga\/[^"]*\/(c[0-9.]+)"[^>]*>\s*(?:Chapter|Ch\.?|Episode)?\s*([0-9]+(?:\.[0-9]+)?)/gi,
    )) {
      const seg = m[1];
      if (seen.has(seg)) continue;
      seen.add(seg);
      raw.push({ seg, number: parseFloat(m[2]) });
    }
    raw.sort((a, b) => a.number - b.number);

    const info: MangaInfo = {
      id: mangaId,
      title,
      type: longStrip ? "Manhwa" : "Manga",
      forceStrip: longStrip,
      chapters: raw.map((ch, i) => ({
        id: ch.seg,
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

  async pages(mangaId, chapterSeg): Promise<ReadChapter> {
    const key = `mk:pages:${mangaId}/${chapterSeg}`;
    const hit = await readCache<ReadChapter>(CHAPTERS_CACHE, key, TTL);
    if (hit) return hit;
    const html = await httpText(`${BASE}/manga/${mangaId}/${chapterSeg}`, { headers: HEADERS });
    // The page declares several `var x=[ '…' ]` arrays; only one holds the real
    // images (the rest are decoys). Pick the longest array of image URLs.
    let best: string[] = [];
    for (const m of html.matchAll(/var\s+[a-zA-Z_$]+\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
      const urls = [...m[1].matchAll(/["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|avif)[^"']*)["']/gi)].map((x) => x[1]);
      if (urls.length > best.length) best = urls;
    }
    const out: ReadChapter = {
      id: chapterSeg,
      title: "",
      scanId: "",
      pages: best.map((url, i) => ({ id: `${chapterSeg}-${i}`, url, number: i, width: 0, height: 0, aspectRatio: 1 })),
    };
    await writeCache(CHAPTERS_CACHE, key, out);
    return out;
  },

  async related(): Promise<DiscoveryItem[]> {
    return [];
  },
};
