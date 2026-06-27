// Manga detail, chapter lists, discovery feeds, and available filters.

import { apiGet, resolveAssetUrl } from "./client.ts";
import { readCache, writeCache } from "../utils/cache.ts";
import { MANGA_CACHE } from "../utils/paths.ts";
import type { MangaInfo, DiscoveryItem, Filters } from "./types.ts";

const TTL = 60 * 60 * 1000; // 1 hour
const ALL_TYPES = "Manga,Manwha,Manhua,OEL";

interface InfoResponse {
  id: string;
  title: string;
  type: string;
  forceStrip?: boolean;
  chapters?: Array<{
    id: string;
    title?: string;
    number: number;
    index: number;
    pageCount: number;
    scanId?: string;
    scanlationMangaId?: string;
    createdAt?: number;
  }>;
}

/** Manga detail with full chapter list (ascending by number). Cached 1h. */
export async function getMangaInfo(mangaId: string): Promise<MangaInfo> {
  const key = "info:" + mangaId;
  const cached = await readCache<MangaInfo>(MANGA_CACHE, key, TTL);
  if (cached) return cached;

  const res = await apiGet<InfoResponse>("/api/manga/info", { mangaId });
  const info: MangaInfo = {
    id: res.id,
    title: res.title,
    type: res.type ?? "Manga",
    forceStrip: Boolean(res.forceStrip),
    chapters: (res.chapters ?? []).map((c) => ({
      id: c.id,
      title: c.title && c.title.length > 0 ? c.title : `Chapter ${c.number}`,
      number: c.number,
      index: c.index,
      pageCount: c.pageCount,
      scanId: c.scanId ?? c.scanlationMangaId ?? "",
      createdAt: c.createdAt,
    })),
  };
  await writeCache(MANGA_CACHE, key, info);
  return info;
}

export type DiscoveryKind =
  | "trending"
  | "popular"
  | "recentlyAdded"
  | "recentlyUpdated"
  | "topRated"
  | "mostBookmarked";

interface InfiniteResponse {
  items?: Array<Record<string, unknown>>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function mapItems(items: Array<Record<string, unknown>> | undefined): DiscoveryItem[] {
  return (items ?? []).map((it) => {
    const poster =
      str(it.image) ?? str(it.mediumImage) ?? str(it.smallImage) ?? str(it.largeImage) ?? str(it.poster);
    return {
      id: String(it.id),
      title: str(it.title) ?? "Untitled",
      poster: poster ? resolveAssetUrl(poster) : undefined,
      type: str(it.type) ?? "Manga",
      isAdult: Boolean(it.isAdult),
      rating: typeof it.mbRating === "number" ? it.mbRating : undefined,
      views: str(it.views),
    };
  });
}

/** A discovery feed page. `page` is 0-based. */
export async function getDiscovery(
  kind: DiscoveryKind,
  page = 0,
  adult = false,
): Promise<DiscoveryItem[]> {
  const params: Record<string, string> = { page: String(page), types: ALL_TYPES };
  if (adult) params.adult = "1";
  const res = await apiGet<InfiniteResponse>(`/api/infinite/${kind}`, params);
  return mapItems(res.items);
}

/** "More like this" feeds — keyed off a seed manga. `page` is 0-based. */
export type RelatedKind = "mangaSimilar" | "mangaRecommendations";

export async function getRelated(
  mangaId: string,
  kind: RelatedKind = "mangaRecommendations",
  page = 0,
  adult = false,
): Promise<DiscoveryItem[]> {
  const params: Record<string, string> = { mangaId, page: String(page), types: ALL_TYPES };
  if (adult) params.adult = "1";
  const res = await apiGet<InfiniteResponse>(`/api/infinite/${kind}`, params);
  return mapItems(res.items);
}

/** Genre / tag / type / status options for filtered browsing. Cached 1h. */
export async function getFilters(): Promise<Filters> {
  const key = "filters";
  const cached = await readCache<Filters>(MANGA_CACHE, key, TTL);
  if (cached) return cached;

  const res = await apiGet<Partial<Filters>>("/api/explore/availableFilters");
  const filters: Filters = {
    genres: res.genres ?? [],
    tags: res.tags ?? [],
    types: res.types ?? [],
    statuses: res.statuses ?? [],
  };
  await writeCache(MANGA_CACHE, key, filters);
  return filters;
}
