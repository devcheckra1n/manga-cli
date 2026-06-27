// XDG-aware filesystem locations for cache + config.
// macOS doesn't define XDG vars, but the ~/.cache and ~/.config defaults work fine there too.

import { homedir } from "node:os";
import { join } from "node:path";

const APP = "manga-cli";

function baseDir(xdgVar: string, fallback: string): string {
  const xdg = process.env[xdgVar];
  if (xdg && xdg.startsWith("/")) return xdg;
  return join(homedir(), fallback);
}

export const CACHE_DIR = join(baseDir("XDG_CACHE_HOME", ".cache"), APP);
export const CONFIG_DIR = join(baseDir("XDG_CONFIG_HOME", ".config"), APP);

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const HISTORY_FILE = join(CONFIG_DIR, "history.json");
export const FOLLOWS_FILE = join(CONFIG_DIR, "follows.json");

export const COVERS_DIR = join(CACHE_DIR, "covers");
export const PAGES_DIR = join(CACHE_DIR, "pages");
export const SEARCH_CACHE = join(CACHE_DIR, "search");
export const MANGA_CACHE = join(CACHE_DIR, "manga");
export const CHAPTERS_CACHE = join(CACHE_DIR, "chapters");

/** Expand a leading ~ to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}
