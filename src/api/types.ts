// Shared domain types for the atsu.moe (Atsumaru) API.
// See ./endpoints.md for the reverse-engineered endpoint reference.

/** A manga as returned by the Typesense search proxy. */
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
  rating?: number; // mbRating (MangaBaka rating)
  popularity?: string; // e.g. "2.6M" — note: API field is misspelled "populairty"
}

/** A manga as returned by the discovery (/api/infinite/*) endpoints. */
export interface DiscoveryItem {
  id: string;
  title: string;
  poster?: string;
  type: string;
  isAdult: boolean;
  rating?: number;
  views?: string;
}

/** Lightweight reference to a manga, enough to open it. */
export interface MangaRef {
  id: string;
  title: string;
  poster?: string;
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
