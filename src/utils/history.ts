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

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const file = Bun.file(HISTORY_FILE);
    if (!(await file.exists())) return [];
    const data = (await file.json()) as Partial<HistoryFile>;
    return data.history ?? [];
  } catch {
    return [];
  }
}

/** Upsert an entry by manga id and move it to the front (most-recent-first). */
export async function recordHistory(entry: HistoryEntry): Promise<void> {
  const history = (await loadHistory()).filter((h) => h.id !== entry.id);
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
