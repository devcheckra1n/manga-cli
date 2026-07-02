// manga-cli (Go) — the zero-dependency rewrite. Phase 1: core + sources.
// The full UX (picker, reader, menu, game) lands in later phases; this binary
// currently exposes headless commands used to verify the source layer.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const version = "2.0.0-dev"

func main() {
	cfg := util.LoadConfig()

	// Configure the source chain from config (same semantics as the TS version).
	var fb []api.SourceID
	for _, s := range cfg.Fallback {
		if api.IsSourceID(s) {
			fb = append(fb, api.SourceID(s))
		}
	}
	if api.IsSourceID(cfg.Source) {
		api.Configure(api.SourceID(cfg.Source), fb)
	}

	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		return
	}
	switch args[0] {
	case "version", "-v", "--version":
		fmt.Println("manga-cli " + version + " (go)")
	case "sources":
		cmdSources(cfg)
	case "search":
		cmdSearch(strings.Join(args[1:], " "), cfg)
	case "info":
		need(args, 3, "info <source> <mangaId>")
		cmdInfo(api.SourceID(args[1]), args[2])
	case "pages":
		need(args, 4, "pages <source> <mangaId> <chapterId>")
		cmdPages(api.SourceID(args[1]), args[2], args[3])
	default:
		usage()
	}
}

func usage() {
	fmt.Println(`manga-cli (go rewrite — phase 1)
  search <query>                    search across the fallback chain
  info <source> <mangaId>           chapter list for a manga
  pages <source> <mangaId> <chId>   page URLs for a chapter
  sources                           list sources & the chain
  version`)
}

func need(args []string, n int, use string) {
	if len(args) < n {
		fmt.Fprintln(os.Stderr, "usage: manga-cli "+use)
		os.Exit(2)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "✗ "+err.Error())
	os.Exit(1)
}

func cmdSources(cfg util.Config) {
	down := api.DownSources()
	for _, s := range api.AllSources() {
		mark := "○"
		notes := ""
		if s.ID() == api.PrimaryID() {
			mark = "●"
			notes = "  primary"
		}
		if down[s.ID()] {
			mark = "◌"
			notes = "  cooling down"
		}
		fmt.Printf("  %s %-12s %s%s\n", mark, s.ID(), s.Label(), notes)
	}
	chain := []string{cfg.Source}
	for _, f := range cfg.Fallback {
		if f != cfg.Source {
			chain = append(chain, f)
		}
	}
	fmt.Println("\n  fallback chain: " + strings.Join(chain, " → "))
}

func cmdSearch(query string, cfg util.Config) {
	if strings.TrimSpace(query) == "" {
		fmt.Fprintln(os.Stderr, "usage: manga-cli search [@source] <query>")
		os.Exit(2)
	}
	var results []api.SearchResult
	var source api.SourceID
	var err error
	// "search @weebcentral berserk" pins one source (debugging aid).
	if strings.HasPrefix(query, "@") {
		parts := strings.SplitN(query, " ", 2)
		if len(parts) == 2 && api.IsSourceID(parts[0][1:]) {
			source = api.SourceID(parts[0][1:])
			results, err = api.Get(source).Search(parts[1], api.SearchOpts{Adult: cfg.Adult})
			for i := range results {
				results[i].Source = source
			}
		} else {
			fmt.Fprintln(os.Stderr, "unknown source in @pin")
			os.Exit(2)
		}
	} else {
		results, source, err = api.SearchAny(query, api.SearchOpts{Adult: cfg.Adult})
	}
	if err != nil {
		fail(err)
	}
	fmt.Printf("%d results via %s\n", len(results), source)
	for _, r := range results {
		meta := r.Type
		if r.Status != "" {
			meta += " · " + r.Status
		}
		if r.Year > 0 {
			meta += fmt.Sprintf(" · %d", r.Year)
		}
		if r.Rating > 0 {
			meta += fmt.Sprintf(" · ★%.1f", r.Rating)
		}
		fmt.Printf("  %-46s %s  [%s]\n", r.Title, meta, r.ID)
	}
}

func cmdInfo(source api.SourceID, mangaID string) {
	info, err := api.Get(source).Info(mangaID)
	if err != nil {
		fail(err)
	}
	fmt.Printf("%s (%s) — %d chapters, forceStrip=%v\n", info.Title, info.Type, len(info.Chapters), info.ForceStrip)
	n := len(info.Chapters)
	show := info.Chapters
	if n > 6 {
		show = append(append([]api.Chapter{}, info.Chapters[:3]...), info.Chapters[n-3:]...)
	}
	for _, ch := range show {
		fmt.Printf("  Ch.%-8v %-30s %dp  [%s]\n", ch.Number, ch.Title, ch.PageCount, ch.ID)
	}
}

func cmdPages(source api.SourceID, mangaID, chapterID string) {
	rc, err := api.Get(source).Pages(mangaID, chapterID)
	if err != nil {
		fail(err)
	}
	fmt.Printf("%d pages\n", len(rc.Pages))
	for i, p := range rc.Pages {
		if i >= 3 && i < len(rc.Pages)-1 {
			if i == 3 {
				fmt.Println("  …")
			}
			continue
		}
		fmt.Printf("  p%-3d %s\n", p.Number+1, p.URL)
	}
}
