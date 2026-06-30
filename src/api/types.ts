// Shared domain types across all sources (Atsumaru, MangaDex, …).
// See ./endpoints.md for the reverse-engineered Atsumaru endpoint reference.

/** Which backend a manga came from (so info/chapters/pages route back to it). */
export type SourceId = "atsumaru" | "mangadex" | "weebcentral" | "mangadot";

/** A manga as returned by search. */
export interface SearchResult {
  id: string;
  title: string;
  englishTitle?: string;
  /** Absolute, ready-to-fetch cover URL (already resolved). */
  poster?: string;
  type: string; // "Manga" | "Manwha" | "Manhua" | "OEL"
  status?: string;
  year?: number;
  isAdult: boolean;
  rating?: number;
  popularity?: string;
  source?: SourceId;
}

/** A manga as returned by the discovery feeds. */
export interface DiscoveryItem {
  id: string;
  title: string;
  poster?: string;
  type: string;
  isAdult: boolean;
  rating?: number;
  views?: string;
  source?: SourceId;
}

/** Lightweight reference to a manga, enough to open it. */
export interface MangaRef {
  id: string;
  title: string;
  poster?: string;
  source?: SourceId;
}

/** A single chapter within a manga. */
export interface Chapter {
  id: string;
  title: string;
  number: number;
  index: number;
  pageCount: number;
  /** scanlationMangaId — identifies the scanlation group's release. */
  scanId: string;
  createdAt?: number;
}

/** Manga detail with its chapter list (ascending by chapter number). */
export interface MangaInfo {
  id: string;
  title: string;
  type: string;
  forceStrip: boolean;
  chapters: Chapter[];
}

/** A single page image within a chapter. */
export interface Page {
  id: string;
  /** Absolute, ready-to-fetch image URL (already resolved). */
  url: string;
  number: number;
  width: number;
  height: number;
  aspectRatio: number;
}

/** A chapter's full page list, ready for the reader. */
export interface ReadChapter {
  id: string;
  title: string;
  scanId: string;
  pages: Page[];
}

export interface Genre {
  id: string;
  name: string;
}

export interface Filters {
  genres: Genre[];
  tags: Genre[];
  types: Genre[];
  statuses: Genre[];
}

/** Discovery feed kinds, mapped per-source to the nearest equivalent. */
export type DiscoveryKind =
  | "trending"
  | "popular"
  | "recentlyAdded"
  | "recentlyUpdated"
  | "topRated"
  | "mostBookmarked";

/** A content backend. Every read operation routes through one of these. */
export interface Source {
  readonly id: SourceId;
  readonly label: string;
  /** False for sources we know are blocked (e.g. anti-bot) — skipped in fallback. */
  readonly available: boolean;
  search(query: string, opts: { adult?: boolean; page?: number }): Promise<SearchResult[]>;
  discovery(kind: DiscoveryKind, page: number, adult: boolean): Promise<DiscoveryItem[]>;
  filters(): Promise<Filters>;
  browseGenre(genreId: string, adult: boolean): Promise<SearchResult[]>;
  info(mangaId: string): Promise<MangaInfo>;
  pages(mangaId: string, chapterId: string): Promise<ReadChapter>;
  related(mangaId: string, page: number, adult: boolean): Promise<DiscoveryItem[]>;
}
