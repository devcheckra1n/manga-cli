// Download, offline-library, sync, and nyaa flows.

package main

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/dl"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/img"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/reader"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

type dlOpts struct {
	format   string
	chapters string
	out      string
	noVpn    bool
	dump     string
}

func downloadFlow(cfg util.Config, query string, opts dlOpts) error {
	q := strings.TrimSpace(query)
	if q == "" {
		q = strings.TrimSpace(prompt(ui.Violet("download manga ❯ ")))
		if q == "" {
			return nil
		}
	}
	results, err := withSpinner("searching “"+q+"” …", func() ([]api.SearchResult, error) {
		r, _, e := api.SearchAny(q, api.SearchOpts{Adult: cfg.Adult})
		return r, e
	})
	if err != nil {
		return err
	}
	if len(results) == 0 {
		fmt.Println(ui.Yellow("No results for “" + q + "”."))
		return nil
	}
	items := make([]ui.PickItem, len(results))
	for i, r := range results {
		items[i] = ui.PickItem{Label: searchLabel(r)}
	}
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "manga ❯ ", Header: "pick a title to download"})
	if err != nil || idx < 0 {
		return err
	}
	r := results[idx]
	ref := api.MangaRef{ID: r.ID, Title: r.Title, Poster: r.Poster, Source: r.Source}
	info, err := withSpinner("loading "+ref.Title+" …", func() (*api.MangaInfo, error) {
		return api.Get(ref.Source).Info(ref.ID)
	})
	if err != nil {
		return err
	}
	if len(info.Chapters) == 0 {
		fmt.Println(ui.Yellow("No downloadable chapters for this title."))
		return nil
	}
	ref.Title = info.Title

	format := opts.format
	if format == "" {
		format = cfg.DownloadFormat
	}
	dir := cfg.DownloadDir
	if opts.out != "" {
		dir = util.ExpandTilde(opts.out)
	}

	var chapters []api.Chapter
	if opts.chapters != "" {
		chapters = dl.SelectChapters(opts.chapters, info.Chapters)
		if len(chapters) == 0 {
			fmt.Println(ui.Yellow("No chapters match “" + opts.chapters + "”."))
			return nil
		}
	} else {
		done := dl.ExistingStems(ref, dir)
		chItems := make([]ui.PickItem, len(info.Chapters))
		for i, ch := range info.Chapters {
			mark := "  "
			if done[dl.ChapterStem(ref, ch)] {
				mark = ui.Green("✓ ")
			}
			chItems[len(info.Chapters)-1-i] = ui.PickItem{Label: mark + chapterLabel(ch)}
		}
		picked, err := ui.PickMulti(chItems, ui.PickOpts{
			Prompt: "chapters ❯ ",
			Header: info.Title + " — Tab to select multiple · Enter to download",
		})
		if err != nil || len(picked) == 0 {
			return err
		}
		for _, p := range picked {
			chapters = append(chapters, info.Chapters[len(info.Chapters)-1-p])
		}
		for i, j := 0, len(chapters)-1; i < j; i, j = i+1, j-1 {
			chapters[i], chapters[j] = chapters[j], chapters[i] // ascending
		}
	}

	fmt.Println(ui.Dim(fmt.Sprintf("↓ %d chapter(s) · %s · → %s", len(chapters), ui.Bold(format), dir)))
	ok, skipped, failed := 0, 0, 0
	for _, ch := range chapters {
		label := "Ch." + fmt.Sprint(ch.Number)
		res, err := withSpinner(label+" …", func() (*dl.Result, error) {
			return dl.DownloadChapter(ref, ch, dl.Options{Format: format, DownloadDir: dir})
		})
		switch {
		case err != nil:
			fmt.Println(ui.Red("✗ "+label) + ui.Dim("  "+err.Error()))
			failed++
		case res.Skipped:
			fmt.Println(ui.Dim("• " + label + " already downloaded"))
			skipped++
		default:
			warn := ""
			if res.Failed > 0 {
				warn = ui.Yellow(fmt.Sprintf(" (%d pages missing)", res.Failed))
			}
			fmt.Println(ui.Green("✓ "+label) + ui.Dim(fmt.Sprintf("  %dp → %s", res.Pages, res.Output)) + warn)
			ok++
		}
	}
	fmt.Println("\n" + ui.Bold("Done") + ui.Dim(fmt.Sprintf(" — %d downloaded · %d skipped · %d failed", ok, skipped, failed)))
	return nil
}

func libraryFlow(cfg util.Config) error {
	series := dl.ScanLibrary(cfg.DownloadDir)
	if len(series) == 0 {
		fmt.Println(ui.Yellow("No downloads in " + cfg.DownloadDir + " yet — grab some with download."))
		return nil
	}
	items := make([]ui.PickItem, len(series))
	for i, s := range series {
		items[i] = ui.PickItem{Label: ui.Bold(s.Title) + ui.Dim(fmt.Sprintf("   %d chapter(s)", len(s.Chapters)))}
	}
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "library ❯ ",
		Header: fmt.Sprintf("%d downloaded series · offline", len(series))})
	if err != nil || idx < 0 {
		return err
	}
	s := series[idx]
	info, load := dl.ToReaderSource(s)
	chItems := make([]ui.PickItem, len(info.Chapters))
	for i, ch := range info.Chapters {
		chItems[i] = ui.PickItem{Label: ui.Bold(ui.Cyan(ch.Title))}
	}
	for {
		cidx, err := ui.Pick(chItems, ui.PickOpts{Prompt: "chapter ❯ ",
			Header: fmt.Sprintf("%s — %d chapters · offline", info.Title, len(info.Chapters))})
		if err != nil || cidx < 0 {
			return err
		}
		act, err := reader.Run(&reader.Context{
			Manga: api.MangaRef{ID: info.ID, Title: info.Title}, Info: info,
			StartChapter: cidx, Protocol: img.DetectProtocol(cfg.ReaderMode),
			Direction: cfg.Direction, DualPage: cfg.DualPage, Fit: cfg.Fit,
			Zoom: cfg.Zoom, HudReserve: cfg.HudReserve, Prefetch: cfg.PrefetchPages,
			NoFollow: true, NoHistory: true, DownloadDir: cfg.DownloadDir,
			LoadChapter: load,
		})
		if err != nil {
			return err
		}
		if act == reader.ActMenu {
			return errMenu
		}
		if act == reader.ActQuit {
			return nil
		}
	}
}

func syncFlow(cfg util.Config, opts dlOpts) error {
	follows := util.LoadFollows()
	if len(follows) == 0 {
		fmt.Println(ui.Yellow("Not following anything yet — press b in the reader, or: manga-cli follow <title>"))
		return nil
	}
	format := opts.format
	if format == "" {
		format = cfg.DownloadFormat
	}
	dir := cfg.DownloadDir
	if opts.out != "" {
		dir = util.ExpandTilde(opts.out)
	}
	fmt.Println(ui.Dim(fmt.Sprintf("syncing %d followed series · %s → %s\n", len(follows), ui.Bold(format), dir)))
	downloaded, upToDate, failed := 0, 0, 0
	for _, f := range follows {
		info, err := withSpinner("checking "+f.Title+" …", func() (*api.MangaInfo, error) {
			return api.Get(api.SourceID(f.Source)).Info(f.ID)
		})
		if err != nil {
			fmt.Println(ui.Red("✗ " + f.Title + ": " + err.Error()))
			failed++
			continue
		}
		fresh := info.Chapters[min(f.ChapterCount, len(info.Chapters)):]
		if len(fresh) == 0 {
			fmt.Println(ui.Dim("• " + f.Title + " — up to date"))
			upToDate++
			util.MarkSeen(f.ID, len(info.Chapters))
			continue
		}
		fmt.Println(ui.Green("↓ "+f.Title) + ui.Dim(fmt.Sprintf("  %d new chapter(s)", len(fresh))))
		ref := api.MangaRef{ID: f.ID, Title: info.Title, Poster: f.CoverURL, Source: api.SourceID(f.Source)}
		for _, ch := range fresh {
			label := fmt.Sprintf("   Ch.%v", ch.Number)
			res, err := withSpinner(label+" …", func() (*dl.Result, error) {
				return dl.DownloadChapter(ref, ch, dl.Options{Format: format, DownloadDir: dir})
			})
			switch {
			case err != nil:
				fmt.Println(ui.Red("   ✗ " + label + ": " + err.Error()))
				failed++
			case res.Skipped:
				fmt.Println(ui.Dim("   • " + label + " already on disk"))
			default:
				fmt.Println(ui.Green("   ✓ " + label))
				downloaded++
			}
		}
		util.MarkSeen(f.ID, len(info.Chapters))
	}
	fmt.Println("\n" + ui.Bold("Sync complete") +
		ui.Dim(fmt.Sprintf(" — %d chapter(s) downloaded · %d up to date · %d failed", downloaded, upToDate, failed)))
	return nil
}

func nyaaFlow(cfg util.Config, query string, opts dlOpts) error {
	q := strings.TrimSpace(query)
	if q == "" {
		q = strings.TrimSpace(prompt(ui.Violet("nyaa search ❯ ")))
		if q == "" {
			return nil
		}
	}
	dump := opts.dump
	if dump == "" {
		di := make([]ui.PickItem, len(dl.DumpTypes))
		for i, d := range dl.DumpTypes {
			di[i] = ui.PickItem{Label: ui.Bold(d.Label) + "   " + ui.Dim("nyaa c="+d.Cat)}
		}
		idx, err := ui.Pick(di, ui.PickOpts{Prompt: "dump type ❯ ",
			Header: "which manga dump? (Literature only — never anime)"})
		if err != nil || idx < 0 {
			return err
		}
		dump = dl.DumpTypes[idx].ID
	}
	items, err := withSpinner("searching nyaa “"+q+"” …", func() ([]dl.NyaaItem, error) {
		return dl.SearchNyaa(q, dump)
	})
	if err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println(ui.Yellow("No " + dump + " torrents for “" + q + "”."))
		return nil
	}
	ti := make([]ui.PickItem, len(items))
	for i, it := range items {
		ti[i] = ui.PickItem{Label: fmt.Sprintf("%s %s  %s  %s   %s",
			ui.Green(fmt.Sprintf("▲%d", it.Seeders)), ui.Gray(fmt.Sprintf("▼%d", it.Leechers)),
			ui.Cyan(fmt.Sprintf("%9s", it.Size)), ui.Bold(it.Title),
			ui.Dim(strings.TrimPrefix(it.Category, "Literature - ")))}
	}
	chosen, err := ui.PickMulti(ti, ui.PickOpts{Prompt: "torrent ❯ ",
		Header: fmt.Sprintf("%d results · Tab to multi-select · ⚠ magnet download", len(items))})
	if err != nil || len(chosen) == 0 {
		return err
	}

	fmt.Println(ui.Dim(fmt.Sprintf("\n⚠  About to magnet-download %d torrent(s) with aria2c.", len(chosen))))
	if !opts.noVpn {
		v, _ := withSpinner("checking your VPN …", func() (*dl.VpnStatus, error) { return dl.CheckVpn(), nil })
		switch {
		case v == nil:
			if !confirm(ui.Yellow("⚠  Couldn't verify your IP. Continue without a VPN check? [y/N] ")) {
				fmt.Println(ui.Dim("aborted."))
				return nil
			}
		case v.LikelyVpn:
			fmt.Println(ui.Green("✓ VPN looks ON") + ui.Dim(fmt.Sprintf("  — %s · %s · %s", v.IP, orStr(v.Org, v.ISP), v.Country)))
		default:
			fmt.Println(ui.Red("⚠  VPN appears to be OFF") + ui.Dim(fmt.Sprintf("  — %s · %s · %s (residential ISP)", v.IP, v.ISP, v.Country)))
			fmt.Println(ui.Yellow("   Torrenting without a VPN exposes your real IP to peers. Turn your VPN on first."))
			if !confirm(ui.Bold("   Download anyway? [y/N] ")) {
				fmt.Println(ui.Dim("aborted."))
				return nil
			}
		}
	}

	dir := filepath.Join(cfg.DownloadDir, "nyaa")
	if opts.out != "" {
		dir = util.ExpandTilde(opts.out)
	}
	ok := 0
	for _, ci := range chosen {
		it := items[ci]
		fmt.Println("\n" + ui.Bold("↓ "+it.Title) + ui.Dim(fmt.Sprintf("  (%s, ▲%d)", it.Size, it.Seeders)))
		good, err := dl.DownloadMagnet(it.Magnet, dir)
		switch {
		case err != nil:
			fmt.Println(ui.Red("✗ " + err.Error()))
		case good:
			ok++
			fmt.Println(ui.Green("✓ done → " + dir))
		default:
			fmt.Println(ui.Red("✗ aria2c exited with an error"))
		}
	}
	fmt.Println("\n" + ui.Bold("Done") + ui.Dim(fmt.Sprintf(" — %d/%d downloaded to %s", ok, len(chosen), dir)))
	return nil
}

func confirm(label string) bool {
	a := strings.ToLower(strings.TrimSpace(prompt(label)))
	return a == "y" || a == "yes"
}

func orStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
