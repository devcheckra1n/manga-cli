// Search + filtered browse via the same-origin Typesense proxy (no API key needed).

import { apiGet, resolveAssetUrl } from "./client.ts";
import { readCache, writeCache } from "../utils/cache.ts";
import { SEARCH_CACHE } from "../utils/paths.ts";
import type { SearchResult } from "./types.ts";

const QUERY_BY = "title,englishTitle,otherNames,authors";
const WEIGHTS = "4,3,2,1";
const INCLUDE =
  "id,title,englishTitle,poster,posterSmall,posterMedium,type,isAdult,status,year,mbRating,populairty";
const INFIX = "off,off,fallback,off";
const TTL = 10 * 60 * 1000; // 10 minutes

interface TSHit {
  document: Record<string, unknown>;
}
interface TSResponse {
  found?: number;
  hits?: TSHit[];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function toResult(d: Record<string, unknown>): SearchResult {
  const poster = str(d.poster) ?? str(d.posterMedium) ?? str(d.posterSmall);
  return {
    id: String(d.id),
    title: str(d.title) ?? str(d.englishTitle) ?? "Untitled",
    englishTitle: str(d.englishTitle),
    poster: poster ? resolveAssetUrl(poster) : undefined,
    type: str(d.type) ?? "Manga",
    status: str(d.status),
    year: num(d.year),
    isAdult: Boolean(d.isAdult),
    rating: num(d.mbRating),
    popularity: str(d.populairty),
  };
}

export interface SearchOpts {
  adult?: boolean;
  perPage?: number;
  page?: number; // 0-based
  /** Extra Typesense filter_by clause, ANDed in (e.g. "genreIds:=39"). */
  filterBy?: string;
}

async function runSearch(q: string, opts: SearchOpts, sort?: string): Promise<SearchResult[]> {
  const filters = ["hidden:!=true"];
  if (!opts.adult) filters.push("isAdult:=false");
  if (opts.filterBy) filters.push(opts.filterBy);

  const params: Record<string, string> = {
    q: q || "*",
    query_by: QUERY_BY,
    query_by_weights: WEIGHTS,
    include_fields: INCLUDE,
    filter_by: filters.join(" && "),
    per_page: String(opts.perPage ?? 24),
    page: String((opts.page ?? 0) + 1), // search is 1-based
  };
  if (q) params.infix = INFIX;
  else if (sort) params.sort_by = sort;

  const cacheKey = JSON.stringify(["search", params]);
  const hit = await readCache<SearchResult[]>(SEARCH_CACHE, cacheKey, TTL);
  if (hit) return hit;

  const res = await apiGet<TSResponse>("/collections/manga/documents/search", params);
  const results = (res.hits ?? []).map((h) => toResult(h.document));
  await writeCache(SEARCH_CACHE, cacheKey, results);
  return results;
}

/** Free-text manga search. */
export function searchManga(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  return runSearch(query.trim(), opts);
}

/** Browse all manga matching a filter_by clause, sorted (defaults to popularity). */
export function browseByFilter(
  filterBy: string,
  opts: SearchOpts = {},
  sort = "views:desc",
): Promise<SearchResult[]> {
  return runSearch("", { ...opts, filterBy }, sort);
}
