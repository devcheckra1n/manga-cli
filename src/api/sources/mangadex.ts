// MangaDex source (api.mangadex.org) — an open, documented API. Used as a backup
// when atsu.moe is unreachable, or as the primary via `source: "mangadex"`.

import { httpJson } from "../client.ts";
import { readCache, writeCache } from "../../utils/cache.ts";
import { MANGA_CACHE, SEARCH_CACHE, CHAPTERS_CACHE } from "../../utils/paths.ts";
import type {
  BrowseSort,
  DiscoveryItem,
  DiscoveryKind,
  Filters,
  MangaInfo,
  ReadChapter,
  SearchResult,
  Source,
} from "../types.ts";

const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const UA = "manga-cli/0.3 (+https://github.com/devcheckra1n/manga-cli)";
const HEADERS = { "User-Agent": UA };
const TTL = 60 * 60 * 1000;

type Params = Record<string, string | number | string[] | undefined>;

function url(path: string, params: Params = {}): string {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
    else u.searchParams.append(k, String(v));
  }
  return u.toString();
}

function ratings(adult: boolean): string[] {
  return adult ? ["safe", "suggestive", "erotica", "pornographic"] : ["safe", "suggestive"];
}

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles?: Array<Record<string, string>>;
    year?: number | null;
    status?: string;
    contentRating?: string;
    availableTranslatedLanguages?: string[];
    tags?: Array<{ id: string; attributes: { name: Record<string, string>; group: string } }>;
  };
  relationships?: Array<{ type: string; id: string; attributes?: { fileName?: string } }>;
}

function pickTitle(a: MdManga["attributes"]): string {
  return (
    a.title.en ??
    Object.values(a.title)[0] ??
    a.altTitles?.find((t) => t.en)?.en ??
    "Untitled"
  );
}

function coverUrl(m: MdManga): string | undefined {
  const file = m.relationships?.find((r) => r.type === "cover_art")?.attributes?.fileName;
  return file ? `${UPLOADS}/covers/${m.id}/${file}.512.jpg` : undefined;
}

function mapManga(m: MdManga): SearchResult {
  const cr = m.attributes.contentRating ?? "safe";
  const status = m.attributes.status;
  return {
    id: m.id,
    title: pickTitle(m.attributes),
    poster: coverUrl(m),
    type: "Manga",
    status: status ? status[0].toUpperCase() + status.slice(1) : undefined,
    year: m.attributes.year ?? undefined,
    isAdult: cr === "pornographic" || cr === "erotica",
    source: "mangadex",
  };
}

const ORDER: Record<DiscoveryKind, [string, string]> = {
  trending: ["order[followedCount]", "desc"],
  popular: ["order[followedCount]", "desc"],
  mostBookmarked: ["order[followedCount]", "desc"],
  topRated: ["order[rating]", "desc"],
  recentlyAdded: ["order[createdAt]", "desc"],
  recentlyUpdated: ["order[latestUploadedChapter]", "desc"],
};

async function listManga(params: Params): Promise<SearchResult[]> {
  const res = await httpJson<{ data?: MdManga[] }>(
    url("/manga", {
      limit: 24,
      "includes[]": ["cover_art"],
      "availableTranslatedLanguage[]": ["en"], // only titles with English chapters
      ...params,
    }),
    { headers: HEADERS },
  );
  return (res.data ?? []).map(mapManga);
}

interface MdChapter {
  id: string;
  attributes: {
    chapter: string | null;
    title: string | null;
    pages: number;
    translatedLanguage?: string;
    publishAt?: string;
    createdAt?: string;
  };
  relationships?: Array<{ type: string; id: string }>;
}

/** Bubble exact / prefix title matches to the top (MangaDex relevance is weak). */
function rerank(results: SearchResult[], query: string): SearchResult[] {
  const q = query.toLowerCase().trim();
  return results
    .map((r, i) => {
      const t = r.title.toLowerCase();
      let score = i;
      if (t === q) score -= 1000;
      else if (t.startsWith(q)) score -= 500;
      else if (t.includes(q)) score -= 100;
      return { r, score };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.r);
}

// Paginate a manga's feed for the given languages and keep only readable
// (non-external, pages > 0) chapters.
async function fetchReadable(mangaId: string, langs: string[]): Promise<MdChapter[]> {
  const raw: MdChapter[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 2000) {
    const feed = await httpJson<{ data?: MdChapter[]; total?: number }>(
      url(`/manga/${mangaId}/feed`, {
        "translatedLanguage[]": langs,
        "order[chapter]": "asc",
        "includes[]": ["scanlation_group"],
        "contentRating[]": ["safe", "suggestive", "erotica", "pornographic"],
        limit: 100,
        offset,
      }),
      { headers: HEADERS },
    );
    raw.push(...(feed.data ?? []));
    total = feed.total ?? raw.length;
    offset += 100;
    if (!feed.data || feed.data.length === 0) break;
  }
  return raw.filter((ch) => (ch.attributes.pages ?? 0) > 0);
}

export const mangadex: Source = {
  id: "mangadex",
  label: "MangaDex (mangadex.org)",
  available: true,

  async search(query, opts) {
    const key = `md:search:${query}:${opts.adult ? 1 : 0}:${opts.page ?? 0}`;
    const hit = await readCache<SearchResult[]>(SEARCH_CACHE, key, 10 * 60 * 1000);
    if (hit) return hit;
    const results = rerank(
      await listManga({
        title: query,
        offset: (opts.page ?? 0) * 24,
        "contentRating[]": ratings(opts.adult ?? false),
        "hasAvailableChapters": "true", // skip delicensed titles with no readable chapters
        "order[relevance]": "desc",
      }),
      query,
    );
    await writeCache(SEARCH_CACHE, key, results);
    return results;
  },

  async discovery(kind, page, adult): Promise<DiscoveryItem[]> {
    const [orderKey, dir] = ORDER[kind];
    return listManga({
      offset: page * 24,
      "contentRating[]": ratings(adult),
      [orderKey]: dir,
      "hasAvailableChapters": "true",
    });
  },

  async filters(): Promise<Filters> {
    const key = "md:tags";
    const hit = await readCache<Filters>(MANGA_CACHE, key, 24 * 60 * 60 * 1000);
    if (hit) return hit;
    const res = await httpJson<{ data?: Array<{ id: string; attributes: { name: Record<string, string>; group: string } }> }>(
      url("/manga/tag"),
      { headers: HEADERS },
    );
    const genres = (res.data ?? [])
      .filter((t) => t.attributes.group === "genre" || t.attributes.group === "theme")
      .map((t) => ({ id: t.id, name: t.attributes.name.en ?? Object.values(t.attributes.name)[0] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const filters: Filters = {
      genres,
      tags: [],
      types: [],
      statuses: [
        { id: "ongoing", name: "Ongoing" },
        { id: "completed", name: "Completed" },
        { id: "hiatus", name: "Hiatus" },
        { id: "cancelled", name: "Cancelled" },
      ],
    };
    await writeCache(MANGA_CACHE, key, filters);
    return filters;
  },

  async browse(f): Promise<SearchResult[]> {
    const order: Record<BrowseSort, [string, string]> = {
      popular: ["order[followedCount]", "desc"],
      latest: ["order[latestUploadedChapter]", "desc"],
      rating: ["order[rating]", "desc"],
      alphabetical: ["order[title]", "asc"],
    };
    const [orderKey, dir] = order[f.sort ?? "popular"];
    return listManga({
      "includedTags[]": f.genreId ? [f.genreId] : undefined,
      "status[]": f.status ? [f.status] : undefined,
      "contentRating[]": ratings(f.adult ?? false),
      hasAvailableChapters: "true",
      [orderKey]: dir,
    });
  },

  async info(mangaId): Promise<MangaInfo> {
    const key = `md:info:${mangaId}`;
    const hit = await readCache<MangaInfo>(MANGA_CACHE, key, TTL);
    if (hit) return hit;

    const detail = await httpJson<{ data: MdManga }>(
      url(`/manga/${mangaId}`, { "includes[]": ["cover_art"] }),
      { headers: HEADERS },
    );
    const longStrip = (detail.data.attributes.tags ?? []).some(
      (t) => (t.attributes.name.en ?? "").toLowerCase() === "long strip",
    );

    // Prefer English; if it has no *readable* chapters, fall back to whichever
    // language has the most (so big multi-language titles still open).
    let raw = await fetchReadable(mangaId, ["en"]);
    if (raw.length === 0) {
      const others = (detail.data.attributes.availableTranslatedLanguages ?? []).filter((l) => l && l !== "en");
      if (others.length > 0) {
        const all = await fetchReadable(mangaId, others);
        const byLang = new Map<string, MdChapter[]>();
        for (const ch of all) {
          const l = ch.attributes.translatedLanguage ?? "??";
          const arr = byLang.get(l) ?? [];
          arr.push(ch);
          byLang.set(l, arr);
        }
        for (const arr of byLang.values()) if (arr.length > raw.length) raw = arr;
      }
    }

    // One release per chapter number (first scanlation wins).
    const seen = new Set<string>();
    const picked: MdChapter[] = [];
    for (const ch of raw) {
      const k = ch.attributes.chapter ?? `oneshot:${ch.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(ch);
    }
    picked.sort((a, b) => (parseFloat(a.attributes.chapter ?? "1e9") || 1e9) - (parseFloat(b.attributes.chapter ?? "1e9") || 1e9));

    const info: MangaInfo = {
      id: mangaId,
      title: pickTitle(detail.data.attributes),
      type: "Manga",
      forceStrip: longStrip,
      chapters: picked.map((ch, i) => {
        const num = parseFloat(ch.attributes.chapter ?? "");
        return {
          id: ch.id,
          title: ch.attributes.title || (ch.attributes.chapter ? `Chapter ${ch.attributes.chapter}` : "Oneshot"),
          number: Number.isFinite(num) ? num : i + 1,
          index: i,
          pageCount: ch.attributes.pages ?? 0,
          scanId: ch.relationships?.find((r) => r.type === "scanlation_group")?.id ?? "",
          createdAt: Date.parse(ch.attributes.publishAt ?? ch.attributes.createdAt ?? "") || undefined,
        };
      }),
    };
    await writeCache(MANGA_CACHE, key, info);
    return info;
  },

  async pages(_mangaId, chapterId): Promise<ReadChapter> {
    const key = `md:pages:${chapterId}`;
    const hit = await readCache<ReadChapter>(CHAPTERS_CACHE, key, TTL);
    if (hit) return hit;
    const res = await httpJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(
      url(`/at-home/server/${chapterId}`),
      { headers: HEADERS },
    );
    const { baseUrl, chapter } = res;
    const out: ReadChapter = {
      id: chapterId,
      title: "",
      scanId: "",
      pages: chapter.data.map((file, i) => ({
        id: `${chapterId}-${i}`,
        url: `${baseUrl}/data/${chapter.hash}/${file}`,
        number: i,
        width: 0,
        height: 0,
        aspectRatio: 1,
      })),
    };
    await writeCache(CHAPTERS_CACHE, key, out);
    return out;
  },

  // MangaDex has no public "similar" endpoint; recommendations fall back elsewhere.
  async related(): Promise<DiscoveryItem[]> {
    return [];
  },
};
