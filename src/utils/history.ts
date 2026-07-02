// Reading history, persisted as ~/.config/manga-cli/history.json.

import { mkdir } from "node:fs/promises";
import { HISTORY_FILE, CONFIG_DIR } from "./paths.ts";
import type { SourceId } from "../api/types.ts";

export interface HistoryEntry {
  id: string;
  title: string;
  source?: SourceId;
  coverUrl?: string;
  lastChapterId: string;
  lastChapterNumber: number;
  lastChapterTitle: string;
  lastChapterIndex: number;
  lastPage: number;
  totalChapters: number;
  lastReadAt: string; // ISO 8601
}

interface HistoryFile {
  history: HistoryEntry[];
}

const MAX_ENTRIES = 200;

function titleKey(t: string): string {
  return (t ?? "").trim().toLowerCase();
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const file = Bun.file(HISTORY_FILE);
    if (!(await file.exists())) return [];
    const data = (await file.json()) as Partial<HistoryFile>;
    const all = data.history ?? [];
    // Collapse duplicate titles (the same series read from different sources)
    // into one entry — entries are most-recent-first, so keep the first seen.
    const seen = new Set<string>();
    return all.filter((h) => {
      const k = titleKey(h.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [];
  }
}

/** Upsert an entry by id *or title* and move it to the front (most-recent-first). */
export async function recordHistory(entry: HistoryEntry): Promise<void> {
  const k = titleKey(entry.title);
  const history = (await loadHistory()).filter((h) => h.id !== entry.id && titleKey(h.title) !== k);
  history.unshift(entry);
  const trimmed = history.slice(0, MAX_ENTRIES);
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(HISTORY_FILE, JSON.stringify({ history: trimmed }, null, 2));
  } catch {
    // History is best-effort.
  }
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry | undefined> {
  return (await loadHistory()).find((h) => h.id === id);
}

export async function mostRecent(): Promise<HistoryEntry | undefined> {
  return (await loadHistory())[0];
}
