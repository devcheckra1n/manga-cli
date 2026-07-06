# manga-cli

A fast, beautiful **terminal manga reader & downloader** —
[ani-cli](https://github.com/pystardust/ani-cli) energy, but for manga, and prettier.
Search, browse, and read manga inline in your terminal with real image rendering,
across four sources with automatic fallback.

```
 ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗  █████╗
 ████╗ ████║██╔══██╗████╗  ██║██╔════╝ ██╔══██╗
 ██╔████╔██║███████║██╔██╗ ██║██║  ███╗███████║
 ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║
 ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║
 ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝
          ██████╗██╗     ██╗
         ██╔════╝██║     ██║
         ╚██████╗███████╗██║   terminal manga reader 🎲
          ╚═════╝╚══════╝╚═╝
```

## ⚡ v2.0.0 — the zero-dependency rewrite

manga-cli v2 is a **single ~7MB static binary written in Go** with **zero dependencies**:
no fzf, no chafa, no zip, no unzip, no imagemagick, no runtime. Download one file and
read manga — on anything from a fresh macOS install to a Gentoo box running Window Maker.

```bash
# grab your platform's binary from the latest release, then:
chmod +x manga-cli-* && mv manga-cli-* /usr/local/bin/manga-cli
manga-cli
```

- **Built-in fuzzy picker** (replaces fzf) and a **built-in image pipeline** (replaces
  chafa): kitty & iTerm2 graphics on capable terminals, truecolor half-blocks everywhere
  else, 256-color fallback for ancient ones — aspect-corrected to your terminal's real
  cell size
- **Everything from v1**: 4 sources with connection-aware fallback, main menu, reader
  (RTL/dual/webtoon/zoom/go-to), downloads (CBZ/ZIP/PDF/images — all in-process),
  offline library, follows/updates/sync, MAL tracking, stats, config editor, nyaa
  (aria2c is the one *optional* external), and the full **MANGAVANIA** campaign
- Builds: `darwin-arm64/amd64`, `linux-amd64/arm64/386` (fully static), `windows-amd64`
- Shares your existing config/history/follows/caches with v1

The Go source lives in [`go-rewrite/`](go-rewrite/); the original Bun/TypeScript
implementation below remains as the reference (`bun run install:bin` still works).

---

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
- 🔀 **Multiple sources with fallback** — atsu.moe primary, **Weeb Central**, **MangaKatana**,
  **MangaDex** backups; if one's down it routes to the next (and remembers it's down so
  you don't wait on the timeout again)
- 📶 **Connection-aware** — a quick connectivity probe makes sure *bad wifi* never gets a
  healthy source flagged as down
- 🎛️ **Main menu** — bare `manga-cli` opens a one-keystroke picker for everything
- 🎲 **Random manga** — `manga-cli -R` rolls one and starts reading
- 🕹️ **MANGAVANIA** — a built-in Castlevania-flavored zombie minigame (`manga-cli game`)
  for when the wifi is truly dead — Ridge Racer rules
- 🔎 **Filtered browse** — by genre, status, and sort order
- 🔄 **Sync** — auto-download new chapters for every series you follow
- 📊 **MyAnimeList tracking** — your reading progress syncs to MAL as you read
- 🧲 **Torrent dumps via nyaa.si** — grab full-volume manga with `aria2c` (with a VPN check)
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
  -R, --random            🎲 roll a random manga and start reading
  -g, --genre <genre>     browse by genre
      browse              filtered browse — genre + status + sort
  -r, --recommended [q]   "more like this" — recommendations for a title
      --follow [query]    follow a series for new-chapter updates
  -u, --updates           show followed series that have new chapters
      sync                download new chapters for everything you follow
      mal [sub]           MyAnimeList tracking: login · status · logout
      --library           browse & read your downloads offline
      --stats             your reading stats / "wrapped"
  -d, --download <query>  download chapters (CBZ / ZIP / PDF / images)
  -f, --format <fmt>      download format: cbz · zip · pdf · images
      --chapters <spec>   pick chapters non-interactively: 1-10 · 1,3,5 · all · latest
      --out <dir>         download into <dir> (overrides config)
      nyaa [query]        manga torrents via nyaa.si + aria2c (--dump, --no-vpn-check)
  -S, --source <id>       force a source: atsumaru · weebcentral · mangakatana · mangadex
      sources [reset]     list sources & health — reset forgives recorded failures
      config [sub]        view & change settings — interactive, or get · set · edit · path
      game                🕹 MANGAVANIA — zombie-slaying minigame (needs zero internet)
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

With no arguments it opens the **main menu** — search, continue where you left off,
roll a 🎲 random manga, trending, browse, updates, library, stats, and settings, all
one keystroke away.

**Navigation flows like an app:** anything you launch from the menu returns to the menu
when it finishes, `Esc` backs out of any picker, and **`m`** inside the reader jumps
straight back to the main menu — even if you started with `manga-cli <query>` from the
shell.

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
manga-cli sync                # download new chapters for everything you follow
manga-cli browse              # filtered browse: pick genre + status + sort
manga-cli -r                  # recommendations based on your last read
manga-cli -r "chainsaw man"   # "more like this" for a specific title
manga-cli --library           # browse & read your downloads — fully offline
manga-cli --stats             # your reading "wrapped": streaks, top titles, weekly chart
```

- **Following is local** — no account needed. `--updates` re-checks followed titles and
  badges the ones with new chapters; press **`b`** in the reader to follow/unfollow.
- **`sync`** is `--updates` + auto-download in one: it pulls every new chapter for your
  follows into your library (handy in a cron job for a self-updating shelf).
- **`browse`** filters across genre, status, and sort order, using whichever source has the
  richest filters (atsu.moe or MangaDex).
- **`--library`** reads downloaded CBZ/ZIP/folders back through the same reader, with
  zero network. (PDF downloads are for your viewer; the library reads image archives.)
- **`--stats`** is computed entirely from your local history — nothing leaves your machine.

## Tracking (MyAnimeList)

manga-cli can update your **MyAnimeList** reading progress automatically as you read.

```bash
manga-cli mal login     # one-time browser auth
manga-cli mal           # show link status
manga-cli mal logout
```

One-time setup: create an API app at <https://myanimelist.net/apiconfig>, set its **App
Redirect URL** to `http://localhost:8723/callback`, and put its **Client ID** and **Client
Secret** in `~/.config/manga-cli/config.json` as `malClientId` and `malClientSecret` (or the
`MAL_CLIENT_ID` / `MAL_CLIENT_SECRET` env vars). After `mal login`, finishing a chapter bumps
your MAL progress for that title in the background.

## Sources

manga-cli reads from **atsu.moe** by default and falls back automatically when it's
unreachable or has no match:

```bash
manga-cli sources                 # list sources + the fallback chain
manga-cli -S mangadex one piece   # force a specific source for this run
```

| Source | Status | Notes |
|--------|--------|-------|
| `atsumaru` | ✅ primary | atsu.moe — richest metadata & discovery feeds |
| `weebcentral` | ✅ backup 1 | weebcentral.com — huge, current scanlation library |
| `mangakatana` | ✅ backup 2 | mangakatana.com — broad library incl. licensed titles |
| `mangadex` | ✅ backup 3 | mangadex.org — open API (some titles delicensed) |

If the primary source is down or returns nothing, the next source answers
automatically — a manga then stays bound to whichever source found it (so chapters and
pages always load from the right place). A failed source is also **remembered for ~5
minutes** and skipped, so you don't wait out its network timeout on every command. Set the
primary with `-S/--source` or the `source` / `fallback` keys in config.

**Connection-aware:** before blaming a source, manga-cli runs a quick connectivity probe
(the same captive-portal endpoints your OS uses). If *your* internet is down or flaky, the
failure isn't recorded — so bad wifi never flags healthy sources as dead. If sources do get
flagged and you want them back immediately: `manga-cli sources reset`.

```bash
manga-cli -S weebcentral chainsaw man   # read from a specific source
manga-cli sources                       # show the chain & status
```

> **While atsu.moe is down**, set `weebcentral` as your primary for instant results
> (otherwise each call waits out atsu's timeout before falling back):
> `manga-cli -S weebcentral …` or `"source": "weebcentral"` in config.
>
> **MangaDex note:** many licensed series (Jujutsu Kaisen, Solo Leveling, …) are
> delicensed/external-only there, so they may show no readable chapters — weebcentral
> usually has them. Search prefers English but falls back to the best available language.

## Downloading torrents (nyaa.si)

For full-volume dumps and raws, manga-cli can grab manga torrents from
[nyaa.si](https://nyaa.si) via **aria2c** (magnet links). It stays strictly inside
nyaa's **Literature** category, so it never touches the anime section.

```bash
manga-cli nyaa berserk                 # pick a dump type, then a torrent
manga-cli nyaa "one piece" --dump raw  # raw (original-language) dumps
```

**Dump types** (`--dump`): `eng` (English-translated) · `raw` (original) ·
`non-eng` (other languages) · `all` (everything in Literature).

⚠️ **VPN check** — before any download, manga-cli checks your public IP (via ip-api).
If it looks like a residential ISP (i.e. **VPN off**), it warns and asks you to confirm.
Torrenting exposes your IP to peers — keep your VPN on. Requires `aria2c`
(`brew install aria2`); downloads land in `<downloadDir>/nyaa/`.

## 🕹️ MANGAVANIA (the minigame)

Ridge Racer had Galaxian on its loading screen; manga-cli has **MANGAVANIA** — a full
Castlevania-flavored campaign, rendered in pure ANSI, needing **zero internet**:

```bash
manga-cli game     # also: play · zombies — or pick 🕹️ from the main menu
```

`←` `→` move · `space` jump · `x` attack — with a **chapter select** (I–V) so you can
start anywhere. **Five chapters**: the Graveyard, the Crypt, the Ramparts, the
Cathedral… and **Castle Dracula**, reached by a cutscene walk up the castle steps.

- **Zombie variants** — shambling walkers, fast runners, armored **brutes**, and
  acid-spitting **spitters**; all crumble into bone piles that litter the arena
- **Drops** — hearts, swift boots, double damage, invincibility stars… and better
  weapons: the long-reach **VAMPIRE KILLER** whip and the heavy **claymore**
- **A boss per chapter** — the lunging GRAVELORD, cleaver-throwing BUTCHER,
  teleporting BONE WITCH, and THE REAPER with his scythe sweeps — each with a
  **Persona-style death dialogue** (close-up portrait and all)
- **The finale**: **ALUCARD** duels you with dash-steps and sword waves — and when he
  falls, he *becomes* **DRACULA**: triple fireballs, mini-zombie summons, and
  **shapeshifting** (bat swoops you can only jump-slash; untouchable mist)

5 hearts, retry per chapter, and the win screen tells you your clear time. When a
command fails because *your* connection is down, manga-cli suggests the game to help
you cope.

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
| `:` · `#` | go to page — type a number, then Enter |
| `↑` · `↓` | scroll (in long-strip / webtoon mode) |
| `w` | toggle long-strip (webtoon) scrolling |
| `d` | toggle two-page spread |
| `t` | toggle reading direction (RTL ⇄ LTR) |
| `f` | toggle fit (whole page ⇄ fill width) |
| `b` | follow / unfollow this series |
| `+` · `-` · `0` | zoom in / out / reset |
| `s` | save current page to your downloads dir |
| `r` | re-render (after a terminal resize) |
| `j` | back to the chapter list |
| `m` | **back to the main menu** (works from any read) |
| `?` | show keybindings |
| `q` · `esc` | quit the reader |

Reading is **right-to-left by default** (it's manga). Pass `--ltr` or press `t` for
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

The easiest way: **`manga-cli config`** — an interactive settings editor (pick a
setting, pick/type a value, done). Or non-interactively:

```bash
manga-cli config get              # list every setting + current value
manga-cli config set zoom 0.9     # change one (validated)
manga-cli config edit             # open config.json in $EDITOR
manga-cli config path             # print the config file path
```

Under the hood it's `~/.config/manga-cli/config.json` (XDG-aware; `$XDG_CONFIG_HOME`
respected):

```json
{
  "source": "atsumaru",
  "fallback": ["weebcentral", "mangakatana", "mangadex"],
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
  "downloadDir": "~/Downloads/manga-cli/",
  "malClientId": "",
  "malClientSecret": ""
}
```

- `source`: primary backend — `"atsumaru"` · `"weebcentral"` · `"mangakatana"` · `"mangadex"`
- `fallback`: ordered backups tried when the primary fails (see [Sources](#sources))
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
├── api/        HTTP client, source registry + fallback, sources/ (atsumaru, weebcentral, mangakatana, mangadex) + endpoints.md
├── ui/         banner, fzf menu, reader (page + webtoon), spinner, terminal detection
├── utils/      config, cache, history, follows, library, stats, health, mal, image, download, nyaa, vpn, paths
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
