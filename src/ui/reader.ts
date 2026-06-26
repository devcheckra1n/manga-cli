// The terminal manga reader: renders chapter pages with chafa (symbols / kitty /
// iterm protocols), handles raw-mode navigation, prefetch, zoom, dual-page
// spreads, right-to-left reading, and reading-history tracking.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getChapterPages } from "../api/chapter.ts";
import type { MangaInfo, MangaRef, ReadChapter } from "../api/types.ts";
import type { Direction, FitMode } from "../utils/config.ts";
import { cacheImage } from "../utils/image.ts";
import { recordHistory } from "../utils/history.ts";
import { PAGES_DIR } from "../utils/paths.ts";
import { c } from "./colors.ts";
import { chafaFormat, termSize, type ImageProtocol } from "./protocol.ts";

const ESC = "\x1b";
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
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
}

export type ReaderResult = { action: "quit" } | { action: "jump" };

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
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "rerender"
  | "jump"
  | "save"
  | "help"
  | "quit";

function mapKey(raw: string, rtl: boolean): KeyAction | null {
  // Directional keys depend on reading direction. In manga (rtl), the page you
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
    case "\x1b[H":
      return "firstPage";
    case "G":
    case "\x1b[F":
      return "lastPage";
    case "d":
      return "toggleDual";
    case "m":
      return "toggleDirection";
    case "f":
      return "toggleFit";
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

  function rtl(): boolean {
    return direction === "rtl";
  }

  async function loadChapterPages(idx: number): Promise<ReadChapter> {
    const ch = info.chapters[idx];
    if (!ch) throw new Error("Invalid chapter index");
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    process.stdout.write(CLEAR + c.dim(`  loading ${ch.title} …`));
    return getChapterPages(manga.id, ch.id);
  }

  function prefetch(): void {
    const span = ctx.prefetch + (dual ? 1 : 0);
    for (let k = 1; k <= span; k++) {
      const p = chapter.pages[pageIndex + k];
      if (p) void cacheImage(PAGES_DIR, p.url);
    }
  }

  async function recordProgress(): Promise<void> {
    const ch = info.chapters[chapterIndex];
    if (!ch) return;
    await recordHistory({
      id: manga.id,
      title: manga.title,
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

  // Render `path` and place it centered within the cell region whose top-left is
  // (regTop, regLeft) and whose size is regW×regH cells. We render left-aligned at
  // chafa's natural fitted size, read back the real cell dimensions it produced
  // (kitty `c=/r=`, iterm `width=/height=`, or measured lines for symbols), then
  // center the placement ourselves — this is exact in every protocol.
  async function paintImage(
    path: string,
    regTop: number,
    regLeft: number,
    regW: number,
    regH: number,
    fillWidth: boolean,
  ): Promise<void> {
    // "Fill width" lets the page bind on width and overflow vertically; only safe
    // for symbols (we clip rows on placement). Pixel protocols stay region-bounded.
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
      const m =
        head.match(/c=(\d+),r=(\d+)/) ?? head.match(/width=(\d+);height=(\d+)/);
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
    const path = await cacheImage(PAGES_DIR, page.url);
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

    // In rtl the lower page index is read first and sits on the *right*.
    const leftIdx = rtl() ? pageIndex + 1 : pageIndex;
    const rightIdx = rtl() ? pageIndex : pageIndex + 1;
    const leftPage = chapter.pages[leftIdx];
    const rightPage = chapter.pages[rightIdx];

    let ok = true;
    if (leftPage) {
      const path = await cacheImage(PAGES_DIR, leftPage.url);
      if (path) await paintImage(path, regTop, left0, halfW, regH, false);
      else ok = false;
    }
    if (rightPage) {
      const path = await cacheImage(PAGES_DIR, rightPage.url);
      if (path) await paintImage(path, regTop, left0 + halfW, halfW, regH, false);
      else ok = false;
    }
    if (!leftPage && !rightPage) {
      drawCenteredNotice("· no pages ·", c.yellow);
    }
    return ok;
  }

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
    const span = dual && pageIndex + 1 < total ? `${pageIndex + 1}-${pageIndex + 2}` : `${Math.min(pageIndex + 1, total)}`;

    const leftPlain = ` ${span}/${total} `;
    const flags = `${rtl() ? "rtl" : "ltr"}${dual ? " · 2p" : ""}${zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : ""}`;
    let midPlain =
      ch.title && ch.title !== `Chapter ${ch.number}`
        ? `Ch.${ch.number} · ${ch.title}  [${flags}]`
        : `Ch.${ch.number}  [${flags}]`;
    const help = "n/p move · d 2p · m dir · +/- zoom · ? help · q quit";
    const rightPlain = ` ${flash ?? help} `;

    const fixed = leftPlain.length + rightPlain.length + 4;
    if (midPlain.length > cols - fixed) {
      midPlain = midPlain.slice(0, Math.max(0, cols - fixed - 1)) + "…";
    }
    const used = leftPlain.length + 1 + midPlain.length + 1 + rightPlain.length;
    const sep = "─".repeat(Math.max(1, cols - used));

    const right = flash ? c.green(rightPlain) : c.dim(rightPlain);
    const line =
      c.bold(c.violet(leftPlain)) + " " + c.cyan(midPlain) + " " + c.dim(sep) + " " + right;
    process.stdout.write(`${ESC}[${rows};1H${ESC}[2K` + line);
  }

  async function render(flash?: string): Promise<void> {
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    process.stdout.write(CLEAR);
    const showDual = dual && chapter.pages.length > 1;
    if (showDual) await renderDual();
    else await renderSingle();
    drawHud(flash);
  }

  function drawHelp(): void {
    const lines = [
      "  manga-cli reader",
      "  ────────────────",
      `  reading: ${rtl() ? "right-to-left (manga)" : "left-to-right"}`,
      "",
      "  →  ←            turn page (direction-aware)",
      "  n / p           next / previous page",
      "  ] / [           next / previous chapter",
      "  g / G           first / last page",
      "  d               toggle dual-page spread",
      "  m               toggle reading direction",
      "  f               toggle fit (whole page / fill width)",
      "  + / - / 0       zoom in / out / reset",
      "  s               save current page",
      "  r               re-render (after a resize)",
      "  j               back to chapter list",
      "  q / esc         quit",
      "",
      "  press any key …",
    ];
    const { cols, rows } = termSize();
    const startRow = Math.max(1, Math.floor((rows - lines.length) / 2));
    const width = Math.max(...lines.map((l) => l.length));
    const startCol = Math.max(1, Math.floor((cols - width) / 2));
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    process.stdout.write(CLEAR);
    lines.forEach((l, i) => {
      process.stdout.write(`${ESC}[${startRow + i};${startCol}H` + c.cyan(l));
    });
  }

  async function savePage(): Promise<string | null> {
    const page = chapter.pages[pageIndex];
    const ch = info.chapters[chapterIndex];
    if (!page || !ch) return null;
    const path = await cacheImage(PAGES_DIR, page.url);
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

  // ── main loop ──────────────────────────────────────────────────────────────
  process.stdout.write(ALT_ON + HIDE_CURSOR);
  const keys = keyStream();
  let result: ReaderResult = { action: "quit" };

  try {
    await render();
    prefetch();
    await recordProgress();

    while (true) {
      const next = await keys.next();
      if (next.done || next.value === undefined) break;
      const action = mapKey(next.value, rtl());
      if (!action) continue;

      if (action === "quit") {
        result = { action: "quit" };
        break;
      }
      if (action === "jump") {
        result = { action: "jump" };
        break;
      }
      if (action === "help") {
        drawHelp();
        await keys.next(); // any key dismisses
        await render();
        continue;
      }

      let flash: string | undefined;
      const lastPage = chapter.pages.length - 1;
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
          } else {
            flash = "no next chapter";
          }
          break;
        case "prevChapter":
          if (chapterIndex > 0) {
            chapterIndex--;
            chapter = await loadChapterPages(chapterIndex);
            pageIndex = 0;
          } else {
            flash = "no previous chapter";
          }
          break;
        case "firstPage":
          pageIndex = 0;
          break;
        case "lastPage":
          pageIndex = lastSpreadStart(chapter.pages.length);
          break;
        case "toggleDual":
          dual = !dual;
          if (dual) pageIndex -= pageIndex % 2; // align spread to an even page
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
        case "zoomIn":
          zoom = Math.min(1.0, Math.round((zoom + 0.1) * 10) / 10);
          flash = `zoom ${Math.round(zoom * 100)}%`;
          break;
        case "zoomOut":
          zoom = Math.max(0.4, Math.round((zoom - 0.1) * 10) / 10);
          flash = `zoom ${Math.round(zoom * 100)}%`;
          break;
        case "zoomReset":
          zoom = 1.0;
          flash = "zoom 100%";
          break;
        case "save": {
          const dest = await savePage();
          flash = dest ? `saved → ${dest}` : "save failed";
          break;
        }
        case "rerender":
          break;
      }

      await render(flash);
      prefetch();
      await recordProgress();
    }
  } finally {
    await keys.return(undefined);
    if (protocol === "kitty") process.stdout.write(KITTY_DELETE_ALL);
    process.stdout.write(SHOW_CURSOR + ALT_OFF);
  }

  return result;
}
