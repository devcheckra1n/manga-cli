// manga-cli (Go) — the zero-dependency rewrite. Phase 1: core + sources.
// The full UX (picker, reader, menu, game) lands in later phases; this binary
// currently exposes headless commands used to verify the source layer.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/img"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/reader"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
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
	case "continue", "-c":
		cmdContinue(cfg)
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
	ui.Restore()
	fmt.Fprintln(os.Stderr, "✗ "+err.Error())
	os.Exit(1)
}

// openReader runs a reader session with the config's defaults.
func openReader(cfg util.Config, ref api.MangaRef, info *api.MangaInfo, chIdx, page int) reader.Action {
	act, err := reader.Run(&reader.Context{
		Manga: ref, Info: info, StartChapter: chIdx, StartPage: page,
		Protocol:  img.DetectProtocol(cfg.ReaderMode),
		Direction: cfg.Direction, DualPage: cfg.DualPage, Fit: cfg.Fit,
		Zoom: cfg.Zoom, HudReserve: cfg.HudReserve, Prefetch: cfg.PrefetchPages,
		Webtoon: info.ForceStrip,
	})
	if err != nil {
		fail(err)
	}
	if act == reader.ActMenu {
		fmt.Println(ui.Dim("(the main menu arrives in phase 5)"))
	}
	return act
}

func cmdContinue(cfg util.Config) {
	h := util.MostRecent()
	if h == nil {
		fmt.Println("No reading history yet — search for something first.")
		return
	}
	fmt.Printf("%s %s %s\n", ui.Dim("resuming"), ui.Bold(h.Title),
		ui.Dim(fmt.Sprintf("— Ch.%v · p.%d", h.LastChapterNumber, h.LastPage+1)))
	src := api.SourceID(h.Source)
	info, err := api.Get(src).Info(h.ID)
	if err != nil {
		fail(err)
	}
	ref := api.MangaRef{ID: h.ID, Title: h.Title, Poster: h.CoverURL, Source: src}
	openReader(cfg, ref, info, h.LastChapterIndex, h.LastPage)
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
	if len(results) == 0 {
		fmt.Printf("No results for “%s”.\n", query)
		return
	}
	// Interactive: pick a manga, then a chapter (the reader lands in phase 3).
	if ui.IsTTY() {
		items := make([]ui.PickItem, len(results))
		for i, r := range results {
			items[i] = ui.PickItem{Label: searchLabel(r)}
		}
		idx, err := ui.Pick(items, ui.PickOpts{
			Prompt: "manga ❯ ",
			Header: fmt.Sprintf("%d results for “%s” · via %s", len(results), query, source),
		})
		if err != nil {
			fail(err)
		}
		if idx < 0 {
			return
		}
		r := results[idx]
		info, err := api.Get(r.Source).Info(r.ID)
		if err != nil {
			fail(err)
		}
		if len(info.Chapters) == 0 {
			fmt.Println("No readable chapters for this title.")
			return
		}
		chItems := make([]ui.PickItem, len(info.Chapters))
		for i, ch := range info.Chapters {
			chItems[len(info.Chapters)-1-i] = ui.PickItem{Label: chapterLabel(ch)} // newest first
		}
		// Chapter-pick → read loop ("j" in the reader returns here).
		for {
			cidx, err := ui.Pick(chItems, ui.PickOpts{
				Prompt: "chapter ❯ ",
				Header: fmt.Sprintf("%s — %d chapters", info.Title, len(info.Chapters)),
			})
			if err != nil {
				fail(err)
			}
			if cidx < 0 {
				return
			}
			act := openReader(cfg, api.MangaRef{ID: r.ID, Title: info.Title, Poster: r.Poster, Source: r.Source},
				info, len(info.Chapters)-1-cidx, 0)
			if act != reader.ActJump {
				return
			}
		}
	}
	// Headless: plain listing.
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

// searchLabel styles a result row: status dots ● ongoing · ◆ completed etc.
func searchLabel(r api.SearchResult) string {
	parts := []string{ui.Bold(r.Title)}
	if r.IsAdult {
		parts[0] += ui.Pink(" 18+")
	}
	meta := []string{}
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
	return parts[0] + "   " + strings.Join(meta, ui.Dim(" · "))
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
