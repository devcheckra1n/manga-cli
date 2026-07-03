// All interactive flows: search, discovery, browse, history, follows,
// recommendations, random, stats, sources, where, MAL. Flows launched from
// the main menu return there; `m` anywhere in the reader unwinds via errMenu.

package main

import (
	"bufio"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"strings"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/img"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/reader"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

// errMenu unwinds any flow back to the main menu (reader key `m`).
var errMenu = errors.New("back to the main menu")

// ── little helpers ─────────────────────────────────────────────────────────────

var stdinReader = bufio.NewReader(os.Stdin)

func prompt(label string) string {
	fmt.Print(label)
	line, _ := stdinReader.ReadString('\n')
	return strings.TrimRight(line, "\r\n")
}

// withSpinner runs fn under a tiny spinner (TTY only).
func withSpinner[T any](text string, fn func() (T, error)) (T, error) {
	if !ui.IsTTY() {
		return fn()
	}
	done := make(chan struct{})
	go func() {
		frames := []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
		i := 0
		for {
			select {
			case <-done:
				fmt.Print("\r\x1b[2K")
				return
			case <-time.After(80 * time.Millisecond):
				fmt.Printf("\r\x1b[2K%s %s", ui.Cyan(frames[i%len(frames)]), text)
				i++
			}
		}
	}()
	v, err := fn()
	close(done)
	time.Sleep(5 * time.Millisecond) // let the spinner clear its line
	fmt.Print("\r\x1b[2K")
	return v, err
}

// rule renders a section header: ─╴ label ╶──────
func rule(label string) string {
	const width = 58
	return ui.Dim("─╴ ") + ui.Bold(ui.Violet(label)) +
		ui.Dim(" ╶"+strings.Repeat("─", max(1, width-len(label)-5)))
}

func miniBar(frac float64, width int) string {
	n := max(0, min(width, int(frac*float64(width)+0.5)))
	return ui.Violet(strings.Repeat("▰", n)) + ui.Dim(strings.Repeat("▱", width-n))
}

func relativeTime(iso string) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return ""
	}
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

// ── open + read ────────────────────────────────────────────────────────────────

// openManga loads info and runs the chapter-pick → read loop.
// resumeCh = -1 opens the chapter picker; otherwise resumes there.
func openManga(cfg util.Config, ref api.MangaRef, resumeCh, resumePage int) error {
	info, err := withSpinner("loading "+ref.Title+" …", func() (*api.MangaInfo, error) {
		return api.Get(ref.Source).Info(ref.ID)
	})
	if err != nil {
		return err
	}
	if len(info.Chapters) == 0 {
		fmt.Println(ui.Yellow("No readable chapters for “" + ref.Title + "” via " + string(ref.Source) + "."))
		return nil
	}
	if info.Title != "" {
		ref.Title = info.Title
	}

	chItems := make([]ui.PickItem, len(info.Chapters))
	for i, ch := range info.Chapters {
		chItems[len(info.Chapters)-1-i] = ui.PickItem{Label: chapterLabel(ch)} // newest first
	}
	startCh, startPage := resumeCh, resumePage
	for {
		if startCh < 0 {
			idx, err := ui.Pick(chItems, ui.PickOpts{
				Prompt: "chapter ❯ ",
				Header: fmt.Sprintf("%s — %d chapters", info.Title, len(info.Chapters)),
			})
			if err != nil {
				return err
			}
			if idx < 0 {
				return nil
			}
			startCh = len(info.Chapters) - 1 - idx
		}
		act, err := reader.Run(&reader.Context{
			Manga: ref, Info: info, StartChapter: startCh, StartPage: startPage,
			Protocol:  img.DetectProtocol(cfg.ReaderMode),
			Direction: cfg.Direction, DualPage: cfg.DualPage, Fit: cfg.Fit,
			Zoom: cfg.Zoom, HudReserve: cfg.HudReserve, Prefetch: cfg.PrefetchPages,
			Webtoon: info.ForceStrip, DownloadDir: cfg.DownloadDir,
		})
		if err != nil {
			return err
		}
		syncMal(cfg, ref)
		startCh, startPage = -1, 0
		switch act {
		case reader.ActMenu:
			return errMenu
		case reader.ActQuit:
			return nil
		}
		// ActJump → loop back to the chapter picker
	}
}

// syncMal fires a best-effort MAL progress update in the background.
func syncMal(cfg util.Config, ref api.MangaRef) {
	clientID := cfg.MalClientID
	if clientID == "" {
		clientID = os.Getenv("MAL_CLIENT_ID")
	}
	if clientID == "" || ref.Source == "" {
		return
	}
	secret := cfg.MalClientSecret
	if secret == "" {
		secret = os.Getenv("MAL_CLIENT_SECRET")
	}
	for _, h := range util.LoadHistory() {
		if h.ID == ref.ID {
			go util.MalUpdateProgress(clientID, secret, ref.Title, h.LastChapterNumber)
			return
		}
	}
}

func pickAndOpen(cfg util.Config, results []api.SearchResult, header string) error {
	items := make([]ui.PickItem, len(results))
	for i, r := range results {
		items[i] = ui.PickItem{Label: searchLabel(r)}
	}
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "manga ❯ ", Header: header})
	if err != nil || idx < 0 {
		return err
	}
	r := results[idx]
	return openManga(cfg, api.MangaRef{ID: r.ID, Title: r.Title, Poster: r.Poster, Source: r.Source}, -1, 0)
}

// ── flows ──────────────────────────────────────────────────────────────────────

func searchFlow(cfg util.Config, query string) error {
	query = strings.TrimSpace(query)
	if query == "" {
		query = strings.TrimSpace(prompt(ui.Violet("search manga ❯ ")))
		if query == "" {
			return nil
		}
	}
	results, err := withSpinner("searching “"+query+"” …", func() ([]api.SearchResult, error) {
		r, _, e := api.SearchAny(query, api.SearchOpts{Adult: cfg.Adult})
		return r, e
	})
	if err != nil {
		return err
	}
	if len(results) == 0 {
		fmt.Println(ui.Yellow("No results for “" + query + "”."))
		return nil
	}
	return pickAndOpen(cfg, results, fmt.Sprintf("%d results for “%s” · via %s", len(results), query, results[0].Source))
}

func discoveryFlow(cfg util.Config, kind api.DiscoveryKind, name string) error {
	items, source, err := api.DiscoveryAny(kind, 0, cfg.Adult)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println(ui.Yellow("Nothing in " + name + " right now."))
		return nil
	}
	results := make([]api.SearchResult, len(items))
	for i, it := range items {
		results[i] = api.SearchResult{ID: it.ID, Title: it.Title, Poster: it.Poster,
			Type: it.Type, IsAdult: it.IsAdult, Rating: it.Rating, Source: it.Source}
	}
	return pickAndOpen(cfg, results, fmt.Sprintf("%s · %d titles · via %s", name, len(items), source))
}

func randomFlow(cfg util.Config) error {
	kinds := []api.DiscoveryKind{api.Trending, api.Popular, api.TopRated, api.RecentlyUpdated}
	kind := kinds[rand.Intn(len(kinds))]
	page := rand.Intn(3)
	var source api.SourceID
	items, err := withSpinner("rolling the dice 🎲 …", func() ([]api.DiscoveryItem, error) {
		it, s, e := api.DiscoveryAny(kind, page, cfg.Adult)
		source = s
		return it, e
	})
	if (err != nil || len(items) == 0) && page > 0 {
		items, source, err = api.DiscoveryAny(kind, 0, cfg.Adult)
	}
	if err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println(ui.Yellow("The dice came up empty — try again."))
		return nil
	}
	it := items[rand.Intn(len(items))]
	fmt.Printf("🎲 %s %s %s\n", ui.Dim("rolled"), ui.Bold(it.Title), ui.Dim("("+string(source)+")"))
	return openManga(cfg, api.MangaRef{ID: it.ID, Title: it.Title, Poster: it.Poster, Source: it.Source}, -1, 0)
}

func continueFlow(cfg util.Config) error {
	h := util.MostRecent()
	if h == nil {
		fmt.Println(ui.Yellow("No reading history yet — search for something first."))
		return nil
	}
	fmt.Printf("%s %s %s\n", ui.Dim("resuming"), ui.Bold(h.Title),
		ui.Dim(fmt.Sprintf("— Ch.%v · p.%d", h.LastChapterNumber, h.LastPage+1)))
	ref := api.MangaRef{ID: h.ID, Title: h.Title, Poster: h.CoverURL, Source: api.SourceID(h.Source)}
	return openManga(cfg, ref, h.LastChapterIndex, h.LastPage)
}

func historyFlow(cfg util.Config) error {
	history := util.LoadHistory()
	if len(history) == 0 {
		fmt.Println(ui.Yellow("No reading history yet."))
		return nil
	}
	items := make([]ui.PickItem, len(history))
	for i, h := range history {
		frac := 0.0
		if h.TotalChapters > 0 {
			frac = float64(h.LastChapterIndex+1) / float64(h.TotalChapters)
		}
		items[i] = ui.PickItem{Label: fmt.Sprintf("%s   %s  %s   %s",
			ui.Bold(h.Title), miniBar(frac, 10),
			ui.Dim(fmt.Sprintf("Ch.%v · p.%d of %dch", h.LastChapterNumber, h.LastPage+1, h.TotalChapters)),
			ui.Gray(relativeTime(h.LastReadAt)))}
	}
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "history ❯ ", Header: fmt.Sprintf("%d titles", len(history))})
	if err != nil || idx < 0 {
		return err
	}
	h := history[idx]
	ref := api.MangaRef{ID: h.ID, Title: h.Title, Poster: h.CoverURL, Source: api.SourceID(h.Source)}
	return openManga(cfg, ref, h.LastChapterIndex, h.LastPage)
}

func genreFlow(cfg util.Config, name string) error {
	filters, err := withSpinner("loading genres …", func() (api.Filters, error) {
		f, _, e := api.FiltersAny()
		return f, e
	})
	if err != nil {
		return err
	}
	var genre *api.Genre
	for i, g := range filters.Genres {
		if strings.EqualFold(g.Name, strings.TrimSpace(name)) {
			genre = &filters.Genres[i]
			break
		}
	}
	if genre == nil {
		items := make([]ui.PickItem, len(filters.Genres))
		for i, g := range filters.Genres {
			items[i] = ui.PickItem{Label: ui.Bold(g.Name)}
		}
		idx, err := ui.Pick(items, ui.PickOpts{Prompt: "genre ❯ ", Header: "pick a genre"})
		if err != nil || idx < 0 {
			return err
		}
		genre = &filters.Genres[idx]
	}
	return browseWith(cfg, api.BrowseFilter{GenreID: genre.ID, Adult: cfg.Adult}, genre.Name)
}

func browseFlow(cfg util.Config) error {
	filters, err := withSpinner("loading filters …", func() (api.Filters, error) {
		f, _, e := api.FiltersAny()
		return f, e
	})
	if err != nil {
		return err
	}
	gi := []ui.PickItem{{Label: ui.Dim("— any genre —")}}
	for _, g := range filters.Genres {
		gi = append(gi, ui.PickItem{Label: ui.Bold(g.Name)})
	}
	gidx, err := ui.Pick(gi, ui.PickOpts{Prompt: "genre ❯ ", Header: "browse · pick a genre (or “any”)"})
	if err != nil || gidx < 0 {
		return err
	}
	f := api.BrowseFilter{Adult: cfg.Adult}
	crumbs := []string{}
	if gidx > 0 {
		f.GenreID = filters.Genres[gidx-1].ID
		crumbs = append(crumbs, filters.Genres[gidx-1].Name)
	}
	if len(filters.Statuses) > 0 {
		si := []ui.PickItem{{Label: ui.Dim("— any status —")}}
		for _, s := range filters.Statuses {
			si = append(si, ui.PickItem{Label: ui.Bold(s.Name)})
		}
		sidx, err := ui.Pick(si, ui.PickOpts{Prompt: "status ❯ ", Header: "filter by status"})
		if err != nil || sidx < 0 {
			return err
		}
		if sidx > 0 {
			f.Status = filters.Statuses[sidx-1].ID
			crumbs = append(crumbs, filters.Statuses[sidx-1].Name)
		}
	}
	sorts := []struct {
		label string
		v     api.BrowseSort
	}{{"Most popular", api.SortPopular}, {"Recently updated", api.SortLatest},
		{"Top rated", api.SortRating}, {"A → Z", api.SortAlphabetical}}
	so := make([]ui.PickItem, len(sorts))
	for i, s := range sorts {
		so[i] = ui.PickItem{Label: ui.Bold(s.label)}
	}
	soidx, err := ui.Pick(so, ui.PickOpts{Prompt: "sort ❯ ", Header: "sort by"})
	if err != nil || soidx < 0 {
		return err
	}
	f.Sort = sorts[soidx].v
	crumbs = append(crumbs, sorts[soidx].label)
	return browseWith(cfg, f, strings.Join(crumbs, " · "))
}

func browseWith(cfg util.Config, f api.BrowseFilter, crumbs string) error {
	results, err := withSpinner("browsing …", func() ([]api.SearchResult, error) {
		for _, id := range []api.SourceID{api.PrimaryID(), api.SrcAtsumaru, api.SrcMangaDex} {
			r, e := api.Get(id).Browse(f)
			if e == nil && len(r) > 0 {
				for i := range r {
					r[i].Source = id
				}
				return r, nil
			}
		}
		return nil, fmt.Errorf("no source could browse that combination")
	})
	if err != nil {
		return err
	}
	return pickAndOpen(cfg, results, fmt.Sprintf("%s · %d titles", crumbs, len(results)))
}

func recommendedFlow(cfg util.Config, query string) error {
	var seed *api.MangaRef
	if strings.TrimSpace(query) != "" {
		results, _, err := api.SearchAny(query, api.SearchOpts{Adult: cfg.Adult})
		if err != nil || len(results) == 0 {
			fmt.Println(ui.Yellow("No results for “" + query + "”."))
			return err
		}
		seed = &api.MangaRef{ID: results[0].ID, Title: results[0].Title, Source: results[0].Source}
	} else if h := util.MostRecent(); h != nil {
		seed = &api.MangaRef{ID: h.ID, Title: h.Title, Source: api.SourceID(h.Source)}
	} else {
		fmt.Println(ui.Yellow("Nothing to recommend from yet — read something first."))
		return nil
	}
	items, err := withSpinner("finding titles like "+seed.Title+" …", func() ([]api.DiscoveryItem, error) {
		return api.Get(seed.Source).Related(seed.ID, 0, cfg.Adult)
	})
	if err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println(ui.Yellow("No recommendations for " + seed.Title))
		return nil
	}
	results := make([]api.SearchResult, len(items))
	for i, it := range items {
		results[i] = api.SearchResult{ID: it.ID, Title: it.Title, Poster: it.Poster,
			Type: it.Type, IsAdult: it.IsAdult, Rating: it.Rating, Source: seed.Source}
	}
	return pickAndOpen(cfg, results, fmt.Sprintf("like %s · %d titles", seed.Title, len(items)))
}

func followFlow(cfg util.Config, query string) error {
	q := strings.TrimSpace(query)
	if q == "" {
		q = strings.TrimSpace(prompt(ui.Violet("follow manga ❯ ")))
		if q == "" {
			return nil
		}
	}
	results, _, err := api.SearchAny(q, api.SearchOpts{Adult: cfg.Adult})
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
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "manga ❯ ", Header: "pick a title to follow"})
	if err != nil || idx < 0 {
		return err
	}
	r := results[idx]
	info, err := api.Get(r.Source).Info(r.ID)
	if err != nil {
		return err
	}
	util.AddFollow(util.FollowEntry{ID: r.ID, Title: info.Title, Source: string(r.Source),
		CoverURL: r.Poster, ChapterCount: len(info.Chapters),
		FollowedAt: time.Now().UTC().Format(time.RFC3339)})
	fmt.Println(ui.Pink("♥ following ") + ui.Bold(info.Title) +
		ui.Dim(fmt.Sprintf("  (%d chapters) — see new releases with updates", len(info.Chapters))))
	return nil
}

func updatesFlow(cfg util.Config) error {
	follows := util.LoadFollows()
	if len(follows) == 0 {
		fmt.Println(ui.Yellow("Not following anything yet — press b in the reader, or run: manga-cli follow <title>"))
		return nil
	}
	type row struct {
		f     util.FollowEntry
		count int
	}
	rows, _ := withSpinner(fmt.Sprintf("checking %d followed title(s) …", len(follows)), func() ([]row, error) {
		out := make([]row, len(follows))
		type res struct {
			i     int
			count int
		}
		ch := make(chan res, len(follows))
		for i, f := range follows {
			go func(i int, f util.FollowEntry) {
				count := f.ChapterCount
				if info, err := api.Get(api.SourceID(f.Source)).Info(f.ID); err == nil {
					count = len(info.Chapters)
				}
				ch <- res{i, count}
			}(i, f)
		}
		for range follows {
			r := <-ch
			out[r.i] = row{follows[r.i], r.count}
		}
		return out, nil
	})
	fresh := 0
	items := make([]ui.PickItem, len(rows))
	for i, r := range rows {
		badge := ui.Dim("up to date")
		if r.count > r.f.ChapterCount {
			badge = ui.Green(fmt.Sprintf("+%d new", r.count-r.f.ChapterCount))
			fresh++
		}
		items[i] = ui.PickItem{Label: fmt.Sprintf("%s   %s%s",
			ui.Bold(r.f.Title), badge, ui.Dim(fmt.Sprintf("   %d ch", r.count)))}
	}
	idx, err := ui.Pick(items, ui.PickOpts{Prompt: "updates ❯ ",
		Header: fmt.Sprintf("%d with new chapters · %d followed", fresh, len(rows))})
	if err != nil || idx < 0 {
		return err
	}
	r := rows[idx]
	resumeCh := -1
	if r.count > r.f.ChapterCount {
		resumeCh = min(r.f.ChapterCount, r.count-1)
	}
	ref := api.MangaRef{ID: r.f.ID, Title: r.f.Title, Poster: r.f.CoverURL, Source: api.SourceID(r.f.Source)}
	oerr := openManga(cfg, ref, resumeCh, 0)
	util.MarkSeen(r.f.ID, r.count)
	return oerr
}

// ── info panels ────────────────────────────────────────────────────────────────

func statsFlow() error {
	history := util.LoadHistory()
	if len(history) == 0 {
		fmt.Println(ui.Yellow("No reading history yet — read something first."))
		return nil
	}
	s := util.ComputeStats(history)
	var out []string
	out = append(out, "", rule("your reading wrapped"), "",
		fmt.Sprintf("   %s chapters deep across %s titles",
			ui.Bold(ui.Cyan(fmt.Sprint(s.ChaptersProgressed))), ui.Bold(ui.Cyan(fmt.Sprint(s.Titles)))),
		fmt.Sprintf("   %s  %s  %s", ui.Green(fmt.Sprintf("✓ %d finished", s.Finished)), ui.Dim("·"),
			ui.Yellow(fmt.Sprintf("◐ %d in progress", s.InProgress))),
		"",
		fmt.Sprintf("   🔥 %s-day streak %s   📅 %s active days",
			ui.Bold(fmt.Sprint(s.CurrentStreak)), ui.Dim(fmt.Sprintf("(best %d)", s.LongestStreak)),
			ui.Bold(fmt.Sprint(s.ActiveDays))))
	if s.LastReadTitle != "" {
		out = append(out, "   "+ui.Dim("last read")+"  "+ui.Bold(s.LastReadTitle))
	}
	if len(s.TopTitles) > 0 {
		out = append(out, "", rule("most read"))
		maxCh := 1
		for _, t := range s.TopTitles {
			maxCh = max(maxCh, t.Chapters)
		}
		for _, t := range s.TopTitles {
			name := t.Title
			if len([]rune(name)) > 22 {
				name = string([]rune(name)[:21]) + "…"
			}
			pct := ui.Cyan(fmt.Sprintf("%3d%%", t.Pct))
			if t.Pct >= 100 {
				pct = ui.Green(fmt.Sprintf("%3d%%", t.Pct))
			}
			bar := int(float64(t.Chapters) / float64(maxCh) * 16)
			out = append(out, fmt.Sprintf("   %s %s%s %s  %s", ui.Bold(fmt.Sprintf("%-22s", name)),
				ui.Violet(strings.Repeat("█", bar)), ui.Dim(strings.Repeat("░", 16-bar)),
				ui.Dim(fmt.Sprintf("%9s", fmt.Sprintf("%d/%d", t.Chapters, t.Total))), pct))
		}
	}
	out = append(out, "", rule("by weekday"))
	days := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
	today := int(time.Now().Weekday())
	maxW := 1
	for _, n := range s.Weekday {
		maxW = max(maxW, n)
	}
	for i := 0; i < 7; i++ {
		name, marker := ui.Dim(days[i]), " "
		if i == today {
			name, marker = ui.Bold(ui.Cyan(days[i])), ui.Cyan("▸")
		}
		bar := s.Weekday[i] * 18 / maxW
		out = append(out, fmt.Sprintf("  %s%s %s%s %s", marker, name,
			ui.Cyan(strings.Repeat("█", bar)), ui.Dim(strings.Repeat("░", 18-bar)),
			ui.Dim(fmt.Sprint(s.Weekday[i]))))
	}
	out = append(out, "")
	fmt.Println(strings.Join(out, "\n"))
	return nil
}

func whereCmd(cfg util.Config) {
	dep := func(name string) string {
		note := ""
		if name == "aria2c" {
			note = ui.Dim(" (torrents)")
		}
		if _, err := execLook(name); err == nil {
			return ui.Green("✓ ") + name + note
		}
		return ui.Dim("· " + name + " (optional)")
	}
	mal := ui.Dim("not linked — manga-cli mal login")
	if util.MalLoggedIn() {
		mal = ui.Green("linked")
	}
	rows := []string{
		"", rule("paths"),
		row3("config", util.ConfigFile), row3("history", util.HistoryFile),
		row3("cache", util.CacheDir), row3("downloads", cfg.DownloadDir),
		"", rule("setup"),
		row3("sources", ui.Bold(cfg.Source)+ui.Dim(" → "+strings.Join(fallbackSansPrimary(cfg), " → "))),
		row3("reader", string(img.DetectProtocol(cfg.ReaderMode))+ui.Dim(" (built-in renderer — no chafa needed)")),
		row3("MAL", mal),
		row3("deps", ui.Green("none required!")+"  "+dep("aria2c")),
		"",
	}
	fmt.Println(strings.Join(rows, "\n"))
}

func row3(k, v string) string { return "   " + ui.Cyan(fmt.Sprintf("%-11s", k)) + v }

func fallbackSansPrimary(cfg util.Config) []string {
	var out []string
	for _, f := range cfg.Fallback {
		if f != cfg.Source {
			out = append(out, f)
		}
	}
	return out
}

func execLook(name string) (string, error) {
	return execLookPath(name)
}

func sourcesCmd(cfg util.Config, arg string) {
	if strings.EqualFold(strings.TrimSpace(arg), "reset") {
		api.ClearHealth()
		fmt.Println(ui.Green("✓ source health cache cleared") + ui.Dim(" — all sources back in play\n"))
	}
	down := api.DownSources()
	lines := []string{"", rule("sources")}
	for _, s := range api.AllSources() {
		mark, note := ui.Cyan("○ "), ""
		if down[s.ID()] {
			mark, note = ui.Yellow("◌ "), ui.Yellow("  cooling down · failed recently")
		} else if s.ID() == api.PrimaryID() {
			mark, note = ui.Green("● "), ui.Green("  primary")
		}
		lines = append(lines, fmt.Sprintf("  %s%s %s%s", mark, ui.Bold(fmt.Sprintf("%-12s", s.ID())), ui.Dim(s.Label()), note))
	}
	chain := append([]string{cfg.Source}, fallbackSansPrimary(cfg)...)
	lines = append(lines, "", ui.Dim("   fallback chain: "+strings.Join(chain, " → ")),
		ui.Dim("   set with -S <id>, or: manga-cli config set source <id>"), "")
	fmt.Println(strings.Join(lines, "\n"))
}

// ── MAL ────────────────────────────────────────────────────────────────────────

func malFlow(cfg util.Config, sub string) error {
	clientID := cfg.MalClientID
	if clientID == "" {
		clientID = os.Getenv("MAL_CLIENT_ID")
	}
	secret := cfg.MalClientSecret
	if secret == "" {
		secret = os.Getenv("MAL_CLIENT_SECRET")
	}
	if clientID == "" {
		fmt.Println(ui.Yellow("MyAnimeList isn't configured yet."))
		fmt.Println(ui.Dim("  1. Create an API app: ") + ui.Cyan("https://myanimelist.net/apiconfig"))
		fmt.Println(ui.Dim("  2. Set its App Redirect URL to: ") + ui.Cyan(util.MalRedirectURI))
		fmt.Println(ui.Dim("  3. Put \"malClientId\" + \"malClientSecret\" in ") + util.ConfigFile)
		fmt.Println(ui.Dim("     then run ") + ui.Bold("manga-cli mal login"))
		return nil
	}
	parts := strings.Fields(sub)
	action := "status"
	if len(parts) > 0 {
		action = strings.ToLower(parts[0])
	}
	arg := strings.Join(parts[min(1, len(parts)):], " ")

	switch action {
	case "logout":
		util.MalLogout()
		fmt.Println(ui.Dim("Unlinked MyAnimeList."))
	case "login":
		if arg != "" {
			if err := util.MalCompleteFromInput(clientID, secret, arg); err != nil {
				fmt.Println(ui.Red("✗ " + err.Error()))
				return nil
			}
			who := util.MalWhoAmI(clientID, secret)
			fmt.Println(ui.Green("✓ Linked MyAnimeList as "+who) + ui.Dim(" — progress syncs as you read."))
			return nil
		}
		authURL := util.MalBeginLogin(clientID)
		fmt.Println(ui.Bold("1) Approve access in your browser:"))
		fmt.Println("   " + ui.Cyan(authURL))
		fmt.Println(ui.Bold("\n2) ") + ui.Dim("The browser will land on a localhost page that ") +
			ui.Bold("won't load — that's normal.") + ui.Dim("\n   Copy that whole URL, then run (keep the quotes):\n"))
		fmt.Println("   " + ui.Cyan("manga-cli mal login '<paste-the-localhost-URL-here>'"))
	default: // status
		if who := util.MalWhoAmI(clientID, secret); who != "" {
			fmt.Println(ui.Green("MyAnimeList: linked as " + ui.Bold(who)))
		} else {
			fmt.Println(ui.Dim("MyAnimeList: not linked — run ") + ui.Bold("manga-cli mal login"))
		}
	}
	return nil
}
