# manga-cli

A fast, lightweight **terminal manga reader** for [atsu.moe](https://atsu.moe) —
[ani-cli](https://github.com/pystardust/ani-cli) energy, but for manga, and prettier.
Search, browse, and read manga inline in your terminal with real image rendering.

```
 ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗  █████╗
 ████╗ ████║██╔══██╗████╗  ██║██╔════╝ ██╔══██╗
 ██╔████╔██║███████║██╔██╗ ██║██║  ███╗███████║
 ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║
 ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║
 ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝
          ██████╗██╗     ██╗
         ██╔════╝██║     ██║
         ╚██████╗███████╗██║   terminal manga reader · atsu.moe
          ╚═════╝╚══════╝╚═╝
```

## Features

- 🔎 **Fuzzy search** with cover-art previews (via `fzf` + `chafa`)
- 📈 **Discovery feeds** — trending, popular, latest updates
- 🏷️ **Genre browsing**
- 🖼️ **Pixel-perfect inline reading** on capable terminals (Ghostty, kitty, WezTerm,
  iTerm2) with graceful fallback to colored ASCII everywhere else
- 📚 **Right-to-left reading** (manga default), **two-page spreads**, and
  **long-strip / webtoon** scrolling (auto-detected for manhwa)
- 🔍 **Live zoom & fit controls** for different render resolutions
- ⬇️ **Download chapters** as **CBZ**, **ZIP**, **PDF**, or plain images — multi-select or by range
- 📂 **Offline library** — read everything you've downloaded with no network
- ❤️ **Follow series** and see new-chapter **updates** at a glance
- ✨ **Recommendations** — "more like this" for any title
- 📊 **Reading stats** — your manga "wrapped", all local
- ⚡ **Feels instant** — aggressive disk caching + background page prefetch
- 📖 **Reading history** with `--continue` to pick up exactly where you left off
- 🪶 **Lean** — Bun + TypeScript, zero runtime npm dependencies (just `fzf` + `chafa`)

> Spiritual successor energy to the wonderful (now archived) [Mangal](https://github.com/metafates/mangal):
> a slick downloader **and** a real inline reader, in one lean binary.

## Install

### 1. Prerequisites

[Bun](https://bun.sh) (runtime) plus two small CLI tools:

| Platform | Command |
|----------|---------|
| macOS (Homebrew) | `brew install fzf chafa` |
| Debian / Ubuntu | `sudo apt install fzf chafa` |
| Fedora / RHEL | `sudo dnf install fzf chafa` |
| Arch | `sudo pacman -S fzf chafa` |

`manga-cli` detects missing tools at startup and prints the right command for your system.

### 2. Get the code

```bash
git clone <this-repo> manga-cli && cd manga-cli
bun install
bun run src/index.ts --help
```

### 3. Install the `manga-cli` command

Compile a standalone binary straight onto your `PATH`:

```bash
bun run install:bin    # -> ~/.bun/bin/manga-cli  (already on PATH if you use Bun)
manga-cli --help
```

Or build it locally and place it wherever you like:

```bash
bun run build                       # -> dist/manga-cli
cp dist/manga-cli /usr/local/bin/   # now run `manga-cli` from anywhere
```

## Usage

```
manga-cli [flags] [query]

  -s, --search <query>    search and pick a manga
  -c, --continue          resume your last-read manga
  -H, --history           browse reading history
  -t, --trending          show trending manga
  -p, --popular           show popular manga
  -l, --latest            show latest updates
  -g, --genre <genre>     browse by genre
  -r, --recommended [q]   "more like this" — recommendations for a title
      --follow [query]    follow a series for new-chapter updates
  -u, --updates           show followed series that have new chapters
      --library           browse & read your downloads offline
      --stats             your reading stats / "wrapped"
  -d, --download <query>  download chapters (CBZ / ZIP / PDF / images)
  -f, --format <fmt>      download format: cbz · zip · pdf · images
      --chapters <spec>   pick chapters non-interactively: 1-10 · 1,3,5 · all · latest
      --out <dir>         download into <dir> (overrides config)
      where               print config / cache / download paths
      --dual              open in two-page (spread) mode
      --webtoon           long-strip scroll mode (auto-detected for manhwa)
      --single            force single-page mode
      --rtl / --ltr       reading direction (manga is rtl, the default)
      --browser           open in your web browser instead of the terminal
      --adult             include 18+ results for this run
      --no-banner         skip the ASCII banner
      --debug             log API requests to stderr
  -v, --version           print version
  -h, --help, help        print help
```

With no flags it shows the banner and drops into interactive search.

```bash
manga-cli berserk      # quick search
manga-cli -t           # what's trending
manga-cli -g action    # browse action manga
manga-cli -c           # continue reading
```

## Downloading

Borrowed from [Mangal](https://github.com/metafates/mangal): grab chapters to read
offline or load into your library (Komga, Tachiyomi/Mihon, YACReader, …).

```bash
manga-cli -d berserk                          # search, multi-select chapters (Tab), download as CBZ
manga-cli -d berserk --chapters 1-10          # chapters 1–10
manga-cli -d "one piece" --chapters latest -f pdf   # newest chapter, as a PDF
manga-cli -d vagabond --chapters all -f cbz --out ~/manga
```

In the interactive chapter list, **Tab** toggles a chapter and **Enter** downloads the
selection; already-downloaded chapters are marked ✓. `--chapters` accepts ranges
(`1-10`), lists (`1,3,5`), `all`, `first`, or `latest`.

| Format | Output | Notes |
|--------|--------|-------|
| `cbz` *(default)* | `<Title>/<Title> - 0007 Ch.7.cbz` | standard comic archive; opens everywhere |
| `zip` | `… .zip` | same as CBZ with a `.zip` extension |
| `images` | `…/0007 Ch.7/001.webp …` | raw page files in a folder |
| `pdf` | `… .pdf` | needs an image converter — uses `sips` (preinstalled on macOS) or ImageMagick |

Files land in `downloadDir` (`~/Downloads/manga-cli` by default). Run `manga-cli where`
to see all paths.

## Follow, discover & track

```bash
manga-cli --follow berserk    # follow a series (remembers the chapter count)
manga-cli -u                  # which followed titles have new chapters (+N badges)
manga-cli -r                  # recommendations based on your last read
manga-cli -r "chainsaw man"   # "more like this" for a specific title
manga-cli --library           # browse & read your downloads — fully offline
manga-cli --stats             # your reading "wrapped": streaks, top titles, weekly chart
```

- **Following is local** — no account needed. `--updates` re-checks followed titles and
  badges the ones with new chapters; press **`b`** in the reader to follow/unfollow.
- **`--library`** reads downloaded CBZ/ZIP/folders back through the same reader, with
  zero network. (PDF downloads are for your viewer; the library reads image archives.)
- **`--stats`** is computed entirely from your local history — nothing leaves your machine.

## Long-strip (webtoon) mode

Manhwa/manhua pages are single images thousands of pixels tall, so manga-cli has a
**vertical scroll** mode: scroll with `↑`/`↓`/`space` instead of flipping pages. It's
**auto-enabled** for long-strip titles, or toggle it anytime with **`w`** (or start with
`--webtoon`). Long-strip rendering uses high-density colored symbols so it works in every
terminal.

## Reader controls

| Key | Action |
|-----|--------|
| `→` · `←` | turn page — **direction-aware** (in RTL manga, `←` advances) |
| `n` · `space` | next page |
| `p` | previous page |
| `]` · `[` | next / previous chapter |
| `g` · `G` | first / last page |
| `↑` · `↓` | scroll (in long-strip / webtoon mode) |
| `w` | toggle long-strip (webtoon) scrolling |
| `d` | toggle two-page spread |
| `m` | toggle reading direction (RTL ⇄ LTR) |
| `f` | toggle fit (whole page ⇄ fill width) |
| `b` | follow / unfollow this series |
| `+` · `-` · `0` | zoom in / out / reset |
| `s` | save current page to your downloads dir |
| `r` | re-render (after a terminal resize) |
| `j` | back to the chapter list |
| `?` | show keybindings |
| `q` · `esc` | quit the reader |

Reading is **right-to-left by default** (it's manga). Pass `--ltr` or press `m` for
comics/webtoons. Toggle spreads live with `d` or start in spread mode with `--dual`.

## How it renders images

At startup the reader picks the best inline-image protocol for your terminal:

| Terminal | Protocol | Result |
|----------|----------|--------|
| Ghostty, kitty, WezTerm, Konsole | Kitty graphics | pixel-perfect |
| iTerm2 | iTerm inline images (OSC 1337) | pixel-perfect |
| Alacritty, xterm, plain TTY, … | chafa symbols | colored ASCII blocks |

All three are driven through `chafa` (which decodes the WebP pages and emits the
native protocol), so rendering is consistent and robust. Override the auto-detection
with `readerMode` in the config if you like.

> **tmux:** Kitty-protocol images work cleanly inside tmux on Ghostty. On other
> terminals you may see artifacts — set `readerMode: "chafa"` if so.

## Configuration

`~/.config/manga-cli/config.json` (XDG-aware; `$XDG_CONFIG_HOME` respected):

```json
{
  "source": "atsumaru",
  "readerMode": "auto",
  "direction": "rtl",
  "dualPage": false,
  "fit": "page",
  "zoom": 1.0,
  "hudReserve": 2,
  "downloadFormat": "cbz",
  "chafaSize": "auto",
  "prefetchPages": 2,
  "showBanner": true,
  "adult": false,
  "fzfArgs": "",
  "downloadDir": "~/Downloads/manga-cli/"
}
```

- `readerMode`: `"auto"` (detect) · `"kitty"` · `"iterm2"` · `"chafa"`
- `direction`: `"rtl"` (manga) · `"ltr"` (comics/webtoons)
- `dualPage`: start in two-page spread mode
- `fit`: `"page"` (whole page) · `"width"` (fill width)
- `zoom`: render scale `0.4`–`1.0` (lower = smaller/lower-res, more margin)
- `hudReserve`: rows kept clear at the bottom for the status bar
- `downloadFormat`: default for `--download` — `"cbz"` · `"zip"` · `"pdf"` · `"images"`
- `prefetchPages`: how many upcoming pages to fetch in the background

### Cache & data

- `~/.cache/manga-cli/` — covers, page images, extracted archives, and TTL'd API
  responses (`$XDG_CACHE_HOME` respected). Safe to delete anytime.
- `~/.config/manga-cli/history.json` — reading history.
- `~/.config/manga-cli/follows.json` — followed series (for `--updates`).

## Architecture

```
src/
├── api/        atsu.moe client (search, manga, chapters, recommendations) + endpoints.md
├── ui/         banner, fzf menu, reader (page + webtoon), spinner, terminal detection
├── utils/      config, cache, history, follows, library, stats, image, download, paths
└── index.ts    CLI parsing + flows
```

See [`src/api/endpoints.md`](src/api/endpoints.md) for the reverse-engineered API reference.

## Troubleshooting

- **Can't reach atsu.moe?** The site sits behind Cloudflare and blocks some ISPs.
  Try `1.1.1.1` DNS or a VPN. Run with `--debug` to see the exact requests.
- **Images look like ASCII soup on a capable terminal?** You may be in tmux or your
  `$TERM` isn't being detected — set `readerMode` explicitly in the config.
- **`fzf`/`chafa` not found?** Install them (see above); the tool prints the command.

## Notes

- The Typesense search key is **not** needed — search is proxied same-origin and
  the backend injects the key, so there's nothing to configure or rotate.
- Be polite: the client caches aggressively and adds small jitter between requests.

## Disclaimer

For personal use. `manga-cli` is an unofficial client and is not affiliated with
atsu.moe. Please support official releases where available.
