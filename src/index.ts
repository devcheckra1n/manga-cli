#!/usr/bin/env bun
// manga-cli — a fast, lightweight terminal manga reader for atsu.moe.

import { ApiError } from "./api/client.ts";
import {
  searchAny,
  discoveryAny,
  filtersAny,
  getSource,
  primaryId,
  configureSources,
  allSources,
} from "./api/source.ts";
import type {
  MangaInfo,
  MangaRef,
  SearchResult,
  DiscoveryItem,
  Chapter,
  DiscoveryKind,
  SourceId,
} from "./api/types.ts";
import {
  loadConfig,
  ensureConfigFile,
  isDownloadFormat,
  isSourceId,
  type Config,
  type DownloadFormat,
} from "./utils/config.ts";
import { loadHistory, getHistoryEntry, mostRecent, type HistoryEntry } from "./utils/history.ts";
import {
  downloadChapter,
  selectChapters,
  existingChapterStems,
  chapterStem,
} from "./utils/download.ts";
import { loadFollows, addFollow, markSeen } from "./utils/follows.ts";
import { scanLibrary, toReaderSource, type LibrarySeries } from "./utils/library.ts";
import { computeStats } from "./utils/stats.ts";
import { searchNyaa, downloadMagnet, DUMP_TYPES, dumpCat, type DumpType } from "./utils/nyaa.ts";
import { checkVpn } from "./utils/vpn.ts";
import { join } from "node:path";
import { CONFIG_FILE, CACHE_DIR, HISTORY_FILE, expandTilde } from "./utils/paths.ts";
import { banner, shouldShowBanner } from "./ui/banner.ts";
import { c } from "./ui/colors.ts";
import { ensureDeps } from "./ui/deps.ts";
import { fzfPick, fzfPickMulti } from "./ui/menu.ts";
import { withSpinner, Spinner } from "./ui/progress.ts";
import { resolveProtocol, inTmux } from "./ui/protocol.ts";
import { runReader } from "./ui/reader.ts";

const VERSION = "0.8.0";

// ── CLI parsing ───────────────────────────────────────────────────────────────

type Command =
  | "interactive"
  | "search"
  | "continue"
  | "history"
  | "trending"
  | "popular"
  | "latest"
  | "genre"
  | "download"
  | "where"
  | "recommended"
  | "follow"
  | "updates"
  | "library"
  | "stats"
  | "sources"
  | "nyaa"
  | "help"
  | "version";

interface Args {
  command: Command;
  query?: string;
  genre?: string;
  browser: boolean;
  adult: boolean;
  noBanner: boolean;
  debug: boolean;
  dual?: boolean;
  direction?: "rtl" | "ltr";
  webtoon?: boolean;
  format?: DownloadFormat;
  chapters?: string;
  out?: string;
  source?: SourceId;
  dump?: DumpType;
  noVpnCheck?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "interactive",
    browser: false,
    adult: false,
    noBanner: false,
    debug: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        args.command = "help";
        break;
      case "-v":
      case "--version":
        args.command = "version";
        break;
      case "-c":
      case "--continue":
        args.command = "continue";
        break;
      case "-H":
      case "--history":
        args.command = "history";
        break;
      case "-t":
      case "--trending":
        args.command = "trending";
        break;
      case "-p":
      case "--popular":
        args.command = "popular";
        break;
      case "-l":
      case "--latest":
        args.command = "latest";
        break;
      case "-s":
      case "--search": {
        args.command = "search";
        const v = argv[++i];
        if (v) args.query = v;
        break;
      }
      case "-g":
      case "--genre": {
        args.command = "genre";
        const v = argv[++i];
        if (v) args.genre = v;
        break;
      }
      case "-d":
      case "--download": {
        args.command = "download";
        const v = argv[++i];
        if (v && !v.startsWith("-")) args.query = v;
        else if (v) i--; // it was a flag, not a query — put it back
        break;
      }
      case "-f":
      case "--format": {
        const v = argv[++i];
        if (v && isDownloadFormat(v)) args.format = v;
        else if (v) console.error(c.yellow(`unknown format “${v}” — using default`));
        break;
      }
      case "-S":
      case "--source": {
        const v = argv[++i];
        if (v && isSourceId(v)) args.source = v;
        else if (v) console.error(c.yellow(`unknown source “${v}” — using config default`));
        break;
      }
      case "--sources":
        args.command = "sources";
        break;
      case "--dump": {
        const v = argv[++i];
        if (v && DUMP_TYPES.some((d) => d.id === v)) args.dump = v as DumpType;
        else if (v) console.error(c.yellow(`unknown dump type “${v}” (eng · raw · non-eng · all)`));
        break;
      }
      case "--no-vpn-check":
        args.noVpnCheck = true;
        break;
      case "--chapters":
      case "--chapter": {
        const v = argv[++i];
        if (v) args.chapters = v;
        break;
      }
      case "--out":
      case "--output": {
        const v = argv[++i];
        if (v) args.out = v;
        break;
      }
      case "-r":
      case "--recommended":
      case "--recommend": {
        args.command = "recommended";
        const v = argv[++i];
        if (v && !v.startsWith("-")) args.query = v;
        else if (v) i--;
        break;
      }
      case "--follow": {
        args.command = "follow";
        const v = argv[++i];
        if (v && !v.startsWith("-")) args.query = v;
        else if (v) i--;
        break;
      }
      case "-u":
      case "--updates":
        args.command = "updates";
        break;
      case "--library":
      case "--offline":
        args.command = "library";
        break;
      case "--stats":
        args.command = "stats";
        break;
      case "--webtoon":
      case "--strip":
      case "--longstrip":
        args.webtoon = true;
        break;
      case "--browser":
        args.browser = true;
        break;
      case "--dual":
      case "--spread":
        args.dual = true;
        break;
      case "--single":
        args.dual = false;
        break;
      case "--rtl":
        args.direction = "rtl";
        break;
      case "--ltr":
        args.direction = "ltr";
        break;
      case "--adult":
        args.adult = true;
        break;
      case "--no-banner":
        args.noBanner = true;
        break;
      case "--debug":
        args.debug = true;
        break;
      default:
        if (a && !a.startsWith("-")) positional.push(a);
        break;
    }
  }

  if (positional.length > 0) {
    const joined = positional.join(" ");
    const first = positional[0]?.toLowerCase();
    const rest = positional.slice(1).join(" ");
    if (args.command === "genre") args.genre ??= joined;
    else if (args.command === "search") args.query ??= joined;
    else if (args.command === "download") args.query ??= joined;
    else if (args.command === "interactive" && (first === "help" || first === "h")) {
      args.command = "help";
    } else if (args.command === "interactive" && first === "version") {
      args.command = "version";
    } else if (args.command === "interactive" && (first === "where" || first === "paths")) {
      args.command = "where";
    } else if (args.command === "interactive" && (first === "download" || first === "dl")) {
      args.command = "download";
      if (rest) args.query = rest;
    } else if (args.command === "interactive" && (first === "library" || first === "offline")) {
      args.command = "library";
    } else if (args.command === "interactive" && first === "stats") {
      args.command = "stats";
    } else if (args.command === "interactive" && (first === "sources" || first === "source")) {
      args.command = "sources";
    } else if (args.command === "interactive" && (first === "nyaa" || first === "torrent" || first === "magnet")) {
      args.command = "nyaa";
      if (rest) args.query = rest;
    } else if (args.command === "interactive" && (first === "updates" || first === "u")) {
      args.command = "updates";
    } else if (args.command === "interactive" && (first === "recommended" || first === "recs")) {
      args.command = "recommended";
      if (rest) args.query = rest;
    } else if (args.command === "interactive" && first === "follow") {
      args.command = "follow";
      if (rest) args.query = rest;
    } else if (args.command === "interactive") {
      args.command = "search";
      args.query = joined;
    }
  }
  return args;
}

// ── help / version ────────────────────────────────────────────────────────────

function printHelp(): void {
  const b = (s: string) => c.bold(s);
  const k = (s: string) => c.cyan(s);
  console.log(`${banner()}
${b("USAGE")}
  manga-cli [flags] [query]
  manga-cli help | <command>

${b("COMMANDS / FLAGS")}
  ${k("-s, --search")} <query>   search and pick a manga
  ${k("-c, --continue")}         resume your last-read manga
  ${k("-H, --history")}          browse reading history
  ${k("-t, --trending")}         show trending manga
  ${k("-p, --popular")}          show popular manga
  ${k("-l, --latest")}           show latest updates
  ${k("-g, --genre")} <genre>    browse by genre
  ${k("-r, --recommended")} [q]   "more like this" — recommendations for a title
  ${k("    --follow")} [query]    follow a series for new-chapter updates
  ${k("-u, --updates")}          show followed series with new chapters
  ${k("    --library")}          browse & read your downloads offline
  ${k("    --stats")}            your reading stats / wrapped
  ${k("-d, --download")} <query>  download chapters (CBZ/ZIP/PDF/images)
  ${k("-f, --format")} <fmt>      download format: cbz · zip · pdf · images
  ${k("    --chapters")} <spec>   pick chapters non-interactively: 1-10 · 1,3,5 · all · latest
  ${k("    --out")} <dir>         download into <dir> (overrides config)
  ${k("-S, --source")} <id>       force: atsumaru · weebcentral · mangadex
  ${k("    sources")}            list sources & the fallback chain
  ${k("    nyaa")} [query]        download manga torrents via nyaa.si + aria2c
  ${k("    --dump")} <type>       nyaa dump: eng · raw · non-eng · all
  ${k("    --no-vpn-check")}      skip the pre-torrent VPN check
  ${k("    where")}              print config / cache / download paths
  ${k("    --dual")}             open in two-page (spread) mode
  ${k("    --webtoon")}          long-strip scroll mode (auto for manhwa)
  ${k("    --single")}           force single-page mode
  ${k("    --rtl / --ltr")}      reading direction (manga is rtl, the default)
  ${k("    --browser")}          open in your web browser instead of the terminal
  ${k("    --adult")}            include 18+ results for this run
  ${k("    --no-banner")}        skip the ASCII banner
  ${k("    --debug")}            log API requests to stderr
  ${k("-v, --version")}          print version
  ${k("-h, --help, help")}       print this help

${b("READER KEYS")}
  ${k("→ ←")}            turn page (direction-aware: in rtl, ← advances)
  ${k("n / p")}          next / previous page
  ${k("] / [")}          next / previous chapter
  ${k("g / G")}          first / last page
  ${k(": (or #)")}       go to page — type a number, then Enter
  ${k("↑ / ↓")}          scroll (in long-strip mode)
  ${k("w")}              toggle long-strip (webtoon) scroll
  ${k("d")}              toggle dual-page spread
  ${k("m")}              toggle reading direction (rtl ⇄ ltr)
  ${k("f")}              toggle fit (whole page ⇄ fill width)
  ${k("b")}              follow / unfollow this series
  ${k("+ / - / 0")}      zoom in / out / reset
  ${k("s")}              save current page to your downloads
  ${k("r")}              re-render (after a terminal resize)
  ${k("j")}              back to the chapter list
  ${k("? ")}             in-reader help · ${k("q / esc")} quit

${b("EXAMPLES")}
  manga-cli berserk                       ${c.dim("# search & read")}
  manga-cli -t                            ${c.dim("# trending")}
  manga-cli --dual one piece              ${c.dim("# two-page spreads")}
  manga-cli -d berserk --chapters 1-10 -f pdf   ${c.dim("# download ch.1–10 as PDF")}
  manga-cli -r                            ${c.dim("# recommendations from your last read")}
  manga-cli --follow "one piece"          ${c.dim("# follow for new-chapter updates")}
  manga-cli -u                            ${c.dim("# what got new chapters")}
  manga-cli --library                     ${c.dim("# read your downloads offline")}
  manga-cli --stats                       ${c.dim("# your reading wrapped")}

${b("SOURCES")}  ${c.dim("atsu.moe primary, with fallback")}
  ${k("atsumaru")}     atsu.moe          ${c.dim("primary (richest metadata)")}
  ${k("weebcentral")}  weebcentral.com   ${c.dim("huge current scanlation library")}
  ${k("mangadex")}     mangadex.org      ${c.dim("open API (some titles delicensed)")}
  ${k("mangadot")}     mangadot.net      ${c.dim("not yet mapped")}
  ${c.dim("If the primary is down/empty, the next source answers automatically.")}
  ${c.dim("Pick a main source with -S/--source, or `source`/`fallback` in config.")}

${b("SETTINGS")}  ${c.dim("~/.config/manga-cli/config.json")}
  ${k("source")}       atsumaru · weebcentral · mangadex  ${c.dim("(primary source)")}
  ${k("fallback")}     [\"weebcentral\", …]                 ${c.dim("(ordered backups)")}
  ${k("readerMode")}   auto · kitty · iterm2 · chafa     ${c.dim("(image protocol)")}
  ${k("direction")}    rtl · ltr                          ${c.dim("(manga is rtl)")}
  ${k("dualPage")}     true · false                       ${c.dim("(two-page spreads)")}
  ${k("fit")}          page · width                       ${c.dim("(single-page fit)")}
  ${k("zoom")}         0.4 – 1.0                          ${c.dim("(render scale)")}
  ${k("downloadFormat")} cbz · zip · pdf · images        ${c.dim("(default download format)")}
  ${k("prefetchPages")} number of pages to prefetch
  ${k("downloadDir")}  where downloads & saved pages go

${b("DEPENDENCIES")}  ${c.dim("fzf + chafa")}
  macOS    ${c.dim("brew install fzf chafa")}
  Debian   ${c.dim("sudo apt install fzf chafa")}
  Fedora   ${c.dim("sudo dnf install fzf chafa")}
  Arch     ${c.dim("sudo pacman -S fzf chafa")}

${b("INSTALL")}  ${c.dim("compile a standalone `manga-cli` command")}
  ${c.dim("bun run install:bin")}   ${c.dim("# -> ~/.bun/bin/manga-cli")}`);
}

function printVersion(): void {
  console.log(`manga-cli ${VERSION}`);
}

// ── label formatting ──────────────────────────────────────────────────────────

function metaLine(parts: Array<string | number | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== "").join(c.dim(" · "));
}

function searchLabel(r: SearchResult): string {
  const rating = r.rating ? c.yellow(`★${r.rating.toFixed(1)}`) : undefined;
  const meta = metaLine([r.type, r.status, r.year, r.popularity ? `${r.popularity}` : undefined]);
  const adult = r.isAdult ? c.pink(" 18+") : "";
  return `${c.bold(r.title)}${adult}   ${c.dim(meta)}${rating ? "   " + rating : ""}`;
}

function discoveryLabel(it: DiscoveryItem): string {
  const rating = it.rating ? c.yellow(`★${it.rating.toFixed(1)}`) : undefined;
  const meta = metaLine([it.type, it.views ? `${it.views} views` : undefined]);
  const adult = it.isAdult ? c.pink(" 18+") : "";
  return `${c.bold(it.title)}${adult}   ${c.dim(meta)}${rating ? "   " + rating : ""}`;
}

function chapterLabel(ch: Chapter): string {
  const title =
    ch.title && ch.title !== `Chapter ${ch.number}` ? c.gray(` · ${ch.title}`) : "";
  const date = ch.createdAt ? c.dim("  " + new Date(ch.createdAt).toLocaleDateString()) : "";
  // Page counts aren't known for every source (weebcentral/local) — hide "0p".
  const pages = ch.pageCount > 0 ? `   ${c.dim(`${ch.pageCount}p`)}` : "";
  return `${c.bold(c.cyan(`Ch.${ch.number}`))}${title}${pages}${date}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function historyLabel(h: HistoryEntry): string {
  const progress = c.dim(`Ch.${h.lastChapterNumber} · p.${h.lastPage + 1}/${h.totalChapters}ch`);
  return `${c.bold(h.title)}   ${progress}   ${c.gray(relativeTime(h.lastReadAt))}`;
}

const DISCOVERY_TITLES: Record<DiscoveryKind, string> = {
  trending: "trending",
  popular: "popular",
  recentlyAdded: "recently added",
  recentlyUpdated: "latest updates",
  topRated: "top rated",
  mostBookmarked: "most bookmarked",
};

// ── browser / tmux helpers ────────────────────────────────────────────────────

function openInBrowser(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
    console.log(c.dim(`opening ${url} …`));
  } catch {
    console.log(`open this URL: ${c.cyan(url)}`);
  }
}

function warnTmux(protocol: string): void {
  if (!inTmux() || protocol === "chafa") return;
  const ghostty =
    process.env.TERM === "xterm-ghostty" || process.env.TERM_PROGRAM === "ghostty";
  if (!ghostty) {
    console.error(
      c.yellow(
        '⚠  tmux detected — inline images may glitch outside Ghostty. Set readerMode:"chafa" if pages look broken.',
      ),
    );
  }
}

// ── one-shot line prompt (cooked stdin) ───────────────────────────────────────

function prompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.resume();
    const onData = (buf: Buffer): void => {
      stdin.off("data", onData);
      stdin.pause();
      resolve(buf.toString("utf8").replace(/[\r\n]+$/, ""));
    };
    stdin.on("data", onData);
  });
}

// ── flows ─────────────────────────────────────────────────────────────────────

interface Resume {
  chapterIndex: number;
  page: number;
}

function chapterWebUrl(source: SourceId, mangaId: string, chapterId: string): string {
  if (source === "mangadex") return `https://mangadex.org/chapter/${chapterId}`;
  if (source === "weebcentral") return `https://weebcentral.com/chapters/${chapterId}`;
  if (source === "mangadot") return `https://mangadot.net/read/${chapterId}`;
  return `https://atsu.moe/read/${mangaId}/${chapterId}`;
}

async function openManga(
  ref: MangaRef,
  cfg: Config,
  args: Args,
  resume?: Resume,
): Promise<void> {
  const source = getSource(ref.source);
  const info: MangaInfo = await withSpinner(`loading ${ref.title} …`, () => source.info(ref.id));
  if (info.chapters.length === 0) {
    const alt = allSources().find((s) => s.available && s.id !== source.id)?.id;
    console.log(
      c.yellow(`No readable chapters for “${ref.title}” via ${source.id}.`) +
        (alt ? c.dim(`  Try another source: -S ${alt}`) : ""),
    );
    return;
  }
  const title = info.title || ref.title;
  const fullRef: MangaRef = { ...ref, title, source: source.id };
  const loadChapter = (idx: number): Promise<import("./api/types.ts").ReadChapter> =>
    source.pages(ref.id, info.chapters[idx].id);

  const protocol = resolveProtocol(cfg.readerMode);
  if (!args.browser) warnTmux(protocol);

  let startCh = resume?.chapterIndex ?? null;
  let startPage = resume?.page ?? 0;

  while (true) {
    let chapterIndex: number;
    if (startCh !== null) {
      chapterIndex = Math.min(Math.max(0, startCh), info.chapters.length - 1);
      startCh = null;
    } else {
      const picked = await pickChapter(info);
      if (picked === null) return;
      chapterIndex = picked;
    }

    if (args.browser) {
      const ch = info.chapters[chapterIndex];
      if (ch) openInBrowser(chapterWebUrl(source.id, ref.id, ch.id));
      return;
    }

    const result = await runReader({
      manga: fullRef,
      info,
      startChapterIndex: chapterIndex,
      startPage,
      protocol,
      prefetch: cfg.prefetchPages,
      downloadDir: cfg.downloadDir,
      direction: cfg.direction,
      dualPage: cfg.dualPage,
      fit: cfg.fit,
      zoom: cfg.zoom,
      hudReserve: cfg.hudReserve,
      webtoon: args.webtoon || info.forceStrip,
      loadChapter,
    });
    startPage = 0;
    if (result.action === "quit") return;
    // "jump" → loop back to the chapter picker
  }
}

async function pickChapter(info: MangaInfo): Promise<number | null> {
  // Present newest chapter first, but keep the real ascending index.
  const items = info.chapters
    .map((ch, idx) => ({ label: chapterLabel(ch), idx }))
    .reverse();
  const picked = await fzfPick(items, {
    prompt: "chapter ❯ ",
    header: `${info.title} — ${info.chapters.length} chapters`,
  });
  return picked ? picked.idx : null;
}

function sourceTag(source: SourceId): string {
  return source === primaryId() ? "" : c.dim(`  · via ${source}`);
}

function refOf(r: SearchResult | DiscoveryItem): MangaRef {
  return { id: r.id, title: r.title, poster: r.poster, source: r.source };
}

async function searchFlow(query: string, cfg: Config, args: Args): Promise<void> {
  if (!query.trim()) return interactiveSearch(cfg, args);
  const { items: results, source } = await withSpinner(`searching “${query}” …`, () =>
    searchAny(query, { adult: cfg.adult }),
  );
  if (results.length === 0) {
    console.log(c.yellow(`No results for “${query}”.`));
    return;
  }
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: r }));
  const picked = await fzfPick(items, {
    prompt: "manga ❯ ",
    header: `${results.length} results for “${query}”${sourceTag(source)}`,
    preview: true,
  });
  if (!picked) return;
  await openManga(refOf(picked.ref), cfg, args);
}

async function interactiveSearch(cfg: Config, args: Args): Promise<void> {
  const q = await prompt(c.violet("search manga ❯ "));
  if (!q.trim()) return;
  await searchFlow(q, cfg, args);
}

async function continueFlow(cfg: Config, args: Args): Promise<void> {
  const recent = await mostRecent();
  if (!recent) {
    console.log(c.yellow("No reading history yet — search for something first."));
    return;
  }
  console.log(
    c.dim(`resuming `) +
      c.bold(recent.title) +
      c.dim(` — Ch.${recent.lastChapterNumber} · p.${recent.lastPage + 1}`),
  );
  await openManga(
    { id: recent.id, title: recent.title, poster: recent.coverUrl, source: recent.source },
    cfg,
    args,
    { chapterIndex: recent.lastChapterIndex, page: recent.lastPage },
  );
}

async function historyFlow(cfg: Config, args: Args): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.log(c.yellow("No reading history yet."));
    return;
  }
  const items = history.map((h) => ({
    label: historyLabel(h),
    previewUrl: h.coverUrl,
    entry: h,
  }));
  const picked = await fzfPick(items, {
    prompt: "history ❯ ",
    header: `${history.length} titles`,
    preview: true,
  });
  if (!picked) return;
  const h = picked.entry;
  await openManga({ id: h.id, title: h.title, poster: h.coverUrl, source: h.source }, cfg, args, {
    chapterIndex: h.lastChapterIndex,
    page: h.lastPage,
  });
}

async function discoveryFlow(kind: DiscoveryKind, cfg: Config, args: Args): Promise<void> {
  const name = DISCOVERY_TITLES[kind];
  const { items, source } = await withSpinner(`loading ${name} …`, () =>
    discoveryAny(kind, 0, cfg.adult),
  );
  if (items.length === 0) {
    console.log(c.yellow(`Nothing in ${name} right now.`));
    return;
  }
  const picks = items.map((it) => ({ label: discoveryLabel(it), previewUrl: it.poster, ref: it }));
  const picked = await fzfPick(picks, {
    prompt: `${name} ❯ `,
    header: `${name} · ${items.length} titles${sourceTag(source)}`,
    preview: true,
  });
  if (!picked) return;
  await openManga(refOf(picked.ref), cfg, args);
}

async function genreFlow(genreName: string, cfg: Config, args: Args): Promise<void> {
  const { filters, source } = await withSpinner("loading genres …", () => filtersAny());
  let genre = filters.genres.find((g) => g.name.toLowerCase() === genreName.trim().toLowerCase());
  if (!genre) {
    if (genreName.trim()) console.log(c.yellow(`Unknown genre “${genreName}”. Pick one:`));
    const picked = await fzfPick(
      filters.genres.map((g) => ({ label: c.bold(g.name), g })),
      { prompt: "genre ❯ ", header: `pick a genre${sourceTag(source)}` },
    );
    if (!picked) return;
    genre = picked.g;
  }
  const results = await withSpinner(`loading ${genre.name} …`, () =>
    getSource(source).browseGenre(genre!.id, cfg.adult),
  );
  if (results.length === 0) {
    console.log(c.yellow(`No manga found in ${genre.name}.`));
    return;
  }
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: { ...r, source } }));
  const picked = await fzfPick(items, {
    prompt: `${genre.name} ❯ `,
    header: `${genre.name} · ${results.length} titles${sourceTag(source)}`,
    preview: true,
  });
  if (!picked) return;
  await openManga(refOf(picked.ref), cfg, args);
}

// ── download ──────────────────────────────────────────────────────────────────

async function resolveManga(query: string, cfg: Config): Promise<MangaRef | null> {
  const { items: results, source } = await withSpinner(`searching “${query}” …`, () =>
    searchAny(query, { adult: cfg.adult }),
  );
  if (results.length === 0) {
    console.log(c.yellow(`No results for “${query}”.`));
    return null;
  }
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: r }));
  const picked = await fzfPick(items, {
    prompt: "manga ❯ ",
    header: `${results.length} results${sourceTag(source)} — pick a title`,
    preview: true,
  });
  if (!picked) return null;
  return refOf(picked.ref);
}

async function pickChaptersMulti(
  ref: MangaRef,
  info: MangaInfo,
  cfg: Config,
): Promise<Chapter[]> {
  const done = await existingChapterStems(ref, cfg.downloadDir);
  const items = info.chapters
    .map((ch) => {
      const mark = done.has(chapterStem(ref, ch)) ? c.green("✓ ") : "  ";
      return { label: mark + chapterLabel(ch), ch };
    })
    .reverse(); // newest first
  const picked = await fzfPickMulti(items, {
    prompt: "chapters ❯ ",
    header: `${info.title} — Tab to select multiple · Enter to download`,
  });
  return picked.map((p) => p.ch).sort((a, b) => a.index - b.index);
}

async function downloadFlow(query: string, cfg: Config, args: Args): Promise<void> {
  let q = query.trim();
  if (!q) {
    q = (await prompt(c.violet("download manga ❯ "))).trim();
    if (!q) return;
  }
  const ref = await resolveManga(q, cfg);
  if (!ref) return;

  const source = getSource(ref.source);
  const info = await withSpinner(`loading ${ref.title} …`, () => source.info(ref.id));
  if (info.chapters.length === 0) {
    console.log(c.yellow("No downloadable chapters for this title."));
    return;
  }
  ref.title = info.title || ref.title;

  let chapters: Chapter[];
  if (args.chapters) {
    chapters = selectChapters(args.chapters, info.chapters);
    if (chapters.length === 0) {
      console.log(c.yellow(`No chapters match “${args.chapters}”.`));
      return;
    }
  } else {
    chapters = await pickChaptersMulti(ref, info, cfg);
    if (chapters.length === 0) return;
  }

  const format = args.format ?? cfg.downloadFormat;
  const dir = args.out ? expandTilde(args.out) : cfg.downloadDir;
  console.log(
    c.dim(`↓ ${chapters.length} chapter(s) · ${c.bold(format)} · → ${dir}`),
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const ch of chapters) {
    const label = `Ch.${ch.number}`;
    const sp = new Spinner(`${label} …`).start();
    try {
      const res = await downloadChapter(ref, ch, {
        format,
        downloadDir: dir,
        loadPages: (cid) => source.pages(ref.id, cid),
        onProgress: (d, t) => sp.update(`${label}  ${c.dim(`${d}/${t}p`)}`),
      });
      if (res.skipped) {
        sp.stop(c.dim(`• ${label} already downloaded`));
        skipped++;
      } else {
        const warn = res.failed > 0 ? c.yellow(` (${res.failed} pages missing)`) : "";
        sp.stop(c.green(`✓ ${label}`) + c.dim(`  ${res.pages}p → ${res.output}`) + warn);
        ok++;
      }
    } catch (err) {
      sp.stop(c.red(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`));
      failed++;
    }
  }
  console.log(
    "\n" + c.bold(`Done`) + c.dim(` — ${ok} downloaded · ${skipped} skipped · ${failed} failed`),
  );
}

function printWhere(cfg: Config): void {
  const row = (k: string, v: string): string => `  ${c.cyan(k.padEnd(11))}${v}`;
  console.log(
    [
      c.bold("manga-cli paths"),
      row("config", CONFIG_FILE),
      row("history", HISTORY_FILE),
      row("cache", CACHE_DIR),
      row("downloads", cfg.downloadDir),
      row("source", `${cfg.source}${cfg.fallback.length ? c.dim(` → ${cfg.fallback.join(" → ")}`) : ""}`),
    ].join("\n"),
  );
}

function printSources(cfg: Config): void {
  const lines = [c.bold("sources"), c.dim("───────")];
  for (const s of allSources()) {
    const active = s.id === cfg.source;
    const mark = active ? c.green("● ") : s.available ? c.cyan("○ ") : c.red("✗ ");
    const note = !s.available ? c.red("  unavailable") : active ? c.green("  primary") : "";
    lines.push(`  ${mark}${c.bold(s.id.padEnd(12))} ${c.dim(s.label)}${note}`);
  }
  const chainStr = [cfg.source, ...cfg.fallback.filter((f) => f !== cfg.source)].join(" → ");
  lines.push("", c.dim(`  fallback chain: ${chainStr}`));
  lines.push(c.dim(`  set with --source <id>, or "source"/"fallback" in config.json`));
  console.log(lines.join("\n"));
}

// ── recommendations (more like this) ──────────────────────────────────────────

async function recommendedFlow(query: string, cfg: Config, args: Args): Promise<void> {
  let seed: MangaRef | null = null;
  if (query.trim()) {
    seed = await resolveManga(query.trim(), cfg);
  } else {
    const recent = await mostRecent();
    if (recent) seed = { id: recent.id, title: recent.title, poster: recent.coverUrl, source: recent.source };
    else {
      const q = (await prompt(c.violet("recommend based on ❯ "))).trim();
      if (!q) return;
      seed = await resolveManga(q, cfg);
    }
  }
  if (!seed) return;

  const source = getSource(seed.source);
  const items = await withSpinner(`finding titles like ${seed.title} …`, () =>
    source.related(seed!.id, 0, cfg.adult),
  );
  if (items.length === 0) {
    console.log(
      c.yellow(`No recommendations for ${seed.title}`) +
        (source.id === "mangadex" ? c.dim(" (MangaDex has no similar-titles API)") : ""),
    );
    return;
  }
  const picks = items.map((it) => ({ label: discoveryLabel(it), previewUrl: it.poster, ref: it }));
  const picked = await fzfPick(picks, {
    prompt: "recommended ❯ ",
    header: `like ${seed.title} · ${items.length} titles`,
    preview: true,
  });
  if (!picked) return;
  await openManga(refOf(picked.ref), cfg, args);
}

// ── follows + updates ──────────────────────────────────────────────────────────

async function followFlow(query: string, cfg: Config): Promise<void> {
  let q = query.trim();
  if (!q) {
    q = (await prompt(c.violet("follow manga ❯ "))).trim();
    if (!q) return;
  }
  const ref = await resolveManga(q, cfg);
  if (!ref) return;
  const info = await withSpinner(`loading ${ref.title} …`, () => getSource(ref.source).info(ref.id));
  const title = info.title || ref.title;
  await addFollow({
    id: ref.id,
    title,
    source: ref.source,
    coverUrl: ref.poster,
    chapterCount: info.chapters.length,
    followedAt: new Date().toISOString(),
  });
  console.log(
    c.pink("♥ following ") +
      c.bold(title) +
      c.dim(`  (${info.chapters.length} chapters) — see new releases with -u`),
  );
}

async function updatesFlow(cfg: Config, args: Args): Promise<void> {
  const follows = await loadFollows();
  if (follows.length === 0) {
    console.log(c.yellow("Not following anything yet — add a series with --follow."));
    return;
  }
  const checked = await withSpinner(`checking ${follows.length} followed title(s) …`, () =>
    Promise.all(
      follows.map(async (f) => {
        try {
          const info = await getSource(f.source).info(f.id);
          return { f, count: info.chapters.length };
        } catch {
          return { f, count: f.chapterCount };
        }
      }),
    ),
  );
  const rows = checked
    .map(({ f, count }) => ({ f, count, delta: count - f.chapterCount }))
    .sort((a, b) => b.delta - a.delta || a.f.title.localeCompare(b.f.title));

  const items = rows.map((row) => {
    const badge = row.delta > 0 ? c.green(`+${row.delta} new`) : c.dim("up to date");
    return {
      label: `${c.bold(row.f.title)}   ${badge}${c.dim(`   ${row.count} ch`)}`,
      previewUrl: row.f.coverUrl,
      row,
    };
  });
  const fresh = rows.filter((r) => r.delta > 0).length;
  const picked = await fzfPick(items, {
    prompt: "updates ❯ ",
    header: `${fresh} with new chapters · ${rows.length} followed`,
    preview: true,
  });
  if (!picked) return;
  const { f, count, delta } = picked.row;
  const resume = delta > 0 ? { chapterIndex: Math.min(f.chapterCount, count - 1), page: 0 } : undefined;
  await openManga({ id: f.id, title: f.title, poster: f.coverUrl, source: f.source }, cfg, args, resume);
  await markSeen(f.id, count);
}

// ── offline library ────────────────────────────────────────────────────────────

async function libraryFlow(cfg: Config, args: Args): Promise<void> {
  const series = await scanLibrary(cfg.downloadDir);
  if (series.length === 0) {
    console.log(c.yellow(`No downloads in ${cfg.downloadDir} yet — grab some with -d.`));
    return;
  }
  const items = series.map((s) => ({
    label: `${c.bold(s.title)}${c.dim(`   ${s.chapters.length} chapter(s)`)}`,
    s,
  }));
  const picked = await fzfPick(items, {
    prompt: "library ❯ ",
    header: `${series.length} downloaded series · offline`,
  });
  if (!picked) return;
  await readLocal(picked.s, cfg, args);
}

async function readLocal(series: LibrarySeries, cfg: Config, args: Args): Promise<void> {
  const { info, loadChapter } = toReaderSource(series);
  const protocol = resolveProtocol(cfg.readerMode);
  warnTmux(protocol);
  while (true) {
    const picked = await pickChapter(info);
    if (picked === null) return;
    const result = await runReader({
      manga: { id: info.id, title: info.title },
      info,
      startChapterIndex: picked,
      startPage: 0,
      protocol,
      prefetch: cfg.prefetchPages,
      downloadDir: cfg.downloadDir,
      direction: cfg.direction,
      dualPage: cfg.dualPage,
      fit: cfg.fit,
      zoom: cfg.zoom,
      hudReserve: cfg.hudReserve,
      webtoon: args.webtoon ?? false,
      noFollow: true,
      loadChapter,
    });
    if (result.action === "quit") return;
  }
}

// ── reading stats ──────────────────────────────────────────────────────────────

function bar(value: number, max: number, width: number, color: (s: string) => string): string {
  const n = max > 0 ? Math.round((value / max) * width) : 0;
  return color("█".repeat(n)) + c.dim("░".repeat(Math.max(0, width - n)));
}

async function statsFlow(): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.log(c.yellow("No reading history yet — read something first."));
    return;
  }
  const s = computeStats(history);
  const out: string[] = [c.bold("reading stats"), c.dim("─────────────")];
  out.push(
    `  ${c.cyan(String(s.titles))} titles · ${c.cyan(String(s.chaptersProgressed))} chapters in · ${c.green(String(s.finished))} finished · ${c.dim(`${s.inProgress} ongoing`)}`,
  );
  out.push(
    `  active ${c.cyan(String(s.activeDays))} days · 🔥 ${c.bold(String(s.currentStreak))}-day streak ${c.dim(`(longest ${s.longestStreak})`)}`,
  );
  if (s.since) out.push(c.dim(`  since ${new Date(s.since).toLocaleDateString()}`));

  if (s.topTitles.length > 0) {
    out.push("", "  most read");
    const maxCh = Math.max(1, ...s.topTitles.map((t) => t.chapters));
    for (const t of s.topTitles) {
      const name = (t.title.length > 22 ? t.title.slice(0, 21) + "…" : t.title).padEnd(22);
      out.push(`   ${c.bold(name)} ${bar(t.chapters, maxCh, 14, c.violet)} ${c.dim(`${t.chapters}/${t.total}`)}`);
    }
  }

  out.push("", "  by weekday");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const maxW = Math.max(1, ...s.weekday);
  for (let i = 0; i < 7; i++) {
    out.push(`   ${days[i]} ${bar(s.weekday[i], maxW, 16, c.cyan)} ${c.dim(String(s.weekday[i]))}`);
  }
  console.log(out.join("\n"));
}

// ── nyaa magnet downloads ──────────────────────────────────────────────────────

async function confirm(label: string): Promise<boolean> {
  const a = (await prompt(label)).trim().toLowerCase();
  return a === "y" || a === "yes";
}

/** Gate torrenting behind a VPN check. Returns true if it's OK to proceed. */
async function ensureVpn(args: Args): Promise<boolean> {
  if (args.noVpnCheck) return true;
  const v = await withSpinner("checking your VPN …", () => checkVpn());
  if (!v) {
    return confirm(c.yellow("⚠  Couldn't verify your IP. Continue without a VPN check? [y/N] "));
  }
  if (v.likelyVpn) {
    console.log(c.green("✓ VPN looks ON") + c.dim(`  — ${v.ip} · ${v.org || v.isp} · ${v.country}`));
    return true;
  }
  console.log(c.red("⚠  VPN appears to be OFF") + c.dim(`  — ${v.ip} · ${v.isp} · ${v.country} (residential ISP)`));
  console.log(c.yellow("   Torrenting without a VPN exposes your real IP to peers. Turn your VPN on first."));
  return confirm(c.bold("   Download anyway? [y/N] "));
}

async function nyaaFlow(query: string, cfg: Config, args: Args): Promise<void> {
  let q = query.trim();
  if (!q) {
    q = (await prompt(c.violet("nyaa search ❯ "))).trim();
    if (!q) return;
  }

  let dump = args.dump;
  if (!dump) {
    const picked = await fzfPick(
      DUMP_TYPES.map((d) => ({ label: `${c.bold(d.label)}   ${c.dim("nyaa c=" + d.cat)}`, d })),
      { prompt: "dump type ❯ ", header: "which manga dump? (Literature only — never anime)" },
    );
    if (!picked) return;
    dump = picked.d.id;
  }

  const items = await withSpinner(`searching nyaa “${q}” …`, () => searchNyaa(q, dump!));
  if (items.length === 0) {
    console.log(c.yellow(`No ${dump} torrents for “${q}”.`));
    return;
  }
  const picks = items.map((it) => ({
    label:
      `${c.green(`▲${it.seeders}`)} ${c.gray(`▼${it.leechers}`)}  ${c.cyan(it.size.padStart(9))}  ` +
      `${c.bold(it.title)}   ${c.dim(it.category.replace("Literature - ", ""))}`,
    it,
  }));
  const chosen = await fzfPickMulti(picks, {
    prompt: "torrent ❯ ",
    header: `${items.length} results · Tab to multi-select · ⚠ magnet download`,
  });
  if (chosen.length === 0) return;

  console.log(c.dim(`\n⚠  About to magnet-download ${chosen.length} torrent(s) with aria2c.`));
  if (!(await ensureVpn(args))) {
    console.log(c.dim("aborted."));
    return;
  }

  const dir = args.out ? expandTilde(args.out) : join(cfg.downloadDir, "nyaa");
  let ok = 0;
  for (const { it } of chosen) {
    console.log("\n" + c.bold(`↓ ${it.title}`) + c.dim(`  (${it.size}, ▲${it.seeders})`));
    try {
      if (await downloadMagnet(it.magnet, dir)) {
        ok++;
        console.log(c.green(`✓ done → ${dir}`));
      } else {
        console.log(c.red("✗ aria2c exited with an error"));
      }
    } catch (err) {
      console.log(c.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  console.log("\n" + c.bold(`Done`) + c.dim(` — ${ok}/${chosen.length} downloaded to ${dir}`));
}

// ── entrypoint ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") return printHelp();
  if (args.command === "version") return printVersion();
  if (args.debug) process.env.MANGA_CLI_DEBUG = "1";

  const cfg = await loadConfig();
  await ensureConfigFile();
  if (args.adult) cfg.adult = true;
  if (args.dual !== undefined) cfg.dualPage = args.dual;
  if (args.direction) cfg.direction = args.direction;
  if (args.source) cfg.source = args.source;

  // Configure the source chain: chosen primary, then the rest as fallbacks.
  const fallback = cfg.fallback.filter((s) => s !== cfg.source);
  configureSources(cfg.source, fallback);
  const primarySrc = getSource(cfg.source);
  if (!primarySrc.available) {
    console.error(
      c.yellow(`⚠  ${primarySrc.label} is blocked — falling back to ${fallback.join(" → ") || "nothing"}.`),
    );
  }

  if (args.command === "where") return printWhere(cfg);
  if (args.command === "stats") return statsFlow();
  if (args.command === "sources") return printSources(cfg);

  await ensureDeps(["fzf", "chafa"]);

  if (!args.noBanner && shouldShowBanner(cfg.showBanner)) {
    process.stdout.write(banner() + "\n");
  }

  switch (args.command) {
    case "interactive":
      return interactiveSearch(cfg, args);
    case "search":
      return searchFlow(args.query ?? "", cfg, args);
    case "continue":
      return continueFlow(cfg, args);
    case "history":
      return historyFlow(cfg, args);
    case "trending":
      return discoveryFlow("trending", cfg, args);
    case "popular":
      return discoveryFlow("popular", cfg, args);
    case "latest":
      return discoveryFlow("recentlyUpdated", cfg, args);
    case "genre":
      return genreFlow(args.genre ?? "", cfg, args);
    case "download":
      return downloadFlow(args.query ?? "", cfg, args);
    case "recommended":
      return recommendedFlow(args.query ?? "", cfg, args);
    case "follow":
      return followFlow(args.query ?? "", cfg);
    case "updates":
      return updatesFlow(cfg, args);
    case "library":
      return libraryFlow(cfg, args);
    case "nyaa":
      return nyaaFlow(args.query ?? "", cfg, args);
  }
}

function restoreTerminal(): void {
  try {
    if (process.stdout.isTTY) process.stdout.write("\x1b[?25h\x1b[?1049l"); // show cursor, leave alt screen
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // ignore
  }
}

process.on("SIGINT", () => {
  restoreTerminal();
  process.exit(130);
});
process.on("exit", restoreTerminal);

main().catch((err: unknown) => {
  restoreTerminal();
  const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
  console.error("\n" + c.red("✗ " + msg));
  process.exit(1);
});
