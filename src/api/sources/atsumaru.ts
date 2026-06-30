// Atsumaru (atsu.moe) source — thin adapter over the original reverse-engineered
// modules. This is the default/primary source.

import { searchManga, browseByFilter } from "../search.ts";
import { getMangaInfo, getDiscovery, getFilters, getRelated } from "../manga.ts";
import { getChapterPages } from "../chapter.ts";
import type { Source } from "../types.ts";

export const atsumaru: Source = {
  id: "atsumaru",
  label: "Atsumaru (atsu.moe)",
  available: true,
  search: (query, opts) => searchManga(query, opts),
  discovery: (kind, page, adult) => getDiscovery(kind, page, adult),
  filters: () => getFilters(),
  browseGenre: (genreId, adult) => browseByFilter(`genreIds:=${genreId}`, { adult }, "views:desc"),
  info: (mangaId) => getMangaInfo(mangaId),
  pages: (mangaId, chapterId) => getChapterPages(mangaId, chapterId),
  related: (mangaId, page, adult) => getRelated(mangaId, "mangaRecommendations", page, adult),
};
