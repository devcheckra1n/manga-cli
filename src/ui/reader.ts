// The terminal manga reader: renders chapter pages with chafa (symbols / kitty /
// iterm protocols), handles raw-mode navigation, prefetch, zoom, dual-page
// spreads, right-to-left reading, long-strip (webtoon) scrolling, following,
// reading-history tracking, and works against both the live API and local files.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getChapterPages } from "../api/chapter.ts";
import type { Chapter, MangaInfo, MangaRef, Page, ReadChapter } from "../api/types.ts";
import type { Direction, FitMode } from "../utils/config.ts";
import { cacheImage } from "../utils/image.ts";
import { recordHistory } from "../utils/history.ts";
import { isFollowed, toggleFollow } from "../utils/follows.ts";
import { PAGES_DIR } from "../utils/paths.ts";
import { c } from "./colors.ts";
import { chafaFormat, termSize, type ImageProtocol } from "./protocol.ts";
import { enterAltScreen, leaveAltScreen } from "./term.ts";

const ESC = "\x1b";
const CLEAR = `${ESC}[2J${ESC}[H`;
const KITTY_DELETE_ALL = `${ESC}_Ga=d,d=A${ESC}\\`; // clear all kitty images (anti-ghosting)

export interface ReaderContext {
  manga: MangaRef;
  info: MangaInfo;
  /** Array index into info.chapters (which is ascending by number). */
  startChapterIndex: number;
  startPage: number;
  protocol: ImageProtocol;
  prefetch: number;
  downloadDir: string;
  direction: Direction;
  dualPage: boolean;
  fit: FitMode;
  zoom: number;
  hudReserve: number;
  /** Start in long-strip (webtoon) scroll mode. Auto-set for forceStrip titles. */
  webtoon?: boolean;
  /** Disable following (e.g. local library has no online id). */
  noFollow?: boolean;
  /** Override page loading (e.g. read from a local CBZ instead of the API). */
  loadChapter?: (chapterIndex: number) => Promise<ReadChapter>;
}

export type ReaderResult = { action: "quit" } | { action: "jump" } | { action: "menu" };

type KeyAction =
  | "next"
  | "prev"
  | "nextChapter"
  | "prevChapter"
  | "firstPage"
  | "lastPage"
  | "toggleDual"
  | "toggleDirection"
  | "toggleFit"
  | "toggleWebtoon"
  | "toggleFollow"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "rerender"
  | "jump"
  | "menu"
  | "save"
  | "gotoPage"
  | "help"
  | "quit";

function mapKey(raw: string, rtl: boolean): KeyAction | null {
  // Vertical arrows always mean next/prev (intuitive in both page and strip mode).
  if (raw === "\x1b[B" || raw === "\x1bOB") return "next";
  if (raw === "\x1b[A" || raw === "\x1bOA") return "prev";
  // Horizontal keys depend on reading direction. In manga (rtl), the page you
  // turn *to* is physically on the left, so the left arrow advances.
  const physRight = raw === "\x1b[C" || raw === "\x1bOC" || raw === "l";
  const physLeft = raw === "\x1b[D" || raw === "\x1bOD" || raw === "h";
  if (physRight) return rtl ? "prev" : "next";
  if (physLeft) return rtl ? "next" : "prev";

  switch (raw) {
    case "n":
    case " ":
    case "\r":
    case "\n":
      return "next";
    case "p":
      return "prev";
    case "]":
      return "nextChapter";
    case "[":
      return "prevChapter";
    case "g":
      return "firstPage";
    case "G":
      return "lastPage";
    case "d":
      return "toggleDual";
    case "t":
      return "toggleDirection";
    case "m":
      return "menu";
    case "f":
      return "toggleFit";
    case "w":
      return "toggleWebtoon";
    case "b":
      return "toggleFollow";
    case "+":
    case "=":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    case "0":
      return "zoomReset";
    case "r":
      return "rerender";
    case "j":
      return "jump";
    case "s":
      return "save";
    case ":":
    case "#":
      return "gotoPage";
    case "?":
      return "help";
    case "q":
    case "\x1b":
    case "\x03": // Ctrl-C
      return "quit";
    default:
      return null;
  }
}

async function* keyStream(): AsyncGenerator<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const onData = (buf: Buffer): void => {
    queue.push(buf.toString("utf8"));
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };
  stdin.on("data", onData);
  try {
    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((res) => {
          wake = res;
        });
      }
      while (queue.length > 0) {
        yield queue.shift() as string;
      }
    }
  } finally {
    stdin.off("data", onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  }
}

function sanitizeFilename(s: string): string {
  const cleaned = s.replace(/[/\\:*?"<>|]+/g, "_").trim().slice(0, 80);
  return cleaned || "manga";
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Local path for a page — a local file (offline library) or the cached download. */
async function pagePath(page: Page): Promise<string | null> {
  if (page.url.startsWith("file://")) return decodeURIComponent(page.url.slice(7));
  return cacheImage(PAGES_DIR, page.url);
}

export async function runReader(ctx: ReaderContext): Promise<ReaderResult> {
  const { info, manga, protocol } = ctx;
  const fmt = chafaFormat(protocol);

  // Mutable view state (some are toggled live with keys).
  let chapterIndex = Math.min(Math.max(0, ctx.startChapterIndex), info.chapters.length - 1);
  let chapter = await loadChapterPages(chapterIndex);
  let pageIndex = Math.min(Math.max(0, ctx.startPage), Math.max(0, chapter.pages.length - 1));
  let direction: Direction = ctx.direction;
  let dual = ctx.dualPage;
  let fit: FitMode = ctx.fit;
  let zoom = ctx.zoom;
  let webtoon = ctx.webtoon ?? false;
  let followed = ctx.noFollow ? false : await isFollowed(manga.id);

  // Go-to-page input state (captures digits typed after ':').
  let gotoMode = false;
  let gotoBuf = "";

  // Webtoon (long-strip) scroll state.
  let scrollOff = 0; // line offset within the current page's rendered strip
  let webtoonMax = 0; // last computed max scroll offset (for nav decisions)
  const lineCache = new Map<string, string[]>(); // `${pageId}@${width}` -> symbol lines

  function rtl(): boolean {
    return direction === "rtl";
  }

  function drawLoading(ch: Chapter): void {
    const { cols, rows } = termSize();
    const name = ch.title && ch.title !== `Chapter ${ch.number}` ? ch.title : `Chapter ${ch.number}`;
    const t1 = manga.title.length > cols - 4 ? manga.title.slice(0, Math.max(1, cols - 5)) + "…" : manga.title;
    const t2 = `${name} · loading …`;
    const row = Math.max(1, Math.floor(rows / 2) - 1);
    const col1 = Math.max(1, Math.floor((cols - t1.length) / 2) + 1);
    const col2 = Math.max(1, Math.floor((cols - t2.length) / 2) + 1);
    process.stdout.write(
      CLEAR + `${ESC}[${row};${col1}H` + c.bold(c.violet(t1)) + `${ESC}[${row + 2};${col2}H` + c.dim(t2),
    );
  }

  async function loadChapterPages(idx: number): Promise<ReadChapter> {
    const ch = info.chapters[idx];
    if (!ch) throw new Error("Invalid chapter index");
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    drawLoading(ch);
    return ctx.loadChapter ? ctx.loadChapter(idx) : getChapterPages(manga.id, ch.id);
  }

  function prefetch(): void {
    if (webtoon) return; // strips are rendered+cached on demand
    const span = ctx.prefetch + (dual ? 1 : 0);
    for (let k = 1; k <= span; k++) {
      const p = chapter.pages[pageIndex + k];
      if (p) void pagePath(p);
    }
  }

  async function recordProgress(): Promise<void> {
    const ch = info.chapters[chapterIndex];
    if (!ch || ctx.noFollow) return;
    await recordHistory({
      id: manga.id,
      title: manga.title,
      source: manga.source,
      coverUrl: manga.poster,
      lastChapterId: ch.id,
      lastChapterNumber: ch.number,
      lastChapterTitle: ch.title,
      lastChapterIndex: chapterIndex,
      lastPage: pageIndex,
      totalChapters: info.chapters.length,
      lastReadAt: new Date().toISOString(),
    });
  }

  // ── page-mode rendering ─────────────────────────────────────────────────────

  async function paintImage(
    path: string,
    regTop: number,
    regLeft: number,
    regW: number,
    regH: number,
    fillWidth: boolean,
  ): Promise<void> {
    const heightCells = fillWidth && fmt === "symbols" ? regH * 12 : regH;
    const proc = Bun.spawn(
      ["chafa", "-f", fmt, "--size", `${regW}x${heightCells}`, "--align", "left,top", "--animate", "off", path],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout).arrayBuffer();
    await proc.exited;

    if (fmt === "symbols") {
      const lines = new TextDecoder().decode(out).split("\n");
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      const shown = lines.slice(0, regH);
      let maxw = 0;
      for (const ln of shown) maxw = Math.max(maxw, Array.from(stripAnsi(ln)).length);
      const col1 = regLeft + Math.max(0, Math.floor((regW - maxw) / 2));
      const row1 = regTop + Math.max(0, Math.floor((regH - shown.length) / 2));
      let buf = "";
      for (let r = 0; r < shown.length; r++) buf += `${ESC}[${row1 + r};${col1}H` + shown[r];
      process.stdout.write(buf);
    } else {
      const head = new TextDecoder().decode(out.slice(0, 256));
      const m = head.match(/c=(\d+),r=(\d+)/) ?? head.match(/width=(\d+);height=(\d+)/);
      const cells = m ? Number(m[1]) : regW;
      const rowsTall = m ? Number(m[2]) : regH;
      const col1 = regLeft + Math.max(0, Math.floor((regW - cells) / 2));
      const row1 = regTop + Math.max(0, Math.floor((regH - rowsTall) / 2));
      process.stdout.write(`${ESC}[${row1};${col1}H`);
      process.stdout.write(new Uint8Array(out));
    }
  }

  async function renderSingle(): Promise<boolean> {
    const { cols, rows } = termSize();
    const availH = Math.max(1, rows - ctx.hudReserve);
    const page = chapter.pages[pageIndex];
    if (!page) {
      drawCenteredNotice("· no pages in this chapter ·", c.yellow);
      return true;
    }
    const path = await pagePath(page);
    if (!path) {
      drawCenteredNotice("⚠  page failed to load — press r to retry", c.yellow);
      return false;
    }
    const regW = Math.max(8, Math.round(cols * zoom));
    const regH = Math.max(4, Math.round(availH * zoom));
    const regLeft = Math.max(1, Math.floor((cols - regW) / 2) + 1);
    const regTop = Math.max(1, Math.floor((availH - regH) / 2) + 1);
    await paintImage(path, regTop, regLeft, regW, regH, fit === "width");
    return true;
  }

  async function renderDual(): Promise<boolean> {
    const { cols, rows } = termSize();
    const availH = Math.max(1, rows - ctx.hudReserve);
    const regH = Math.max(4, Math.round(availH * zoom));
    const totalW = Math.max(16, Math.round(cols * zoom));
    const halfW = Math.floor(totalW / 2);
    const left0 = Math.max(1, Math.floor((cols - halfW * 2) / 2) + 1);
    const regTop = Math.max(1, Math.floor((availH - regH) / 2) + 1);

    const leftIdx = rtl() ? pageIndex + 1 : pageIndex;
    const rightIdx = rtl() ? pageIndex : pageIndex + 1;
    const leftPage = chapter.pages[leftIdx];
    const rightPage = chapter.pages[rightIdx];

    let ok = true;
    if (leftPage) {
      const path = await pagePath(leftPage);
      if (path) await paintImage(path, regTop, left0, halfW, regH, false);
      else ok = false;
    }
    if (rightPage) {
      const path = await pagePath(rightPage);
      if (path) await paintImage(path, regTop, left0 + halfW, halfW, regH, false);
      else ok = false;
    }
    if (!leftPage && !rightPage) drawCenteredNotice("· no pages ·", c.yellow);
    return ok;
  }

  // ── webtoon (long-strip) rendering ──────────────────────────────────────────

  async function renderPageLines(page: Page, width: number): Promise<string[] | null> {
    const key = `${page.id}@${width}`;
    const cached = lineCache.get(key);
    if (cached) return cached;
    const path = await pagePath(page);
    if (!path) return null;
    drawCenteredNotice("rendering strip …", c.dim);
    // Width-bound symbol render of the (very tall) strip → many lines we scroll through.
    const proc = Bun.spawn(
      ["chafa", "-f", "symbols", "--size", `${width}x100000`, "--align", "left,top", "--animate", "off", path],
      { stdout: "pipe", stderr: "ignore" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const lines = text.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lineCache.set(key, lines);
    if (lineCache.size > 12) lineCache.delete(lineCache.keys().next().value as string);
    return lines;
  }

  async function renderWebtoon(flash?: string): Promise<void> {
    const { cols, rows } = termSize();
    const availH = Math.max(1, rows - ctx.hudReserve);
    const width = Math.max(8, Math.round(cols * zoom));
    process.stdout.write(CLEAR);
    const page = chapter.pages[pageIndex];
    if (!page) {
      drawCenteredNotice("· no pages ·", c.yellow);
      drawHud(flash);
      return;
    }
    const lines = await renderPageLines(page, width);
    process.stdout.write(CLEAR);
    if (!lines) {
      drawCenteredNotice("⚠  strip failed to render — press r", c.yellow);
      drawHud(flash);
      return;
    }
    webtoonMax = Math.max(0, lines.length - availH);
    scrollOff = Math.min(Math.max(0, scrollOff), webtoonMax);
    const col1 = Math.max(1, Math.floor((cols - width) / 2) + 1);
    let buf = "";
    for (let r = 0; r < availH; r++) {
      const ln = lines[scrollOff + r];
      if (ln === undefined) break;
      buf += `${ESC}[${r + 1};${col1}H` + ln;
    }
    process.stdout.write(buf);
    drawHud(flash);
  }

  // ── shared HUD / notices ────────────────────────────────────────────────────

  function drawCenteredNotice(msg: string, color: (s: string) => string): void {
    const { cols, rows } = termSize();
    const row = Math.max(1, Math.floor(rows / 2));
    const col = Math.max(1, Math.floor((cols - msg.length) / 2));
    process.stdout.write(`${ESC}[${row};${col}H` + color(msg));
  }

  function drawHud(flash?: string): void {
    const { cols, rows } = termSize();
    const ch = info.chapters[chapterIndex];
    if (!ch) return;
    const total = chapter.pages.length;

    // Position, mode flags and chapter progress (the scrubber fraction).
    let pos: string;
    let flags: string;
    let frac: number;
    if (webtoon) {
      const scroll = webtoonMax > 0 ? scrollOff / webtoonMax : 1;
      frac = total > 0 ? Math.min(1, (pageIndex + scroll) / total) : 1;
      pos = `p${pageIndex + 1}/${total}`;
      flags = `strip ${Math.round(frac * 100)}%`;
      if (zoom !== 1) flags += ` · ${Math.round(zoom * 100)}%`;
    } else {
      frac = total > 1 ? Math.min(1, pageIndex / (total - 1)) : 1;
      const span =
        dual && pageIndex + 1 < total ? `${pageIndex + 1}·${pageIndex + 2}` : `${Math.min(pageIndex + 1, total)}`;
      pos = `${span}/${total}`;
      flags = rtl() ? "rtl" : "ltr";
      if (dual) flags += " · 2p";
      if (fit === "width") flags += " · fit:w";
      if (zoom !== 1) flags += ` · ${Math.round(zoom * 100)}%`;
    }

    const leftPlain = ` ${pos} `;
    const heartPlain = followed ? "♥ " : "";
    let midPlain =
      ch.title && ch.title !== `Chapter ${ch.number}` ? `Ch.${ch.number} · ${ch.title}` : `Ch.${ch.number}`;
    const rightPlain = ` ${flash ?? `${flags} · ? help`} `;

    // Segments: [left] [heart+mid] [scrubber] [right], single spaces between.
    // Truncate the title before squeezing the scrubber below its minimum.
    const MIN_BAR = 6;
    const fixed = leftPlain.length + heartPlain.length + rightPlain.length + 3;
    const maxMid = cols - fixed - MIN_BAR;
    if (midPlain.length > maxMid) midPlain = midPlain.slice(0, Math.max(0, maxMid - 1)) + "…";
    const barW = Math.max(MIN_BAR, cols - fixed - midPlain.length);

    // A slim scrubber: read progress ━━━╸ over the remaining track ───.
    const knob = Math.max(0, Math.min(barW - 1, Math.round(frac * (barW - 1))));
    const bar = c.cyan("━".repeat(knob) + "╸") + c.dim("─".repeat(barW - knob - 1));

    const line =
      c.bold(c.violet(leftPlain)) +
      " " +
      (heartPlain ? c.pink(heartPlain) : "") +
      c.cyan(midPlain) +
      " " +
      bar +
      " " +
      (flash ? c.green(rightPlain) : c.dim(rightPlain));
    process.stdout.write(`${ESC}[${rows};1H${ESC}[2K` + line);
  }

  async function render(flash?: string): Promise<void> {
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    if (webtoon) {
      await renderWebtoon(flash);
      return;
    }
    process.stdout.write(CLEAR);
    if (dual && chapter.pages.length > 1) await renderDual();
    else await renderSingle();
    drawHud(flash);
  }

  function drawHelp(): void {
    const mode = webtoon ? "long-strip" : rtl() ? "right-to-left" : "left-to-right";
    const keys: Array<[string, string]> = [
      [webtoon ? "↑ ↓ / space" : "→ ← / space", webtoon ? "scroll the strip" : "turn page (direction-aware)"],
      ["n / p", "next / previous page"],
      ["] / [", "next / previous chapter"],
      ["g / G", "first / last page"],
      [": or #", "go to page — type a number, Enter"],
      ["w", "toggle long-strip (webtoon) mode"],
      ["d", "toggle dual-page spread"],
      ["t", "toggle reading direction"],
      ["f", "toggle fit (whole page / fill width)"],
      ["+ - 0", "zoom in / out / reset"],
      ["b", "follow / unfollow this series"],
      ["s", "save current page"],
      ["r", "re-render (after a resize)"],
      ["j", "back to the chapter list"],
      ["m", "back to the main menu"],
      ["q / esc", "quit the reader"],
    ];
    const keyW = Math.max(...keys.map(([k]) => k.length));
    const descW = Math.max(...keys.map(([, d]) => d.length));
    const innerW = 2 + keyW + 3 + descW + 2;

    const label = ` reader · ${mode} `;
    const foot = ` any key to close `;
    const box: string[] = [
      c.dim("╭─╴") + c.violet(label) + c.dim("╶" + "─".repeat(Math.max(0, innerW - label.length - 3)) + "╮"),
      ...keys.map(
        ([k, d]) =>
          c.dim("│") + "  " + c.bold(c.cyan(k.padEnd(keyW))) + "   " + d.padEnd(descW) + "  " + c.dim("│"),
      ),
      c.dim("╰─╴" + foot + "╶" + "─".repeat(Math.max(0, innerW - foot.length - 3)) + "╯"),
    ];

    const { cols, rows } = termSize();
    const startRow = Math.max(1, Math.floor((rows - box.length) / 2));
    const startCol = Math.max(1, Math.floor((cols - (innerW + 2)) / 2));
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    process.stdout.write(CLEAR);
    box.forEach((l, i) => {
      process.stdout.write(`${ESC}[${startRow + i};${startCol}H` + l);
    });
  }

  async function savePage(): Promise<string | null> {
    const page = chapter.pages[pageIndex];
    const ch = info.chapters[chapterIndex];
    if (!page || !ch) return null;
    const path = await pagePath(page);
    if (!path) return null;
    try {
      const dir = join(ctx.downloadDir, sanitizeFilename(manga.title));
      await mkdir(dir, { recursive: true });
      const dest = join(dir, `ch${ch.number}_p${pageIndex + 1}.webp`);
      await Bun.write(dest, Bun.file(path));
      return dest;
    } catch {
      return null;
    }
  }

  function step(): number {
    return dual ? 2 : 1;
  }
  function lastSpreadStart(len: number): number {
    if (len <= 0) return 0;
    const last = len - 1;
    return dual ? last - (last % 2) : last;
  }
  function scrollStep(): number {
    const { rows } = termSize();
    return Math.max(1, rows - ctx.hudReserve - 3);
  }

  // ── main loop ──────────────────────────────────────────────────────────────
  enterAltScreen();
  const keys = keyStream();
  let result: ReaderResult = { action: "quit" };

  try {
    await render();
    prefetch();
    await recordProgress();

    while (true) {
      const next = await keys.next();
      if (next.done || next.value === undefined) break;
      const raw = next.value;

      // While entering a page number, capture digits until Enter / Esc.
      if (gotoMode) {
        if (raw === "\r" || raw === "\n") {
          gotoMode = false;
          const total = chapter.pages.length;
          const n = parseInt(gotoBuf, 10);
          if (Number.isFinite(n) && n >= 1 && total > 0) {
            const target = Math.min(Math.max(0, n - 1), total - 1);
            pageIndex = dual ? target - (target % 2) : target;
            scrollOff = 0;
            await render(`→ page ${target + 1}/${total}`);
            await recordProgress();
          } else {
            await render();
          }
        } else if (raw === "\x1b" || raw === "\x03" || raw === "q") {
          gotoMode = false;
          drawHud();
        } else {
          if (raw === "\x7f" || raw === "\b") gotoBuf = gotoBuf.slice(0, -1);
          else if (/^[0-9]$/.test(raw)) gotoBuf = (gotoBuf + raw).slice(0, 6);
          drawHud(`go to page (1-${chapter.pages.length}): ${gotoBuf}▏`);
        }
        continue;
      }

      const action = mapKey(raw, rtl());
      if (!action) continue;

      if (action === "quit") {
        result = { action: "quit" };
        break;
      }
      if (action === "jump") {
        result = { action: "jump" };
        break;
      }
      if (action === "menu") {
        result = { action: "menu" };
        break;
      }
      if (action === "gotoPage") {
        gotoMode = true;
        gotoBuf = "";
        drawHud(`go to page (1-${chapter.pages.length}): ▏`);
        continue;
      }
      if (action === "help") {
        drawHelp();
        await keys.next();
        await render();
        continue;
      }

      let flash: string | undefined;
      const lastPage = chapter.pages.length - 1;

      // Webtoon navigation reinterprets next/prev as scroll.
      if (webtoon && (action === "next" || action === "prev")) {
        if (action === "next") {
          if (scrollOff < webtoonMax) {
            scrollOff = Math.min(scrollOff + scrollStep(), webtoonMax);
          } else if (pageIndex < lastPage) {
            pageIndex++;
            scrollOff = 0;
          } else if (chapterIndex < info.chapters.length - 1) {
            chapterIndex++;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = 0;
            scrollOff = 0;
          } else {
            flash = "✓ end of latest chapter";
          }
        } else {
          if (scrollOff > 0) {
            scrollOff = Math.max(0, scrollOff - scrollStep());
          } else if (pageIndex > 0) {
            pageIndex--;
            scrollOff = Number.MAX_SAFE_INTEGER; // clamped to the bottom on render
          } else if (chapterIndex > 0) {
            chapterIndex--;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = chapter.pages.length - 1;
            scrollOff = Number.MAX_SAFE_INTEGER;
          } else {
            flash = "start of first chapter";
          }
        }
        await render(flash);
        await recordProgress();
        continue;
      }

      const atEnd = pageIndex >= lastPage - (dual ? 1 : 0);

      switch (action) {
        case "next":
          if (!atEnd) {
            pageIndex = Math.min(pageIndex + step(), lastPage);
          } else if (chapterIndex < info.chapters.length - 1) {
            chapterIndex++;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = 0;
          } else {
            flash = "✓ end of latest chapter";
          }
          break;
        case "prev":
          if (pageIndex > 0) {
            pageIndex = Math.max(0, pageIndex - step());
          } else if (chapterIndex > 0) {
            chapterIndex--;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = lastSpreadStart(chapter.pages.length);
          } else {
            flash = "start of first chapter";
          }
          break;
        case "nextChapter":
          if (chapterIndex < info.chapters.length - 1) {
            chapterIndex++;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = 0;
            scrollOff = 0;
          } else {
            flash = "no next chapter";
          }
          break;
        case "prevChapter":
          if (chapterIndex > 0) {
            chapterIndex--;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = 0;
            scrollOff = 0;
          } else {
            flash = "no previous chapter";
          }
          break;
        case "firstPage":
          pageIndex = 0;
          scrollOff = 0;
          break;
        case "lastPage":
          pageIndex = lastSpreadStart(chapter.pages.length);
          scrollOff = 0;
          break;
        case "toggleWebtoon":
          webtoon = !webtoon;
          scrollOff = 0;
          flash = webtoon ? "long-strip mode" : "page mode";
          break;
        case "toggleDual":
          dual = !dual;
          if (dual) pageIndex -= pageIndex % 2;
          flash = dual ? "dual-page on" : "single-page";
          break;
        case "toggleDirection":
          direction = rtl() ? "ltr" : "rtl";
          flash = `reading ${direction === "rtl" ? "right-to-left" : "left-to-right"}`;
          break;
        case "toggleFit":
          fit = fit === "page" ? "width" : "page";
          flash = fit === "width" ? "fit: fill width" : "fit: whole page";
          break;
        case "toggleFollow":
          if (ctx.noFollow) {
            flash = "following not available here";
          } else {
            followed = await toggleFollow({
              id: manga.id,
              title: manga.title,
              source: manga.source,
              coverUrl: manga.poster,
              chapterCount: info.chapters.length,
            });
            flash = followed ? "♥ following" : "unfollowed";
          }
          break;
        case "zoomIn":
          zoom = Math.min(1.0, Math.round((zoom + 0.1) * 10) / 10);
          if (webtoon) lineCache.clear();
          flash = `zoom ${Math.round(zoom * 100)}%`;
          break;
        case "zoomOut":
          zoom = Math.max(0.4, Math.round((zoom - 0.1) * 10) / 10);
          if (webtoon) lineCache.clear();
          flash = `zoom ${Math.round(zoom * 100)}%`;
          break;
        case "zoomReset":
          zoom = 1.0;
          if (webtoon) lineCache.clear();
          flash = "zoom 100%";
          break;
        case "save": {
          const dest = await savePage();
          flash = dest ? `saved → ${dest}` : "save failed";
          break;
        }
        case "rerender":
          if (webtoon) lineCache.clear();
          break;
      }

      await render(flash);
      prefetch();
      await recordProgress();
    }
  } finally {
    await keys.return(undefined);
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    leaveAltScreen();
  }

  return result;
}
