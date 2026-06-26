#!/usr/bin/env bun
// manga-cli — a fast, lightweight terminal manga reader for atsu.moe.

import { ApiError } from "./api/client.ts";
import { searchManga, browseByFilter } from "./api/search.ts";
import { getMangaInfo, getDiscovery, getFilters, type DiscoveryKind } from "./api/manga.ts";
import type { MangaInfo, MangaRef, SearchResult, DiscoveryItem, Chapter } from "./api/types.ts";
import { loadConfig, ensureConfigFile, type Config } from "./utils/config.ts";
import { loadHistory, getHistoryEntry, mostRecent, type HistoryEntry } from "./utils/history.ts";
import { banner, shouldShowBanner } from "./ui/banner.ts";
import { c } from "./ui/colors.ts";
import { ensureDeps } from "./ui/deps.ts";
import { fzfPick, type PickItem } from "./ui/menu.ts";
import { withSpinner } from "./ui/progress.ts";
import { resolveProtocol, inTmux } from "./ui/protocol.ts";
import { runReader } from "./ui/reader.ts";

const VERSION = "0.1.0";

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
    if (args.command === "genre") args.genre ??= joined;
    else if (args.command === "search") args.query ??= joined;
    else if (args.command === "interactive" && (first === "help" || first === "h")) {
      args.command = "help";
    } else if (args.command === "interactive" && first === "version") {
      args.command = "version";
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
  ${k("    --dual")}             open in two-page (spread) mode
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
  ${k("d")}              toggle dual-page spread
  ${k("m")}              toggle reading direction (rtl ⇄ ltr)
  ${k("f")}              toggle fit (whole page ⇄ fill width)
  ${k("+ / - / 0")}      zoom in / out / reset
  ${k("s")}              save current page to your downloads
  ${k("r")}              re-render (after a terminal resize)
  ${k("j")}              back to the chapter list
  ${k("? ")}             in-reader help · ${k("q / esc")} quit

${b("EXAMPLES")}
  manga-cli berserk           ${c.dim("# search")}
  manga-cli -t                ${c.dim("# trending")}
  manga-cli -g action         ${c.dim("# browse a genre")}
  manga-cli --dual one piece  ${c.dim("# two-page spreads")}
  manga-cli -c                ${c.dim("# continue reading")}

${b("SETTINGS")}  ${c.dim("~/.config/manga-cli/config.json")}
  ${k("readerMode")}   auto · kitty · iterm2 · chafa     ${c.dim("(image protocol)")}
  ${k("direction")}    rtl · ltr                          ${c.dim("(manga is rtl)")}
  ${k("dualPage")}     true · false                       ${c.dim("(two-page spreads)")}
  ${k("fit")}          page · width                       ${c.dim("(single-page fit)")}
  ${k("zoom")}         0.4 – 1.0                          ${c.dim("(render scale)")}
  ${k("prefetchPages")} number of pages to prefetch
  ${k("adult")}        include 18+ content by default
  ${k("downloadDir")}  where saved pages go

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
  return `${c.bold(c.cyan(`Ch.${ch.number}`))}${title}   ${c.dim(`${ch.pageCount}p`)}${date}`;
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

async function openManga(
  ref: MangaRef,
  cfg: Config,
  args: Args,
  resume?: Resume,
): Promise<void> {
  const info: MangaInfo = await withSpinner(`loading ${ref.title} …`, () => getMangaInfo(ref.id));
  if (info.chapters.length === 0) {
    console.log(c.yellow("No readable chapters for this title."));
    return;
  }
  const title = info.title || ref.title;
  const fullRef: MangaRef = { ...ref, title };

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
      if (ch) openInBrowser(`https://atsu.moe/read/${ref.id}/${ch.id}`);
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

async function searchFlow(query: string, cfg: Config, args: Args): Promise<void> {
  if (!query.trim()) return interactiveSearch(cfg, args);
  const results = await withSpinner(`searching “${query}” …`, () =>
    searchManga(query, { adult: cfg.adult }),
  );
  if (results.length === 0) {
    console.log(c.yellow(`No results for “${query}”.`));
    return;
  }
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: r }));
  const picked = await fzfPick(items, {
    prompt: "manga ❯ ",
    header: `${results.length} results for “${query}”`,
    preview: true,
  });
  if (!picked) return;
  await openManga(
    { id: picked.ref.id, title: picked.ref.title, poster: picked.ref.poster },
    cfg,
    args,
  );
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
    { id: recent.id, title: recent.title, poster: recent.coverUrl },
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
  await openManga({ id: h.id, title: h.title, poster: h.coverUrl }, cfg, args, {
    chapterIndex: h.lastChapterIndex,
    page: h.lastPage,
  });
}

async function discoveryFlow(kind: DiscoveryKind, cfg: Config, args: Args): Promise<void> {
  const name = DISCOVERY_TITLES[kind];
  const items = await withSpinner(`loading ${name} …`, () => getDiscovery(kind, 0, cfg.adult));
  if (items.length === 0) {
    console.log(c.yellow(`Nothing in ${name} right now.`));
    return;
  }
  const picks = items.map((it) => ({ label: discoveryLabel(it), previewUrl: it.poster, ref: it }));
  const picked = await fzfPick(picks, {
    prompt: `${name} ❯ `,
    header: `${name} · ${items.length} titles`,
    preview: true,
  });
  if (!picked) return;
  await openManga(
    { id: picked.ref.id, title: picked.ref.title, poster: picked.ref.poster },
    cfg,
    args,
  );
}

async function genreFlow(genreName: string, cfg: Config, args: Args): Promise<void> {
  const filters = await withSpinner("loading genres …", () => getFilters());
  let genre = filters.genres.find((g) => g.name.toLowerCase() === genreName.trim().toLowerCase());
  if (!genre) {
    if (genreName.trim()) console.log(c.yellow(`Unknown genre “${genreName}”. Pick one:`));
    const picked = await fzfPick(
      filters.genres.map((g) => ({ label: c.bold(g.name), g })),
      { prompt: "genre ❯ ", header: "pick a genre" },
    );
    if (!picked) return;
    genre = picked.g;
  }
  const results = await withSpinner(`loading ${genre.name} …`, () =>
    browseByFilter(`genreIds:=${genre!.id}`, { adult: cfg.adult }, "views:desc"),
  );
  if (results.length === 0) {
    console.log(c.yellow(`No manga found in ${genre.name}.`));
    return;
  }
  const items = results.map((r) => ({ label: searchLabel(r), previewUrl: r.poster, ref: r }));
  const picked = await fzfPick(items, {
    prompt: `${genre.name} ❯ `,
    header: `${genre.name} · ${results.length} titles`,
    preview: true,
  });
  if (!picked) return;
  await openManga(
    { id: picked.ref.id, title: picked.ref.title, poster: picked.ref.poster },
    cfg,
    args,
  );
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
