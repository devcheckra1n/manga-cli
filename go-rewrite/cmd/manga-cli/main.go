// manga-cli (Go) — the zero-dependency rewrite. Bare invocation opens the
// main menu; the reader's `m` key returns there from anywhere.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const version = "2.0.0-dev"

func execLookPath(name string) (string, error) { return exec.LookPath(name) }

type cliArgs struct {
	command  string
	query    string
	source   string
	adult    bool
	noBanner bool
	dual     *bool
	dir      string // rtl | ltr
}

func parseArgs(argv []string) cliArgs {
	a := cliArgs{command: "menu"}
	var positional []string
	for i := 0; i < len(argv); i++ {
		s := argv[i]
		next := func() string {
			if i+1 < len(argv) {
				i++
				return argv[i]
			}
			return ""
		}
		switch s {
		case "-h", "--help", "help":
			a.command = "help"
		case "-v", "--version", "version":
			a.command = "version"
		case "-s", "--search":
			a.command, a.query = "search", next()
		case "-c", "--continue":
			a.command = "continue"
		case "-H", "--history":
			a.command = "history"
		case "-t", "--trending":
			a.command = "trending"
		case "-p", "--popular":
			a.command = "popular"
		case "-l", "--latest":
			a.command = "latest"
		case "-R", "--random":
			a.command = "random"
		case "-r", "--recommended", "--recommend":
			a.command = "recommended"
		case "-g", "--genre":
			a.command, a.query = "genre", next()
		case "--follow":
			a.command = "follow"
		case "-u", "--updates":
			a.command = "updates"
		case "--stats":
			a.command = "stats"
		case "-S", "--source":
			a.source = next()
		case "--adult":
			a.adult = true
		case "--no-banner":
			a.noBanner = true
		case "--rtl":
			a.dir = "rtl"
		case "--ltr":
			a.dir = "ltr"
		case "--dual", "--spread":
			t := true
			a.dual = &t
		case "--single":
			f := false
			a.dual = &f
		case "--debug":
			os.Setenv("MANGA_CLI_DEBUG", "1")
		default:
			if !strings.HasPrefix(s, "-") {
				positional = append(positional, s)
			}
		}
	}
	if len(positional) > 0 && a.command == "menu" {
		first := strings.ToLower(positional[0])
		rest := strings.Join(positional[1:], " ")
		switch first {
		case "search":
			a.command, a.query = "search", rest
		case "continue":
			a.command = "continue"
		case "history":
			a.command = "history"
		case "trending":
			a.command = "trending"
		case "popular":
			a.command = "popular"
		case "latest":
			a.command = "latest"
		case "random", "roll":
			a.command = "random"
		case "recommended", "recs":
			a.command, a.query = "recommended", rest
		case "genre":
			a.command, a.query = "genre", rest
		case "browse", "filter":
			a.command = "browse"
		case "follow":
			a.command, a.query = "follow", rest
		case "updates", "u":
			a.command = "updates"
		case "stats":
			a.command = "stats"
		case "sources", "source":
			a.command, a.query = "sources", rest
		case "where", "paths":
			a.command = "where"
		case "mal", "myanimelist":
			a.command, a.query = "mal", rest
		case "config", "settings":
			a.command, a.query = "config", rest
		case "menu":
			a.command = "menu"
		case "info": // debug helpers from phase 1
			a.command, a.query = "info", rest
		case "pages":
			a.command, a.query = "pages", rest
		default:
			a.command, a.query = "search", strings.Join(positional, " ")
		}
	} else if len(positional) > 0 && a.query == "" {
		a.query = strings.Join(positional, " ")
	}
	return a
}

func main() {
	// Restore the terminal on Ctrl-C / SIGTERM even mid-reader.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		ui.Restore()
		os.Exit(130)
	}()

	a := parseArgs(os.Args[1:])
	cfg := util.LoadConfig()
	if a.adult {
		cfg.Adult = true
	}
	if a.dir != "" {
		cfg.Direction = a.dir
	}
	if a.dual != nil {
		cfg.DualPage = *a.dual
	}
	if a.source != "" && api.IsSourceID(a.source) {
		cfg.Source = a.source
	}

	var fb []api.SourceID
	for _, s := range cfg.Fallback {
		if api.IsSourceID(s) {
			fb = append(fb, api.SourceID(s))
		}
	}
	if api.IsSourceID(cfg.Source) {
		api.Configure(api.SourceID(cfg.Source), fb)
	}

	switch a.command {
	case "help":
		printHelp()
		return
	case "version":
		fmt.Println("manga-cli " + version + " (go)")
		return
	case "where":
		whereCmd(cfg)
		return
	case "sources":
		sourcesCmd(cfg, a.query)
		return
	case "stats":
		must(statsFlow())
		return
	case "mal":
		must(malFlow(cfg, a.query))
		return
	case "config":
		must(configFlow(&cfg, a.query))
		return
	case "info", "pages":
		debugCmd(a.command, a.query)
		return
	}

	if !a.noBanner && shouldShowBanner(cfg.ShowBanner) && a.command == "menu" {
		fmt.Print(banner(version) + "\n")
	}

	err := func() error {
		switch a.command {
		case "menu":
			return mainMenu(cfg)
		case "search":
			return searchFlow(cfg, a.query)
		case "continue":
			return continueFlow(cfg)
		case "history":
			return historyFlow(cfg)
		case "trending":
			return discoveryFlow(cfg, api.Trending, "trending")
		case "popular":
			return discoveryFlow(cfg, api.Popular, "popular")
		case "latest":
			return discoveryFlow(cfg, api.RecentlyUpdated, "latest updates")
		case "random":
			return randomFlow(cfg)
		case "recommended":
			return recommendedFlow(cfg, a.query)
		case "genre":
			return genreFlow(cfg, a.query)
		case "browse":
			return browseFlow(cfg)
		case "follow":
			return followFlow(cfg, a.query)
		case "updates":
			return updatesFlow(cfg)
		}
		return nil
	}()
	// `m` pressed deep inside a directly-launched flow → open the main menu.
	if errors.Is(err, errMenu) {
		err = mainMenu(cfg)
	}
	must(err)
}

func must(err error) {
	if err != nil && !errors.Is(err, errMenu) {
		ui.Restore()
		fmt.Fprintln(os.Stderr, ui.Red("✗ "+err.Error()))
		if strings.Contains(err.Error(), "internet connection looks down") {
			fmt.Fprintln(os.Stderr, ui.Dim("  while you wait — the game returns in phase 6 🕹"))
		}
		os.Exit(1)
	}
}

func debugCmd(cmd, query string) {
	parts := strings.Fields(query)
	switch {
	case cmd == "info" && len(parts) >= 2:
		info, err := api.Get(api.SourceID(parts[0])).Info(parts[1])
		must(err)
		fmt.Printf("%s (%s) — %d chapters, forceStrip=%v\n", info.Title, info.Type, len(info.Chapters), info.ForceStrip)
	case cmd == "pages" && len(parts) >= 3:
		rc, err := api.Get(api.SourceID(parts[0])).Pages(parts[1], parts[2])
		must(err)
		fmt.Printf("%d pages\n", len(rc.Pages))
	default:
		fmt.Println("usage: manga-cli info <source> <id> | pages <source> <id> <chId>")
	}
}

// ── labels ─────────────────────────────────────────────────────────────────────

func searchLabel(r api.SearchResult) string {
	label := ui.Bold(r.Title)
	if r.IsAdult {
		label += ui.Pink(" 18+")
	}
	var meta []string
	if r.Type != "" {
		meta = append(meta, ui.Dim(r.Type))
	}
	if r.Status != "" {
		meta = append(meta, statusBadge(r.Status))
	}
	if r.Year > 0 {
		meta = append(meta, ui.Dim(fmt.Sprintf("%d", r.Year)))
	}
	if r.Rating > 0 {
		meta = append(meta, ui.Yellow(fmt.Sprintf("★%.1f", r.Rating)))
	}
	return label + "   " + strings.Join(meta, ui.Dim(" · "))
}

func statusBadge(status string) string {
	s := strings.ToLower(status)
	switch {
	case strings.Contains(s, "ongoing"), strings.Contains(s, "releasing"), strings.Contains(s, "publishing"):
		return ui.Green("● " + status)
	case strings.Contains(s, "complete"), strings.Contains(s, "finished"):
		return ui.Cyan("◆ " + status)
	case strings.Contains(s, "hiatus"):
		return ui.Yellow("◑ " + status)
	case strings.Contains(s, "cancel"), strings.Contains(s, "dropped"):
		return ui.Red("✕ " + status)
	}
	return ui.Dim(status)
}

func chapterLabel(ch api.Chapter) string {
	label := ui.Bold(ui.Cyan(fmt.Sprintf("Ch.%v", ch.Number)))
	if ch.Title != "" && ch.Title != fmt.Sprintf("Chapter %v", ch.Number) {
		label += ui.Gray(" · " + ch.Title)
	}
	if ch.PageCount > 0 {
		label += ui.Dim(fmt.Sprintf("   %dp", ch.PageCount))
	}
	return label
}

// ── help ───────────────────────────────────────────────────────────────────────

func printHelp() {
	b, k, d := ui.Bold, ui.Cyan, ui.Dim
	fmt.Println(banner(version) + `
` + b("USAGE") + `
  manga-cli                ` + d("# no args → interactive main menu") + `
  manga-cli [flags] [query]

` + b("COMMANDS / FLAGS") + `
  ` + k("-s, --search") + ` <query>   search and pick a manga
  ` + k("-R, --random") + `           🎲 roll a random manga and start reading
  ` + k("-c, --continue") + `         resume your last-read manga
  ` + k("-H, --history") + `          browse reading history
  ` + k("-t, --trending") + `         show trending manga
  ` + k("-p, --popular") + `          show popular manga
  ` + k("-l, --latest") + `           show latest updates
  ` + k("-g, --genre") + ` <genre>    browse by genre
  ` + k("    browse") + `             filtered browse — genre + status + sort
  ` + k("-r, --recommended") + `      "more like this" — recommendations
  ` + k("    --follow") + ` [query]   follow a series for new-chapter updates
  ` + k("-u, --updates") + `          show followed series with new chapters
  ` + k("    --stats") + `            your reading stats / wrapped
  ` + k("-S, --source") + ` <id>      force: atsumaru · weebcentral · mangakatana · mangadex
  ` + k("    sources") + ` [reset]    list sources & health — reset forgives failures
  ` + k("    config") + ` [sub]       settings — interactive, or get · set · edit · path
  ` + k("    mal") + ` [sub]          MyAnimeList tracking: login · status · logout
  ` + k("    where") + `              paths, setup & renderer info
  ` + k("    --dual / --single") + `  spread mode on/off · ` + k("--rtl / --ltr") + ` direction
  ` + k("    --adult") + `            include 18+ results for this run
  ` + k("-v, --version") + ` · ` + k("-h, --help") + `

` + b("READER KEYS") + `
  ` + k("→ ←") + `            turn page (direction-aware: in rtl, ← advances)
  ` + k("n / p") + `          next / previous page · ` + k("space") + ` next
  ` + k("] / [") + `          next / previous chapter
  ` + k("g / G") + `          first / last page · ` + k(": or #") + ` go to page
  ` + k("w") + `              toggle long-strip (webtoon) scroll
  ` + k("d") + `              toggle dual-page spread
  ` + k("t") + `              toggle reading direction (rtl ⇄ ltr)
  ` + k("f") + `              toggle fit · ` + k("+ / - / 0") + ` zoom
  ` + k("b") + `              follow / unfollow this series
  ` + k("s") + `              save current page to your downloads
  ` + k("j") + `              back to the chapter list
  ` + k("m") + `              back to the main menu (works from any read)
  ` + k("?") + `              in-reader help · ` + k("q / esc") + ` quit

` + b("ZERO DEPENDENCIES") + `  ` + d("this binary needs nothing installed — no fzf, no chafa.") + `
  ` + d("Images render via the built-in pipeline: kitty/iTerm2 protocols on") + `
  ` + d("capable terminals, truecolor half-blocks everywhere else (256-color fallback).") + `

` + b("COMING SOON") + `  ` + d("downloads (CBZ/ZIP/PDF) · offline library · sync · nyaa · MANGAVANIA") + ``)
}
