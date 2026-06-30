// Source registry + fallback routing. Top-level operations (search, discovery,
// genre) try the primary source, then each fallback in order until one answers.
// A manga remembers which source it came from, so info/chapters/pages route back
// to that same source.

import { atsumaru } from "./sources/atsumaru.ts";
import { mangadex } from "./sources/mangadex.ts";
import { weebcentral } from "./sources/weebcentral.ts";
import { ApiError } from "./client.ts";
import type {
  DiscoveryItem,
  DiscoveryKind,
  Filters,
  SearchResult,
  Source,
  SourceId,
} from "./types.ts";

// A placeholder for a source that isn't usable yet (not implemented or blocked).
// Registered so the chain can name it and fall through cleanly.
function stubSource(id: SourceId, label: string, reason: string): Source {
  const fail = async (): Promise<never> => {
    throw new ApiError(`${label} is unavailable — ${reason}`);
  };
  return {
    id,
    label,
    available: false,
    search: fail,
    discovery: fail,
    filters: fail,
    browseGenre: fail,
    info: fail,
    pages: fail,
    related: async () => [],
  };
}

const mangadot = stubSource("mangadot", "MangaDot (mangadot.net)", "its SPA API isn't mapped yet");

export const SOURCES: Record<SourceId, Source> = { atsumaru, mangadex, weebcentral, mangadot };

export function allSources(): Source[] {
  return [atsumaru, mangadex, weebcentral, mangadot];
}
export function isSourceId(s: string): s is SourceId {
  return s in SOURCES;
}

let primary: SourceId = "atsumaru";
let fallbacks: SourceId[] = ["mangadex"];

export function configureSources(primaryId: SourceId, fallbackIds: SourceId[]): void {
  primary = primaryId;
  fallbacks = fallbackIds;
}
export function primaryId(): SourceId {
  return primary;
}

/**
 * Ordered, de-duplicated source chain: primary first, then configured fallbacks,
 * then any remaining *available* source as a last resort (so an open backend is
 * always reachable even if `fallback` is misconfigured).
 */
export function chain(): SourceId[] {
  const seen = new Set<SourceId>();
  const out: SourceId[] = [];
  const add = (id: SourceId): void => {
    if (SOURCES[id] && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  add(primary);
  for (const id of fallbacks) add(id);
  for (const s of allSources()) if (s.available) add(s.id);
  return out;
}

/** The source a manga is bound to (from its `source` tag), or the primary. */
export function getSource(id: SourceId | undefined): Source {
  return SOURCES[id ?? primary] ?? SOURCES[primary];
}

function tag<T extends { source?: SourceId }>(items: T[], id: SourceId): T[] {
  for (const it of items) it.source = id;
  return items;
}

function note(msg: string): void {
  if (process.env.MANGA_CLI_DEBUG === "1") console.error(`[source] ${msg}`);
}

export interface SourceResult<T> {
  items: T[];
  source: SourceId;
}

/** Search across the chain; returns the first source with results. */
export async function searchAny(
  query: string,
  opts: { adult?: boolean; page?: number },
): Promise<SourceResult<SearchResult>> {
  let lastErr: unknown;
  for (const id of chain()) {
    const s = SOURCES[id];
    if (!s.available) continue;
    try {
      const items = await s.search(query, opts);
      if (items.length > 0) return { items: tag(items, id), source: id };
      note(`${id}: no results, trying next`);
    } catch (e) {
      lastErr = e;
      note(`${id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (lastErr) throw lastErr;
  return { items: [], source: primary };
}

/** Discovery feed across the chain; returns the first source that yields items. */
export async function discoveryAny(
  kind: DiscoveryKind,
  page: number,
  adult: boolean,
): Promise<SourceResult<DiscoveryItem>> {
  let lastErr: unknown;
  for (const id of chain()) {
    const s = SOURCES[id];
    if (!s.available) continue;
    try {
      const items = await s.discovery(kind, page, adult);
      if (items.length > 0) return { items: tag(items, id), source: id };
    } catch (e) {
      lastErr = e;
      note(`${id} discovery failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (lastErr) throw lastErr;
  return { items: [], source: primary };
}

/** Genre filters from the first working source (genre ids are source-specific). */
export async function filtersAny(): Promise<SourceResult<Filters["genres"][number]> & { filters: Filters }> {
  let lastErr: unknown;
  for (const id of chain()) {
    const s = SOURCES[id];
    if (!s.available) continue;
    try {
      const filters = await s.filters();
      if (filters.genres.length > 0) return { items: filters.genres, filters, source: id };
    } catch (e) {
      lastErr = e;
      note(`${id} filters failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw lastErr ?? new ApiError("No source could provide genres.");
}
