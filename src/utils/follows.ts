// Followed series, persisted as ~/.config/manga-cli/follows.json.
// Local-only (no account needed): we remember the chapter count at follow/read
// time so `--updates` can show which titles have new chapters.

import { mkdir } from "node:fs/promises";
import { FOLLOWS_FILE, CONFIG_DIR } from "./paths.ts";

export interface FollowEntry {
  id: string;
  title: string;
  coverUrl?: string;
  /** Chapter count last time we checked (the baseline for "new chapters"). */
  chapterCount: number;
  followedAt: string; // ISO 8601
}

interface FollowsFile {
  follows: FollowEntry[];
}

export async function loadFollows(): Promise<FollowEntry[]> {
  try {
    const file = Bun.file(FOLLOWS_FILE);
    if (!(await file.exists())) return [];
    const data = (await file.json()) as Partial<FollowsFile>;
    return data.follows ?? [];
  } catch {
    return [];
  }
}

async function save(follows: FollowEntry[]): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(FOLLOWS_FILE, JSON.stringify({ follows }, null, 2));
  } catch {
    // best-effort
  }
}

export async function isFollowed(id: string): Promise<boolean> {
  return (await loadFollows()).some((f) => f.id === id);
}

/** Add (or refresh) a follow. Returns the resulting list. */
export async function addFollow(entry: FollowEntry): Promise<void> {
  const follows = (await loadFollows()).filter((f) => f.id !== entry.id);
  follows.unshift(entry);
  await save(follows);
}

export async function removeFollow(id: string): Promise<void> {
  await save((await loadFollows()).filter((f) => f.id !== id));
}

/** Toggle follow state for a manga; returns the new state (true = now followed). */
export async function toggleFollow(entry: Omit<FollowEntry, "followedAt">): Promise<boolean> {
  if (await isFollowed(entry.id)) {
    await removeFollow(entry.id);
    return false;
  }
  await addFollow({ ...entry, followedAt: new Date().toISOString() });
  return true;
}

/** Update the stored baseline chapter count (call after checking for updates). */
export async function markSeen(id: string, chapterCount: number): Promise<void> {
  const follows = await loadFollows();
  const f = follows.find((x) => x.id === id);
  if (!f) return;
  f.chapterCount = chapterCount;
  await save(follows);
}
