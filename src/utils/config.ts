// User configuration, persisted as ~/.config/manga-cli/config.json (XDG-aware).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CONFIG_FILE, CONFIG_DIR, expandTilde } from "./paths.ts";

export type ReaderMode = "auto" | "kitty" | "iterm2" | "chafa";
/** Reading direction. Manga is right-to-left; comics/webtoons are left-to-right. */
export type Direction = "rtl" | "ltr";
/** How a single page fills the screen. */
export type FitMode = "page" | "width";

export interface Config {
  source: string;
  readerMode: ReaderMode;
  /** Reading direction — controls which arrow advances the page. */
  direction: Direction;
  /** Show two pages side-by-side (a spread). */
  dualPage: boolean;
  /** Single-page fit: "page" = whole page visible, "width" = fill width. */
  fit: FitMode;
  /** Render scale, 0.4–1.0 (1.0 = use the whole screen). */
  zoom: number;
  /** Rows reserved at the bottom for the HUD (prevents images clipping it). */
  hudReserve: number;
  chafaSize: string;
  prefetchPages: number;
  showBanner: boolean;
  /** Include adult/18+ results in search and discovery. */
  adult: boolean;
  fzfArgs: string;
  downloadDir: string;
}

export const DEFAULT_CONFIG: Config = {
  source: "atsumaru",
  readerMode: "auto",
  direction: "rtl",
  dualPage: false,
  fit: "page",
  zoom: 1.0,
  hudReserve: 2,
  chafaSize: "auto",
  prefetchPages: 2,
  showBanner: true,
  adult: false,
  fzfArgs: "",
  downloadDir: join(homedir(), "Downloads", "manga-cli"),
};

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1.0;
  return Math.min(1.0, Math.max(0.4, z));
}

let cached: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cached) return cached;
  let merged: Config = { ...DEFAULT_CONFIG };
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const data = (await file.json()) as Partial<Config>;
      merged = { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // Malformed config → fall back to defaults rather than crashing.
  }
  merged.downloadDir = expandTilde(merged.downloadDir);
  merged.zoom = clampZoom(merged.zoom);
  merged.hudReserve = Math.max(1, Math.min(6, Math.floor(merged.hudReserve)));
  cached = merged;
  return cached;
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  cached = cfg;
}

/** Write a default config file if none exists yet. Returns the path if created. */
export async function ensureConfigFile(): Promise<string | null> {
  if (await Bun.file(CONFIG_FILE).exists()) return null;
  await saveConfig(DEFAULT_CONFIG);
  return CONFIG_FILE;
}
