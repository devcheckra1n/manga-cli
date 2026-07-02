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
  Genre,
  BrowseSort,
} from "./api/types.ts";
import {
  loadConfig,
  ensureConfigFile,
  saveConfig,
  isDownloadFormat,
  isSourceId,
  SOURCE_IDS,
  type Config,
  type DownloadFormat,
} from "./utils/config.ts";
import { downSources, clearHealth } from "./utils/health.ts";
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
import {
  malBeginLogin,
  malCompleteFromInput,
  malLoggedIn,
  malLogout,
  malWhoAmI,
  malUpdateProgress,
  MAL_REDIRECT_URI,
} from "./utils/mal.ts";
import { join } from "node:path";
import { CONFIG_FILE, CACHE_DIR, HISTORY_FILE, expandTilde } from "./utils/paths.ts";
import { banner, shouldShowBanner } from "./ui/banner.ts";
import { c } from "./ui/colors.ts";
import { ensureDeps } from "./ui/deps.ts";
import { fzfPick, fzfPickMulti } from "./ui/menu.ts";
import { withSpinner, Spinner } from "./ui/progress.ts";
import { resolveProtocol, inTmux } from "./ui/protocol.ts";
import { runReader } from "./ui/reader.ts";
import { runGame } from "./ui/game.ts";
import { restoreTerminal } from "./ui/term.ts";

const VERSION = "1.0.0";

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
  | "browse"
  | "random"
  | "download"
  | "where"
  | "recommended"
  | "follow"
  | "updates"
  | "library"
  | "stats"
  | "sources"
  | "nyaa"
  | "sync"
  | "mal"
  | "config"
  | "game"
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
      case "-R":
      case "--random":
        args.command = "random";
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
    } else if (args.command === "interactive" && (first === "browse" || first === "filter")) {
      args.command = "browse";
    } else if (args.command === "interactive" && (first === "sources" || first === "source")) {
      args.command = "sources";
      if (rest) args.query = rest; // reset
    } else if (args.command === "interactive" && (first === "random" || first === "roll")) {
      args.command = "random";
    } else if (args.command === "interactive" && (first === "game" || first === "play" || first === "zombies")) {
      args.command = "game";
    } else if (args.command === "interactive" && (first === "nyaa" || first === "torrent" || first === "magnet")) {
      args.command = "nyaa";
      if (rest) args.query = rest;
    } else if (args.command === "interactive" && (first === "updates" || first === "u")) {
      args.command = "updates";
    } else if (args.command === "interactive" && first === "sync") {
      args.command = "sync";
    } else if (args.command === "interactive" && (first === "mal" || first === "myanimelist")) {
      args.command = "mal";
      if (rest) args.query = rest; // login | status | logout
    } else if (args.command === "interactive" && (first === "config" || first === "settings")) {
      args.command = "config";
      if (rest) args.query = rest; // get | set | edit | path

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
  console.log(`${banner(VERSION)}
${b("USAGE")}
  manga-cli                ${c.dim("# no args → interactive main menu")}
  manga-cli [flags] [query]
  manga-cli help | <command>

${b("COMMANDS / FLAGS")}
  ${k("-s, --search")} <query>   search and pick a manga
  ${k("-R, --random")}           🎲 roll a random manga and start reading
  ${k("-c, --continue")}         resume your last-read manga
  ${k("-H, --history")}          browse reading history
  ${k("-t, --trending")}         show trending manga
  ${k("-p, --popular")}          show popular manga
  ${k("-l, --latest")}           show latest updates
  ${k("-g, --genre")} <genre>    browse by genre
  ${k("    browse")}             filtered browse — genre + status + sort
  ${k("-r, --recommended")} [q]   "more like this" — recommendations for a title
  ${k("    --follow")} [query]    follow a series for new-chapter updates
  ${k("-u, --updates")}          show followed series with new chapters
  ${k("    sync")}               download new chapters for everything you follow
  ${k("    mal")} [login|status|logout]  ${c.dim("track reading on MyAnimeList")}
  ${k("    --library")}          browse & read your downloads offline
  ${k("    --stats")}            your reading stats / wrapped
  ${k("-d, --download")} <query>  download chapters (CBZ/ZIP/PDF/images)
  ${k("-f, --format")} <fmt>      download format: cbz · zip · pdf · images
  ${k("    --chapters")} <spec>   pick chapters non-interactively: 1-10 · 1,3,5 · all · latest
  ${k("    --out")} <dir>         download into <dir> (overrides config)
  ${k("-S, --source")} <id>       force: atsumaru · weebcentral · mangakatana · mangadex
  ${k("    sources")} [reset]     list sources & health — reset forgives recorded failures
  ${k("    config")} [sub]        view & change settings — interactive, or get · set · edit · path
  ${k("    game")}               🕹  MANGAVANIA — zombie-slaying minigame (needs zero internet)
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
  ${k("t")}              toggle reading direction (rtl ⇄ ltr)
  ${k("f")}              toggle fit (whole page ⇄ fill width)
  ${k("b")}              follow / unfollow this series
  ${k("+ / - / 0")}      zoom in / out / reset
  ${k("s")}              save current page to your downloads
  ${k("r")}              re-render (after a terminal resize)
  ${k("j")}              back to the chapter list
  ${k("m")}              back to the main menu (works from any read)
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

${b("SOURCES")}  ${c.dim("atsu.moe primary · fallback: weebcentral → mangakatana → mangadex")}
  ${k("atsumaru")}     atsu.moe          ${c.dim("primary (richest metadata)")}
  ${k("weebcentral")}  weebcentral.com   ${c.dim("huge current scanlation library")}
  ${k("mangakatana")}  mangakatana.com   ${c.dim("broad library incl. licensed titles")}
  ${k("mangadex")}     mangadex.org      ${c.dim("open API (some titles delicensed)")}
  ${c.dim("If the primary is down/empty, the next source answers automatically.")}
  ${c.dim("Pick a main source with -S/--source, or `source`/`fallback` in config.")}

${b("SETTINGS")}  ${c.dim("~/.config/manga-cli/config.json — or just run: manga-cli config")}
  ${k("source")}       atsumaru · weebcentral · mangakatana · mangadex
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

/** Colored status dot: ● ongoing · ◆ completed · ◑ hiatus · ✕ cancelled. */
function statusBadge(status?: string): string | undefined {
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (s.includes("ongoing") || s.includes("releasing") || s.includes("publishing")) return c.green(`● ${status}`);
  if (s.includes("complete") || s.includes("finished")) return c.cyan(`◆ ${status}`);
  if (s.includes("hiatus")) return c.yellow(`◑ ${status}`);
  if (s.includes("cancel") || s.includes("dropped")) return c.red(`✕ ${status}`);
  return c.dim(status);
}

function searchLabel(r: SearchResult): string {
  const rating = r.rating ? c.yellow(`★${r.rating.toFixed(1)}`) : undefined;
  const meta = [
    r.type ? c.dim(r.type) : undefined,
    statusBadge(r.status),
    r.year ? c.dim(String(r.year)) : undefined,
    r.popularity ? c.dim(String(r.popularity)) : undefined,
  ]
    .filter(Boolean)
    .join(c.dim(" · "));
  const adult = r.isAdult ? c.pink(" 18+") : "";
  return `${c.bold(r.title)}${adult}   ${meta}${rating ? "   " + rating : ""}`;
}

function discoveryLabel(it: DiscoveryItem): string {
  const rating = it.rating ? c.yellow(`★${it.rating.toFixed(1)}`) : undefined;
  const meta = metaLine([it.type, it.views ? `${it.views} views` : undefined]);
  const adult = it.isAdult ? c.pink(" 18+") : "";
  return `${c.bold(it.title)}${adult}   ${c.dim(meta)}${rating ? "   " + rating : ""}`;
}

function chapterLabel(ch: Chapter, pad = 0): string {
  const title =
    ch.title && ch.title !== `Chapter ${ch.number}` ? c.gray(` · ${ch.title}`) : "";
  const date = ch.createdAt ? c.dim("  " + new Date(ch.createdAt).toLocaleDateString()) : "";
  // Page counts aren't known for every source (weebcentral/local) — hide "0p".
  const pages = ch.pageCount > 0 ? `   ${c.dim(`${ch.pageCount}p`)}` : "";
  return `${c.bold(c.cyan(`Ch.${String(ch.number).padEnd(pad)}`))}${title}${pages}${date}`;
}

/** Widest chapter number in the list, for column-aligned picker rows. */
function chapterPad(chapters: Chapter[]): number {
  let w = 0;
  for (const ch of chapters) w = Math.max(w, String(ch.number).length);
  return w;
}

/** Tiny ▰▰▰▱▱ progress bar (frac ∈ [0,1]). */
function miniBar(frac: number, width = 10): string {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return c.violet("▰".repeat(n)) + c.dim("▱".repeat(width - n));
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
  const frac = h.totalChapters > 0 ? (h.lastChapterIndex + 1) / h.totalChapters : 0;
  const progress = `${miniBar(frac)}  ${c.dim(`Ch.${h.lastChapterNumber} · p.${h.lastPage + 1} of ${h.totalChapters}ch`)}`;
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

/** Thrown from deep inside a flow (reader key `m`) to unwind back to the main menu. */
class GoToMenu extends Error {
  constructor() {
    super("menu");
  }
}

interface Resume {
  chapterIndex: number;
  page: number;
}

function chapterWebUrl(source: SourceId, mangaId: string, chapterId: string): string {
  if (source === "mangadex") return `https://mangadex.org/chapter/${chapterId}`;
  if (source === "weebcentral") return `https://weebcentral.com/chapters/${chapterId}`;
  if (source === "mangakatana") return `https://mangakatana.com/manga/${mangaId}/${chapterId}`;
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
    syncMal(cfg, fullRef);
    if (result.action === "menu") throw new GoToMenu();
    if (result.action === "quit") return;
    // "jump" → loop back to the chapter picker
  }
}

/** Fire-and-forget MyAnimeList progress update from the latest history entry. */
function syncMal(cfg: Config, ref: MangaRef): void {
  const clientId = cfg.malClientId || process.env.MAL_CLIENT_ID || "";
  const clientSecret = cfg.malClientSecret || process.env.MAL_CLIENT_SECRET || "";
  if (!clientId || !ref.source) return; // online titles only
  void getHistoryEntry(ref.id).then((h) => {
    if (h) void malUpdateProgress(clientId, clientSecret, ref.title, h.lastChapterNumber);
  });
}

async function pickChapter(info: MangaInfo): Promise<number | null> {
  // Present newest chapter first, but keep the real ascending index.
  const pad = chapterPad(info.chapters);
  const items = info.chapters
    .map((ch, idx) => ({ label: chapterLabel(ch, pad), idx }))
    .reverse();
  const picked = await fzfPick(items, {
    prompt: "chapter ❯ ",
    header: `${info.title} — ${info.chapters.length} chapters\ntype to filter · Enter to read`,
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

// ── main menu (bare `manga-cli`) ────────────────────────────────────────────────

async function mainMenu(cfg: Config, args: Args): Promise<void> {
  const pad = (s: string): string => s.padEnd(10);
  interface MenuEntry {
    label: string;
    run: () => Promise<void>;
    /** Wait for Enter after running (flows that print and return). */
    pause?: boolean;
  }
  // Loop: flows come back here when they finish (or when `m` is pressed anywhere).
  while (true) {
    const recent = await mostRecent();
    const entries: MenuEntry[] = [
      { label: `🔍  ${c.bold(pad("search"))} ${c.dim("find manga by title")}`, run: () => interactiveSearch(cfg, args) },
      ...(recent
        ? [
            {
              label: `📖  ${c.bold(pad("continue"))} ${c.dim(`${recent.title} · Ch.${recent.lastChapterNumber}`)}`,
              run: () => continueFlow(cfg, args),
            },
          ]
        : []),
      { label: `🎲  ${c.bold(pad("random"))} ${c.dim("roll a random manga")}`, run: () => randomFlow(cfg, args) },
      { label: `🔥  ${c.bold(pad("trending"))} ${c.dim("what's hot right now")}`, run: () => discoveryFlow("trending", cfg, args) },
      { label: `⭐  ${c.bold(pad("popular"))} ${c.dim("all-time favorites")}`, run: () => discoveryFlow("popular", cfg, args) },
      { label: `🆕  ${c.bold(pad("latest"))} ${c.dim("fresh chapter updates")}`, run: () => discoveryFlow("recentlyUpdated", cfg, args) },
      { label: `🧭  ${c.bold(pad("browse"))} ${c.dim("filter by genre · status · sort")}`, run: () => browseFlow(cfg, args) },
      { label: `💜  ${c.bold(pad("updates"))} ${c.dim("your followed series")}`, run: () => updatesFlow(cfg, args) },
      { label: `🕘  ${c.bold(pad("history"))} ${c.dim("recently read")}`, run: () => historyFlow(cfg, args) },
      { label: `📚  ${c.bold(pad("library"))} ${c.dim("read your downloads offline")}`, run: () => libraryFlow(cfg, args) },
      { label: `📊  ${c.bold(pad("stats"))} ${c.dim("your reading wrapped")}`, run: () => statsFlow(), pause: true },
      { label: `🕹️  ${c.bold(pad("game"))} ${c.dim("MANGAVANIA — slay zombies while the wifi is dead")}`, run: () => runGame() },
      { label: `🔧  ${c.bold(pad("config"))} ${c.dim("settings editor")}`, run: () => configFlow("", cfg) },
    ];
    const picked = await fzfPick(entries, {
      prompt: "manga-cli ❯ ",
      header: "what are we reading? · Esc to quit · m in the reader returns here",
    });
    if (!picked) return;
    try {
      await picked.run();
      if (picked.pause) await prompt(c.dim("\n  ⏎  back to the menu … "));
    } catch (e) {
      if (!(e instanceof GoToMenu)) throw e;
    }
  }
}

// ── random manga (🎲) ───────────────────────────────────────────────────────────

const RANDOM_KINDS: DiscoveryKind[] = ["trending", "popular", "topRated", "recentlyUpdated"];

async function randomFlow(cfg: Config, args: Args): Promise<void> {
  const kind = RANDOM_KINDS[Math.floor(Math.random() * RANDOM_KINDS.length)];
  const page = Math.floor(Math.random() * 3);
  let res = await withSpinner("rolling the dice 🎲 …", () => discoveryAny(kind, page, cfg.adult));
  if (res.items.length === 0 && page > 0) {
    // Not every source paginates every feed — re-roll on the first page.
    res = await withSpinner("re-rolling …", () => discoveryAny(kind, 0, cfg.adult));
  }
  if (res.items.length === 0) {
    console.log(c.yellow("The dice came up empty — try again."));
    return;
  }
  const it = res.items[Math.floor(Math.random() * res.items.length)];
  console.log(`🎲 ${c.dim("rolled")} ${c.bold(it.title)}${sourceTag(res.source)}`);
  await openManga(refOf(it), cfg, args);
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
    getSource(source).browse({ genreId: genre!.id, adult: cfg.adult }),
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

// ── advanced browse (genre + status + sort) ─────────────────────────────────────

const BROWSE_SORTS: Array<{ label: string; v: BrowseSort }> = [
  { label: "Most popular", v: "popular" },
  { label: "Recently updated", v: "latest" },
  { label: "Top rated", v: "rating" },
  { label: "A → Z", v: "alphabetical" },
];

async function browseFlow(cfg: Config, args: Args): Promise<void> {
  const { filters, source } = await withSpinner("loading filters …", () => filtersAny());

  const genrePick = await fzfPick(
    [
      { label: c.dim("— any genre —"), g: null as Genre | null },
      ...filters.genres.map((g) => ({ label: c.bold(g.name), g: g as Genre | null })),
    ],
    { prompt: "genre ❯ ", header: `browse ${source} · pick a genre (or “any”)` },
  );
  if (!genrePick) return;

  let status: string | undefined;
  let statusName: string | undefined;
  if (filters.statuses.length > 0) {
    const sp = await fzfPick(
      [
        { label: c.dim("— any status —"), s: null as Genre | null },
        ...filters.statuses.map((s) => ({ label: c.bold(s.name), s: s as Genre | null })),
      ],
      { prompt: "status ❯ ", header: "filter by status" },
    );
    if (!sp) return;
    status = sp.s?.id;
    statusName = sp.s?.name;
  }

  const sortPick = await fzfPick(
    BROWSE_SORTS.map((s) => ({ label: c.bold(s.label), v: s.v })),
    { prompt: "sort ❯ ", header: "sort by" },
  );
  if (!sortPick) return;

  const filter = { genreId: genrePick.g?.id, status, sort: sortPick.v, adult: cfg.adult };
  const results = await withSpinner("browsing …", () => getSource(source).browse(filter));
  if (results.length === 0) {
    console.log(c.yellow("No results for that combination — try loosening the filters."));
    return;
  }
  const crumbs = [genrePick.g?.name, statusName, sortPick.label].filter(Boolean).join(" · ");
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: { ...r, source } }));
  const picked = await fzfPick(items, {
    prompt: "browse ❯ ",
    header: `${crumbs} · ${results.length} titles${sourceTag(source)}`,
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
  const pad = chapterPad(info.chapters);
  const items = info.chapters
    .map((ch) => {
      const mark = done.has(chapterStem(ref, ch)) ? c.green("✓ ") : "  ";
      return { label: mark + chapterLabel(ch, pad), ch };
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

async function printWhere(cfg: Config): Promise<void> {
  const row = (k: string, v: string): string => `   ${c.cyan(k.padEnd(11))}${v}`;
  const dep = (name: string): string =>
    Bun.which(name) ? c.green("✓ ") + name : c.red("✗ ") + name + c.dim(" (missing)");
  const malLinked = await malLoggedIn();
  const protocol = resolveProtocol(cfg.readerMode);
  console.log(
    [
      "",
      rule("paths"),
      row("config", CONFIG_FILE),
      row("history", HISTORY_FILE),
      row("cache", CACHE_DIR),
      row("downloads", cfg.downloadDir),
      "",
      rule("setup"),
      row("sources", `${c.bold(cfg.source)}${cfg.fallback.length ? c.dim(` → ${cfg.fallback.filter((f) => f !== cfg.source).join(" → ")}`) : ""}`),
      row("reader", `${protocol}${cfg.readerMode === "auto" ? c.dim(" (auto-detected)") : ""}`),
      row("MAL", malLinked ? c.green("linked") : c.dim("not linked — manga-cli mal login")),
      row("deps", `${dep("fzf")}  ${dep("chafa")}  ${dep("zip")}  ${dep("aria2c")}`),
      "",
    ].join("\n"),
  );
}

async function printSources(cfg: Config): Promise<void> {
  const down = await downSources();
  const lines = ["", rule("sources")];
  for (const s of allSources()) {
    const active = s.id === cfg.source;
    const cooling = down.has(s.id);
    const mark = !s.available ? c.red("✗ ") : cooling ? c.yellow("◌ ") : active ? c.green("● ") : c.cyan("○ ");
    const note = !s.available
      ? c.red("  unavailable")
      : cooling
        ? c.yellow("  cooling down · failed recently")
        : active
          ? c.green("  primary")
          : "";
    lines.push(`  ${mark}${c.bold(s.id.padEnd(12))} ${c.dim(s.label)}${note}`);
  }
  const chainStr = [cfg.source, ...cfg.fallback.filter((f) => f !== cfg.source)].join(" → ");
  lines.push("", c.dim(`   fallback chain: ${chainStr}`));
  lines.push(c.dim(`   set with --source <id>, or: manga-cli config set source <id>`), "");
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

// ── sync (auto-download new chapters of followed series) ────────────────────────

async function syncFlow(cfg: Config, args: Args): Promise<void> {
  const follows = await loadFollows();
  if (follows.length === 0) {
    console.log(c.yellow("Not following anything yet — add a series with --follow."));
    return;
  }
  const format = args.format ?? cfg.downloadFormat;
  const dir = args.out ? expandTilde(args.out) : cfg.downloadDir;
  console.log(c.dim(`syncing ${follows.length} followed series · ${c.bold(format)} → ${dir}\n`));

  let downloaded = 0;
  let failed = 0;
  let upToDate = 0;
  for (const f of follows) {
    const source = getSource(f.source);
    let info: MangaInfo;
    try {
      info = await withSpinner(`checking ${f.title} …`, () => source.info(f.id));
    } catch (err) {
      console.log(c.red(`✗ ${f.title}: ${err instanceof Error ? err.message : String(err)}`));
      failed++;
      continue;
    }
    // New chapters are the ones past the baseline count we last saw.
    const fresh = info.chapters.slice(f.chapterCount);
    if (fresh.length === 0) {
      console.log(c.dim(`• ${f.title} — up to date`));
      upToDate++;
      await markSeen(f.id, info.chapters.length);
      continue;
    }
    console.log(c.green(`↓ ${f.title}`) + c.dim(`  ${fresh.length} new chapter(s)`));
    const ref: MangaRef = { id: f.id, title: info.title || f.title, poster: f.coverUrl, source: f.source };
    for (const ch of fresh) {
      const sp = new Spinner(`   Ch.${ch.number} …`).start();
      try {
        const res = await downloadChapter(ref, ch, {
          format,
          downloadDir: dir,
          loadPages: (cid) => source.pages(ref.id, cid),
          onProgress: (d, t) => sp.update(`   Ch.${ch.number}  ${c.dim(`${d}/${t}p`)}`),
        });
        sp.stop(res.skipped ? c.dim(`   • Ch.${ch.number} already on disk`) : c.green(`   ✓ Ch.${ch.number}`));
        if (!res.skipped) downloaded++;
      } catch (err) {
        sp.stop(c.red(`   ✗ Ch.${ch.number}: ${err instanceof Error ? err.message : String(err)}`));
        failed++;
      }
    }
    await markSeen(f.id, info.chapters.length);
  }
  console.log(
    "\n" +
      c.bold("Sync complete") +
      c.dim(` — ${downloaded} chapter(s) downloaded · ${upToDate} up to date · ${failed} failed`),
  );
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
    if (result.action === "menu") throw new GoToMenu();
    if (result.action === "quit") return;
  }
}

// ── reading stats ──────────────────────────────────────────────────────────────

function bar(value: number, max: number, width: number, color: (s: string) => string): string {
  const n = max > 0 ? Math.round((value / max) * width) : 0;
  return color("█".repeat(n)) + c.dim("░".repeat(Math.max(0, width - n)));
}

/** Section rule: ─╴ label ╶──────── */
function rule(label: string, width = 58): string {
  return (
    c.dim("─╴ ") + c.bold(c.violet(label)) + c.dim(" ╶" + "─".repeat(Math.max(1, width - label.length - 5)))
  );
}

async function statsFlow(): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.log(c.yellow("No reading history yet — read something first."));
    return;
  }
  const s = computeStats(history);
  const out: string[] = ["", rule("your reading wrapped")];

  out.push(
    "",
    `   ${c.bold(c.cyan(String(s.chaptersProgressed)))} chapters deep across ${c.bold(c.cyan(String(s.titles)))} titles`,
    `   ${c.green(`✓ ${s.finished} finished`)}  ${c.dim("·")}  ${c.yellow(`◐ ${s.inProgress} in progress`)}${s.since ? c.dim(`  ·  reading since ${new Date(s.since).toLocaleDateString()}`) : ""}`,
    "",
    `   🔥 ${c.bold(String(s.currentStreak))}-day streak ${c.dim(`(best ${s.longestStreak})`)}   📅 ${c.bold(String(s.activeDays))} active day${s.activeDays === 1 ? "" : "s"}`,
  );
  if (s.lastReadTitle) out.push(`   ${c.dim("last read")}  ${c.bold(s.lastReadTitle)}`);

  if (s.topTitles.length > 0) {
    out.push("", rule("most read"));
    const maxCh = Math.max(1, ...s.topTitles.map((t) => t.chapters));
    for (const t of s.topTitles) {
      const name = (t.title.length > 22 ? t.title.slice(0, 21) + "…" : t.title).padEnd(22);
      const frac = `${t.chapters}/${t.total}`.padStart(9);
      const pct = `${String(t.pct).padStart(3)}%`;
      out.push(
        `   ${c.bold(name)} ${bar(t.chapters, maxCh, 16, c.violet)} ${c.dim(frac)}  ${t.pct >= 100 ? c.green(pct) : c.cyan(pct)}`,
      );
    }
  }

  out.push("", rule("by weekday"));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date().getDay();
  const maxW = Math.max(1, ...s.weekday);
  for (let i = 0; i < 7; i++) {
    const name = i === today ? c.bold(c.cyan(days[i])) : c.dim(days[i]);
    const marker = i === today ? c.cyan("▸") : " ";
    out.push(`  ${marker}${name} ${bar(s.weekday[i], maxW, 18, c.cyan)} ${c.dim(String(s.weekday[i]))}`);
  }
  out.push("");
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

// ── MyAnimeList tracking ────────────────────────────────────────────────────────

async function malFlow(sub: string, cfg: Config): Promise<void> {
  const clientId = cfg.malClientId || process.env.MAL_CLIENT_ID || "";
  const clientSecret = cfg.malClientSecret || process.env.MAL_CLIENT_SECRET || "";
  if (!clientId) {
    console.log(c.yellow("MyAnimeList isn't configured yet."));
    console.log(c.dim("  1. Create an API app: ") + c.cyan("https://myanimelist.net/apiconfig"));
    console.log(c.dim("  2. Set its App Redirect URL to: ") + c.cyan(MAL_REDIRECT_URI));
    console.log(
      c.dim('  3. Put them in config (') +
        CONFIG_FILE +
        c.dim(') as ') +
        c.cyan('"malClientId"') +
        c.dim(" + ") +
        c.cyan('"malClientSecret"'),
    );
    console.log(c.dim("     (or env $MAL_CLIENT_ID / $MAL_CLIENT_SECRET), then run ") + c.bold("manga-cli mal login"));
    return;
  }
  const parts = sub.trim().split(/\s+/);
  const action = (parts[0] || "status").toLowerCase();
  const arg = parts.slice(1).join(" "); // pasted redirect URL / code (case preserved)

  if (action === "logout") {
    await malLogout();
    console.log(c.dim("Unlinked MyAnimeList."));
    return;
  }
  if (action === "login") {
    if (arg) {
      // Step 2: finish from the pasted redirect URL / code.
      const r = await malCompleteFromInput(clientId, clientSecret, arg);
      if (!r.ok) {
        console.log(c.red(`✗ ${r.message}`));
        return;
      }
      const who = await malWhoAmI(clientId, clientSecret);
      console.log(c.green(`✓ Linked MyAnimeList${who ? ` as ${who}` : ""}`) + c.dim(" — progress syncs as you read."));
      return;
    }
    // Step 1: open the browser, then tell them how to finish.
    const { authUrl } = await malBeginLogin(clientId);
    console.log(c.bold("1) Approve access in your browser") + c.dim(" (opening now)…"));
    openInBrowser(authUrl);
    console.log(c.dim("   If it didn't open, visit:\n   ") + c.cyan(authUrl));
    console.log(
      c.bold("\n2) ") +
        c.dim("Your browser will then try to load a ") +
        c.bold("localhost") +
        c.dim(" page that ") +
        c.bold("won't load — that's normal.") +
        c.dim("\n   Copy that whole URL, then run (") +
        c.bold("keep the quotes") +
        c.dim("):\n"),
    );
    console.log("   " + c.cyan("manga-cli mal login '<paste-the-localhost-URL-here>'"));
    return;
  }
  // status (default)
  const who = await malWhoAmI(clientId, clientSecret);
  console.log(
    who
      ? c.green(`MyAnimeList: linked as ${c.bold(who)}`)
      : c.dim("MyAnimeList: not linked — run ") + c.bold("manga-cli mal login"),
  );
}

// ── config command ──────────────────────────────────────────────────────────────

type SettingKind = "enum" | "bool" | "number" | "string" | "sources";
interface SettingMeta {
  key: keyof Config;
  kind: SettingKind;
  desc: string;
  options?: readonly string[];
  min?: number;
  max?: number;
  /** Mask the value when displaying (API secrets). */
  secret?: boolean;
}

const SETTINGS: SettingMeta[] = [
  { key: "source", kind: "enum", options: SOURCE_IDS, desc: "primary content source" },
  { key: "fallback", kind: "sources", desc: "ordered backup sources (comma-separated)" },
  { key: "readerMode", kind: "enum", options: ["auto", "kitty", "iterm2", "chafa"], desc: "image protocol" },
  { key: "direction", kind: "enum", options: ["rtl", "ltr"], desc: "reading direction (manga = rtl)" },
  { key: "dualPage", kind: "bool", desc: "two-page spreads" },
  { key: "fit", kind: "enum", options: ["page", "width"], desc: "single-page fit" },
  { key: "zoom", kind: "number", min: 0.4, max: 1.0, desc: "render scale" },
  { key: "hudReserve", kind: "number", min: 1, max: 6, desc: "rows reserved for the reader HUD" },
  { key: "downloadFormat", kind: "enum", options: ["cbz", "zip", "pdf", "images"], desc: "default download format" },
  { key: "prefetchPages", kind: "number", min: 0, max: 8, desc: "pages to prefetch while reading" },
  { key: "showBanner", kind: "bool", desc: "show the ASCII banner" },
  { key: "adult", kind: "bool", desc: "include 18+ results" },
  { key: "downloadDir", kind: "string", desc: "downloads folder" },
  { key: "fzfArgs", kind: "string", desc: "extra fzf arguments" },
  { key: "malClientId", kind: "string", secret: true, desc: "MyAnimeList API client id" },
  { key: "malClientSecret", kind: "string", secret: true, desc: "MyAnimeList API client secret" },
];

function showValue(cfg: Config, m: SettingMeta): string {
  const v = cfg[m.key];
  if (m.secret) return v ? `${String(v).slice(0, 4)}…` : "(not set)";
  if (Array.isArray(v)) return v.join(", ") || "(none)";
  if (v === "") return "(empty)";
  return String(v);
}

/** Validate + apply a raw value onto cfg. Returns an error message, or null on success. */
function applySetting(cfg: Config, m: SettingMeta, raw: string): string | null {
  const v = raw.trim();
  switch (m.kind) {
    case "enum":
      if (!m.options?.includes(v)) return `must be one of: ${m.options?.join(" · ")}`;
      (cfg as unknown as Record<string, unknown>)[m.key] = v;
      return null;
    case "bool": {
      const low = v.toLowerCase();
      const t = ["true", "1", "on", "yes", "y"].includes(low);
      if (!t && !["false", "0", "off", "no", "n"].includes(low)) return "must be true or false";
      (cfg as unknown as Record<string, unknown>)[m.key] = t;
      return null;
    }
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "must be a number";
      if (n < (m.min ?? -Infinity) || n > (m.max ?? Infinity)) return `must be between ${m.min} and ${m.max}`;
      (cfg as unknown as Record<string, unknown>)[m.key] = m.key === "zoom" ? n : Math.round(n);
      return null;
    }
    case "sources": {
      const ids = v.split(/[,\s]+/).filter(Boolean);
      const bad = ids.find((s) => !isSourceId(s));
      if (bad) return `unknown source “${bad}” — valid: ${SOURCE_IDS.join(" · ")}`;
      cfg.fallback = ids.filter(isSourceId);
      return null;
    }
    case "string":
      (cfg as unknown as Record<string, unknown>)[m.key] = m.key === "downloadDir" ? expandTilde(v) : v;
      return null;
  }
}

async function configFlow(sub: string, cfg: Config): Promise<void> {
  const parts = sub.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] || "").toLowerCase();

  if (action === "path") {
    console.log(CONFIG_FILE);
    return;
  }
  if (action === "edit") {
    const editor = process.env.VISUAL || process.env.EDITOR || "nano";
    Bun.spawnSync([editor, CONFIG_FILE], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    return;
  }
  if (action === "get") {
    const key = parts[1];
    const list = key ? SETTINGS.filter((m) => m.key === key) : SETTINGS;
    if (list.length === 0) {
      console.log(c.red(`unknown setting “${key}”`) + c.dim(" — see: manga-cli config get"));
      return;
    }
    const w = Math.max(...list.map((m) => m.key.length));
    for (const m of list) {
      console.log(`  ${c.cyan(m.key.padEnd(w))}  ${c.bold(showValue(cfg, m))}  ${c.dim(m.desc)}`);
    }
    return;
  }
  if (action === "set") {
    const m = SETTINGS.find((s) => s.key === parts[1]);
    if (!m) {
      console.log(c.red(`unknown setting “${parts[1] ?? ""}”`) + c.dim(" — see: manga-cli config get"));
      return;
    }
    const raw = parts.slice(2).join(" ");
    if (!raw) {
      console.log(c.yellow(`usage: manga-cli config set ${m.key} <value>`));
      return;
    }
    const err = applySetting(cfg, m, raw);
    if (err) {
      console.log(c.red(`✗ ${m.key}: ${err}`));
      return;
    }
    await saveConfig(cfg);
    console.log(c.green(`✓ ${m.key}`) + c.dim(" = ") + c.bold(showValue(cfg, m)));
    return;
  }
  if (action && action !== "list") {
    console.log(c.yellow("usage: manga-cli config [get [key] | set <key> <value> | edit | path]"));
    return;
  }

  // Interactive editor: pick a setting → pick/enter a value → save → repeat.
  await ensureDeps(["fzf"]);
  while (true) {
    const w = Math.max(...SETTINGS.map((m) => m.key.length));
    const items = SETTINGS.map((m) => ({
      label: `${c.cyan(m.key.padEnd(w))}  ${c.bold(showValue(cfg, m).padEnd(20))}  ${c.dim(m.desc)}`,
      m,
    }));
    const picked = await fzfPick(items, {
      prompt: "setting ❯ ",
      header: `config · ${CONFIG_FILE}\nEnter to change · Esc when done`,
    });
    if (!picked) return;
    const m = picked.m;

    let raw: string | null = null;
    if (m.kind === "enum" || m.kind === "bool") {
      const options = m.kind === "bool" ? ["true", "false"] : [...(m.options ?? [])];
      const cur = String(cfg[m.key]);
      const opt = await fzfPick(
        options.map((o) => ({ label: `${o === cur ? c.green("● ") : "  "}${c.bold(o)}`, o })),
        { prompt: `${m.key} ❯ `, header: m.desc },
      );
      raw = opt?.o ?? null;
    } else {
      const range = m.min !== undefined ? c.dim(`  (${m.min}–${m.max})`) : "";
      console.log(`\n  ${c.cyan(m.key)} ${c.dim(`· ${m.desc}`)}${range}`);
      console.log(c.dim(`  current: ${showValue(cfg, m)}`));
      const answer = await prompt(c.violet("  new value ❯ "));
      raw = answer.trim() ? answer : null;
    }
    if (raw === null) continue;
    const err = applySetting(cfg, m, raw);
    if (err) {
      console.log(c.red(`  ✗ ${err}`));
      await prompt(c.dim("  press Enter …"));
      continue;
    }
    await saveConfig(cfg);
    console.log(c.green(`  ✓ ${m.key}`) + c.dim(" = ") + c.bold(showValue(cfg, m)));
  }
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
  if (args.command === "sources") {
    if ((args.query ?? "").trim().toLowerCase() === "reset") {
      await clearHealth();
      console.log(c.green("✓ source health cache cleared") + c.dim(" — all sources back in play\n"));
    }
    return printSources(cfg);
  }
  if (args.command === "sync") return syncFlow(cfg, args);
  if (args.command === "mal") return malFlow(args.query ?? "", cfg);
  if (args.command === "config") return configFlow(args.query ?? "", cfg);
  if (args.command === "game") return runGame();

  await ensureDeps(["fzf", "chafa"]);

  if (!args.noBanner && shouldShowBanner(cfg.showBanner)) {
    process.stdout.write(banner() + "\n");
  }

  const dispatch = (): Promise<void> => {
    switch (args.command) {
      case "interactive":
        return mainMenu(cfg, args);
      case "search":
        return searchFlow(args.query ?? "", cfg, args);
      case "random":
        return randomFlow(cfg, args);
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
      case "browse":
        return browseFlow(cfg, args);
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
    return Promise.resolve();
  };

  try {
    await dispatch();
  } catch (e) {
    // `m` pressed deep inside a directly-launched flow → open the main menu.
    if (e instanceof GoToMenu) return mainMenu(cfg, args);
    throw e;
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
  if (msg.includes("internet connection looks down")) {
    console.error(c.dim("  while you wait — slay some zombies: ") + c.cyan("manga-cli game") + " 🕹️");
  }
  process.exit(1);
});
