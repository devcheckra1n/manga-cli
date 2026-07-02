// Source registry + fallback routing. Top-level operations (search, discovery,
// genre) try the primary source, then each fallback in order until one answers.
// A manga remembers which source it came from, so info/chapters/pages route back
// to that same source.

import { atsumaru } from "./sources/atsumaru.ts";
import { mangadex } from "./sources/mangadex.ts";
import { weebcentral } from "./sources/weebcentral.ts";
import { mangakatana } from "./sources/mangakatana.ts";
import { ApiError } from "./client.ts";
import { downSources, markDown, markUp, hasInternet } from "../utils/health.ts";
import type {
  DiscoveryItem,
  DiscoveryKind,
  Filters,
  SearchResult,
  Source,
  SourceId,
} from "./types.ts";

export const SOURCES: Record<SourceId, Source> = { atsumaru, weebcentral, mangakatana, mangadex };

export function allSources(): Source[] {
  return [atsumaru, weebcentral, mangakatana, mangadex];
}
export function isSourceId(s: string): s is SourceId {
  return s in SOURCES;
}

let primary: SourceId = "atsumaru";
let fallbacks: SourceId[] = ["weebcentral", "mangakatana", "mangadex"];

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

// Chain ordered so healthy sources are tried first and any in their failure
// cooldown come last (still tried, but only as a last resort).
async function liveOrderedChain(): Promise<SourceId[]> {
  const down = await downSources();
  const ids = chain().filter((id) => SOURCES[id].available);
  return [...ids.filter((id) => !down.has(id)), ...ids.filter((id) => down.has(id))];
}

/** When every source failed, blame the right thing: their servers or the user's wifi. */
async function chainError(lastErr: unknown): Promise<Error> {
  if (!(await hasInternet())) {
    return new ApiError("your internet connection looks down — nothing was marked unhealthy; retry when you're back online");
  }
  return lastErr instanceof Error ? lastErr : new ApiError(String(lastErr));
}

/** Search across the chain; returns the first source with results. */
export async function searchAny(
  query: string,
  opts: { adult?: boolean; page?: number },
): Promise<SourceResult<SearchResult>> {
  let lastErr: unknown;
  for (const id of await liveOrderedChain()) {
    try {
      const items = await SOURCES[id].search(query, opts);
      await markUp(id);
      if (items.length > 0) return { items: tag(items, id), source: id };
      note(`${id}: no results, trying next`);
    } catch (e) {
      lastErr = e;
      if (!(await markDown(id))) note(`${id}: failure not recorded (connection looks offline)`);
      else note(`${id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (lastErr) throw await chainError(lastErr);
  return { items: [], source: primary };
}

/** Discovery feed across the chain; returns the first source that yields items. */
export async function discoveryAny(
  kind: DiscoveryKind,
  page: number,
  adult: boolean,
): Promise<SourceResult<DiscoveryItem>> {
  let lastErr: unknown;
  for (const id of await liveOrderedChain()) {
    try {
      const items = await SOURCES[id].discovery(kind, page, adult);
      await markUp(id);
      if (items.length > 0) return { items: tag(items, id), source: id };
    } catch (e) {
      lastErr = e;
      if (!(await markDown(id))) note(`${id}: failure not recorded (connection looks offline)`);
      else note(`${id} discovery failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (lastErr) throw await chainError(lastErr);
  return { items: [], source: primary };
}

/** Genre filters from the first working source (genre ids are source-specific). */
export async function filtersAny(): Promise<SourceResult<Filters["genres"][number]> & { filters: Filters }> {
  let lastErr: unknown;
  for (const id of await liveOrderedChain()) {
    try {
      const filters = await SOURCES[id].filters();
      await markUp(id);
      if (filters.genres.length > 0) return { items: filters.genres, filters, source: id };
    } catch (e) {
      lastErr = e;
      if (!(await markDown(id))) note(`${id}: failure not recorded (connection looks offline)`);
      else note(`${id} filters failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw await chainError(lastErr ?? new ApiError("No source could provide genres."));
}
