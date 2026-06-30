// nyaa.si manga torrents → magnet downloads via aria2c.
//
// We stay inside the "Literature" category (3_x) so we never touch the Anime
// (1_x) section. The sub-categories are the "dump types":
//   3_1 English-translated · 3_2 Non-English-translated · 3_3 Raw
// Note: Literature also holds light novels, so titles still matter.

import { mkdir } from "node:fs/promises";
import { httpText } from "../api/client.ts";

export type DumpType = "eng" | "raw" | "non-eng" | "all";

export const DUMP_TYPES: Array<{ id: DumpType; cat: string; label: string }> = [
  { id: "eng", cat: "3_1", label: "English-translated" },
  { id: "raw", cat: "3_3", label: "Raw (original language)" },
  { id: "non-eng", cat: "3_2", label: "Non-English-translated" },
  { id: "all", cat: "3_0", label: "All literature (manga + novels)" },
];

export function dumpCat(d: DumpType): string {
  return DUMP_TYPES.find((x) => x.id === d)?.cat ?? "3_1";
}

export interface NyaaItem {
  title: string;
  infoHash: string;
  magnet: string;
  seeders: number;
  leechers: number;
  downloads: number;
  size: string;
  category: string;
  date: string;
}

// aria2c can't speak the UDP tracker protocol, so we lean on nyaa's HTTP tracker
// plus DHT/PEX/LPD (enabled below) to find peers.
const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "http://anidex.moe:6969/announce",
  "http://tracker.openbittorrent.com:80/announce",
];

function magnetFor(infoHash: string, title: string): string {
  const tr = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}${tr}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function searchNyaa(query: string, dump: DumpType): Promise<NyaaItem[]> {
  const url = `https://nyaa.si/?page=rss&c=${dumpCat(dump)}&f=0&q=${encodeURIComponent(query)}`;
  const xml = await httpText(url, { timeoutMs: 15000 });
  const items: NyaaItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const get = (tag: string): string => {
      const mm = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return mm ? decodeEntities(mm[1]) : "";
    };
    const infoHash = get("nyaa:infoHash");
    if (!infoHash) continue;
    const title = get("title");
    items.push({
      title,
      infoHash,
      magnet: magnetFor(infoHash, title),
      seeders: Number(get("nyaa:seeders")) || 0,
      leechers: Number(get("nyaa:leechers")) || 0,
      downloads: Number(get("nyaa:downloads")) || 0,
      size: get("nyaa:size"),
      category: get("nyaa:category"),
      date: get("pubDate"),
    });
  }
  // Best-seeded first.
  items.sort((a, b) => b.seeders - a.seeders);
  return items;
}

/** Download a magnet with aria2c into `dir`. aria2c's live progress is inherited. */
export async function downloadMagnet(magnet: string, dir: string): Promise<boolean> {
  if (!Bun.which("aria2c")) throw new Error("aria2c not found — install it (brew install aria2)");
  await mkdir(dir, { recursive: true });
  const proc = Bun.spawn(
    [
      "aria2c",
      "--seed-time=0",
      "--bt-stop-timeout=600",
      "--summary-interval=1",
      "--console-log-level=warn",
      "--enable-dht=true",
      "--bt-enable-lpd=true",
      "--enable-peer-exchange=true",
      "--dir",
      dir,
      magnet,
    ],
    { stdout: "inherit", stderr: "inherit", stdin: "inherit" },
  );
  return (await proc.exited) === 0;
}
