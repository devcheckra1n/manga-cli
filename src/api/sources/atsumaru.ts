// Atsumaru (atsu.moe) source — thin adapter over the original reverse-engineered
// modules. This is the default/primary source.

import { searchManga, browseByFilter } from "../search.ts";
import { getMangaInfo, getDiscovery, getFilters, getRelated } from "../manga.ts";
import { getChapterPages } from "../chapter.ts";
import type { BrowseSort, Source } from "../types.ts";

const ATSU_SORT: Record<BrowseSort, string> = {
  popular: "views:desc",
  latest: "year:desc",
  rating: "mbRating:desc",
  alphabetical: "title:asc",
};

export const atsumaru: Source = {
  id: "atsumaru",
  label: "Atsumaru (atsu.moe)",
  available: true,
  search: (query, opts) => searchManga(query, opts),
  discovery: (kind, page, adult) => getDiscovery(kind, page, adult),
  filters: () => getFilters(),
  browse: (f) => {
    const clauses: string[] = [];
    if (f.genreId) clauses.push(`genreIds:=${f.genreId}`);
    if (f.status) clauses.push(`status:=${f.status}`);
    return browseByFilter(clauses.join(" && "), { adult: f.adult }, ATSU_SORT[f.sort ?? "popular"]);
  },
  info: (mangaId) => getMangaInfo(mangaId),
  pages: (mangaId, chapterId) => getChapterPages(mangaId, chapterId),
  related: (mangaId, page, adult) => getRelated(mangaId, "mangaRecommendations", page, adult),
};
