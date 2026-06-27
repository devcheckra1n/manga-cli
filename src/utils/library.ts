// Offline library: browse and read what you've downloaded (CBZ / ZIP / folders),
// with no network. Chapters are read back through the normal reader via a custom
// page loader that points at local files (file:// URLs).

import { readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hashKey } from "./cache.ts";
import { CACHE_DIR } from "./paths.ts";
import type { Chapter, MangaInfo, Page, ReadChapter } from "../api/types.ts";

const IMAGE_RE = /\.(webp|jpe?g|png|gif|avif|bmp)$/i;
const EXTRACT_DIR = join(CACHE_DIR, "extract");

export interface LibraryChapter {
  label: string;
  path: string;
  kind: "archive" | "folder";
}
export interface LibrarySeries {
  title: string;
  dir: string;
  chapters: LibraryChapter[];
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Discover downloaded series under `downloadDir`. */
export async function scanLibrary(downloadDir: string): Promise<LibrarySeries[]> {
  let titles: string[];
  try {
    titles = (await readdir(downloadDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const series: LibrarySeries[] = [];
  for (const title of titles) {
    const dir = join(downloadDir, title);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const chapters: LibraryChapter[] = [];
    for (const e of entries) {
      if (e.isFile() && /\.(cbz|zip)$/i.test(e.name)) {
        chapters.push({ label: e.name.replace(/\.(cbz|zip)$/i, ""), path: join(dir, e.name), kind: "archive" });
      } else if (e.isDirectory()) {
        chapters.push({ label: e.name, path: join(dir, e.name), kind: "folder" });
      }
    }
    if (chapters.length === 0) continue;
    chapters.sort((a, b) => naturalSort(a.label, b.label));
    series.push({ title, dir, chapters });
  }
  series.sort((a, b) => naturalSort(a.title, b.title));
  return series;
}

async function collectImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (IMAGE_RE.test(e.name)) out.push(p);
    }
  }
  await walk(dir);
  out.sort(naturalSort);
  return out;
}

/** Extract an archive to a cached temp dir (once) and return its sorted image paths. */
async function archivePages(archivePath: string): Promise<string[]> {
  const dest = join(EXTRACT_DIR, hashKey(archivePath));
  const marker = join(dest, ".done");
  if (!(await Bun.file(marker).exists())) {
    await mkdir(dest, { recursive: true });
    if (!Bun.which("unzip")) throw new Error("`unzip` not found — needed to read CBZ/ZIP");
    const proc = Bun.spawn(["unzip", "-o", "-q", archivePath, "-d", dest], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) !== 0) throw new Error("failed to extract archive");
    await Bun.write(marker, "1");
  }
  return collectImages(dest);
}

function toPages(files: string[]): Page[] {
  return files.map((f, i) => ({
    id: `local-${i}`,
    url: "file://" + encodeURI(f),
    number: i + 1,
    width: 0,
    height: 0,
    aspectRatio: 1,
  }));
}

/** Build a reader-ready MangaInfo + a local page loader for a downloaded series. */
export function toReaderSource(series: LibrarySeries): {
  info: MangaInfo;
  loadChapter: (index: number) => Promise<ReadChapter>;
} {
  const chapters: Chapter[] = series.chapters.map((ch, i) => ({
    id: ch.path,
    title: ch.label,
    number: i + 1,
    index: i,
    pageCount: 0,
    scanId: "",
  }));

  const info: MangaInfo = {
    id: "local:" + series.title,
    title: series.title,
    type: "Manga",
    forceStrip: false,
    chapters,
  };

  const loadChapter = async (index: number): Promise<ReadChapter> => {
    const ch = series.chapters[index];
    if (!ch) throw new Error("invalid chapter");
    const files = ch.kind === "archive" ? await archivePages(ch.path) : await collectImages(ch.path);
    if (files.length === 0) throw new Error("no images in this chapter");
    return { id: ch.path, title: ch.label, scanId: "", pages: toPages(files) };
  };

  return { info, loadChapter };
}
