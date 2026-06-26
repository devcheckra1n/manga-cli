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
- 📚 **Right-to-left reading** (manga default) and **two-page spreads**
- 🔍 **Live zoom & fit controls** for different render resolutions
- ⚡ **Feels instant** — aggressive disk caching + background page prefetch
- 📖 **Reading history** with `--continue` to pick up exactly where you left off
- 🪶 **Lean** — Bun + TypeScript, zero runtime npm dependencies (just `fzf` + `chafa`)

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
      --dual              open in two-page (spread) mode
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

## Reader controls

| Key | Action |
|-----|--------|
| `→` · `←` | turn page — **direction-aware** (in RTL manga, `←` advances) |
| `n` · `space` | next page |
| `p` | previous page |
| `]` · `[` | next / previous chapter |
| `g` · `G` | first / last page |
| `d` | toggle two-page spread |
| `m` | toggle reading direction (RTL ⇄ LTR) |
| `f` | toggle fit (whole page ⇄ fill width) |
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
- `prefetchPages`: how many upcoming pages to fetch in the background

### Cache & data

- `~/.cache/manga-cli/` — covers, page images, and TTL'd API responses
  (`$XDG_CACHE_HOME` respected). Safe to delete anytime.
- `~/.config/manga-cli/history.json` — reading history.

## Architecture

```
src/
├── api/        atsu.moe client (search, manga, chapters) + endpoints.md
├── ui/         banner, fzf menu, reader, spinner, terminal detection
├── utils/      config, cache, history, image, paths
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
