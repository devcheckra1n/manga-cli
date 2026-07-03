// Package reader: the terminal manga reader — single pages, dual-page
// spreads, long-strip (webtoon) scrolling, RTL-aware navigation, zoom/fit,
// go-to-page, a HUD with a live progress scrubber, and a boxed help overlay.
// Images render through the built-in pipeline (no chafa).
package reader

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/img"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

// Context configures a reader session.
type Context struct {
	Manga        api.MangaRef
	Info         *api.MangaInfo
	StartChapter int // index into Info.Chapters
	StartPage    int
	Protocol     img.Protocol
	Direction    string // rtl | ltr
	DualPage     bool
	Fit          string // page | width
	Zoom         float64
	HudReserve   int
	Prefetch     int
	Webtoon      bool
	NoHistory    bool
	NoFollow     bool
	DownloadDir  string
	// LoadChapter overrides page loading (offline library). Nil = via source.
	LoadChapter func(idx int) (*api.ReadChapter, error)
}

// Action is how the reader session ended.
type Action string

const (
	ActQuit Action = "quit"
	ActJump Action = "jump" // back to the chapter list
	ActMenu Action = "menu" // back to the main menu
)

const clear = "\x1b[2J\x1b[H"

// Run opens the reader. Terminal state (raw+alt) is managed here.
func Run(ctx *Context) (Action, error) {
	if !ui.IsTTY() {
		return ActQuit, fmt.Errorf("the reader needs an interactive terminal")
	}
	if err := ui.RawOn(); err != nil {
		return ActQuit, err
	}
	ui.EnterAlt()
	defer func() {
		if ctx.Protocol == img.Kitty {
			os.Stdout.WriteString(img.KittyClear)
		}
		ui.LeaveAlt()
		ui.RawOff()
	}()

	r := &session{ctx: ctx, zoom: ctx.Zoom, dual: ctx.DualPage, fit: ctx.Fit,
		rtl: ctx.Direction != "ltr", webtoon: ctx.Webtoon, chIdx: ctx.StartChapter}
	if r.chIdx < 0 {
		r.chIdx = 0
	}
	if r.chIdx >= len(ctx.Info.Chapters) {
		r.chIdx = len(ctx.Info.Chapters) - 1
	}
	if err := r.loadChapter(r.chIdx); err != nil {
		return ActQuit, err
	}
	r.page = min(max(0, ctx.StartPage), max(0, len(r.ch.Pages)-1))
	return r.loop()
}

type session struct {
	ctx     *Context
	ch      *api.ReadChapter
	chIdx   int
	page    int
	rtl     bool
	dual    bool
	webtoon bool
	fit     string
	zoom    float64

	scroll    int // webtoon line offset
	stripMax  int
	stripEls  map[string][]string // pageID@width -> cell rows
	gotoBuf   string
	gotoMode  bool
	lastFlash string
	cellAsp   float64 // terminal cell h/w pixel ratio (anti-stretch)
}

func (r *session) aspect() float64 {
	if r.cellAsp == 0 {
		r.cellAsp = img.CellAspect()
	}
	return r.cellAsp
}

func (r *session) loadChapter(idx int) error {
	ch := r.ctx.Info.Chapters[idx]
	r.drawLoading(ch)
	var rc *api.ReadChapter
	var err error
	if r.ctx.LoadChapter != nil {
		rc, err = r.ctx.LoadChapter(idx)
	} else {
		rc, err = api.Get(r.ctx.Manga.Source).Pages(r.ctx.Manga.ID, ch.ID)
	}
	if err != nil {
		return err
	}
	r.ch = rc
	r.chIdx = idx
	r.stripEls = map[string][]string{}
	return nil
}

func (r *session) drawLoading(ch api.Chapter) {
	w, h := ui.Size()
	name := ch.Title
	if name == "" {
		name = "Chapter " + trimNum(ch.Number)
	}
	t1 := r.ctx.Manga.Title
	if len(t1) > w-4 {
		t1 = t1[:w-5] + "…"
	}
	t2 := name + " · loading …"
	row := max(1, h/2-1)
	out := clear +
		fmt.Sprintf("\x1b[%d;%dH", row, max(1, (w-len([]rune(t1)))/2+1)) + ui.Bold(ui.Violet(t1)) +
		fmt.Sprintf("\x1b[%d;%dH", row+2, max(1, (w-len(t2))/2+1)) + ui.Dim(t2)
	os.Stdout.WriteString(out)
}

// pagePath fetches (or reuses) the local file for a page.
func (r *session) pagePath(p api.Page) (string, error) {
	if strings.HasPrefix(p.URL, "file://") {
		return strings.TrimPrefix(p.URL, "file://"), nil
	}
	return api.CacheImage(util.PagesDir, p.URL)
}

func (r *session) prefetch() {
	if r.webtoon {
		return
	}
	span := r.ctx.Prefetch
	if r.dual {
		span++
	}
	for k := 1; k <= span; k++ {
		if r.page+k < len(r.ch.Pages) {
			p := r.ch.Pages[r.page+k]
			go func() { _, _ = r.pagePath(p) }()
		}
	}
}

func (r *session) record() {
	if r.ctx.NoHistory {
		return
	}
	ch := r.ctx.Info.Chapters[r.chIdx]
	util.RecordHistory(util.HistoryEntry{
		ID: r.ctx.Manga.ID, Title: r.ctx.Manga.Title, Source: string(r.ctx.Manga.Source),
		CoverURL: r.ctx.Manga.Poster, LastChapterID: ch.ID, LastChapterNumber: ch.Number,
		LastChapterTitle: ch.Title, LastChapterIndex: r.chIdx, LastPage: r.page,
		TotalChapters: len(r.ctx.Info.Chapters), LastReadAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// ── rendering ──────────────────────────────────────────────────────────────────

func (r *session) region() (cols, rows, availH int) {
	w, h := ui.Size()
	availH = max(1, h-r.ctx.HudReserve)
	cols = max(8, int(float64(w)*r.zoom))
	rows = max(4, int(float64(availH)*r.zoom))
	return cols, rows, availH
}

func (r *session) paintImage(path string, left, top, maxCols, maxRows int) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	im, err := img.Decode(data)
	if err != nil {
		return false
	}
	b := im.Bounds()
	cols, rows := img.FitCells(b.Dx(), b.Dy(), maxCols, maxRows, r.aspect())
	x := left + max(0, (maxCols-cols)/2)
	y := top + max(0, (maxRows-rows)/2)

	switch r.ctx.Protocol {
	case img.Kitty:
		seq, err := img.KittySeq(im, cols, rows)
		if err == nil {
			fmt.Printf("\x1b[%d;%dH%s", y, x, seq)
			return true
		}
	case img.ITerm2:
		fmt.Printf("\x1b[%d;%dH%s", y, x, img.ITermSeq(data, cols, rows))
		return true
	}
	// Universal half-block cells.
	lines := img.RenderCells(im, cols, rows)
	var sb strings.Builder
	for i, ln := range lines {
		sb.WriteString(fmt.Sprintf("\x1b[%d;%dH%s", y+i, x, ln))
	}
	os.Stdout.WriteString(sb.String())
	return true
}

func (r *session) renderSingle() {
	cols, rows, availH := r.region()
	w, _ := ui.Size()
	if r.page >= len(r.ch.Pages) {
		r.notice("· no pages in this chapter ·")
		return
	}
	path, err := r.pagePath(r.ch.Pages[r.page])
	if err != nil {
		r.notice("⚠  page failed to load — press r to retry")
		return
	}
	left := max(1, (w-cols)/2+1)
	top := max(1, (availH-rows)/2+1)
	if !r.paintImage(path, left, top, cols, rows) {
		r.notice("⚠  couldn't decode this page (format unsupported?)")
	}
}

func (r *session) renderDual() {
	cols, rows, availH := r.region()
	w, _ := ui.Size()
	half := cols / 2
	left0 := max(1, (w-half*2)/2+1)
	top := max(1, (availH-rows)/2+1)
	li, ri := r.page, r.page+1
	if r.rtl {
		li, ri = r.page+1, r.page
	}
	if li < len(r.ch.Pages) {
		if p, err := r.pagePath(r.ch.Pages[li]); err == nil {
			r.paintImage(p, left0, top, half, rows)
		}
	}
	if ri < len(r.ch.Pages) {
		if p, err := r.pagePath(r.ch.Pages[ri]); err == nil {
			r.paintImage(p, left0+half, top, half, rows)
		}
	}
}

// stripLines renders (and caches) a page as scrollable cell rows.
func (r *session) stripLines(p api.Page, width int) []string {
	key := fmt.Sprintf("%s@%d", p.ID, width)
	if l, ok := r.stripEls[key]; ok {
		return l
	}
	path, err := r.pagePath(p)
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	im, err := img.Decode(data)
	if err != nil {
		return nil
	}
	b := im.Bounds()
	// Strip rows follow the real cell aspect so long strips aren't stretched.
	rows := max(1, int(float64(b.Dy())*float64(width)/float64(max(1, b.Dx()))/r.aspect()))
	lines := img.RenderCells(im, width, rows)
	if len(r.stripEls) > 8 {
		r.stripEls = map[string][]string{}
	}
	r.stripEls[key] = lines
	return lines
}

func (r *session) renderWebtoon() {
	w, h := ui.Size()
	availH := max(1, h-r.ctx.HudReserve)
	width := max(8, int(float64(w)*r.zoom))
	if r.page >= len(r.ch.Pages) {
		r.notice("· no pages ·")
		return
	}
	lines := r.stripLines(r.ch.Pages[r.page], width)
	if lines == nil {
		r.notice("⚠  strip failed to render — press r")
		return
	}
	r.stripMax = max(0, len(lines)-availH)
	r.scroll = min(max(0, r.scroll), r.stripMax)
	col := max(1, (w-width)/2+1)
	var sb strings.Builder
	for i := 0; i < availH; i++ {
		if r.scroll+i >= len(lines) {
			break
		}
		sb.WriteString(fmt.Sprintf("\x1b[%d;%dH%s", i+1, col, lines[r.scroll+i]))
	}
	os.Stdout.WriteString(sb.String())
}

func (r *session) notice(msg string) {
	w, h := ui.Size()
	fmt.Printf("\x1b[%d;%dH%s", max(1, h/2), max(1, (w-len([]rune(msg)))/2), ui.Yellow(msg))
}

func (r *session) render(flash string) {
	if r.ctx.Protocol == img.Kitty {
		os.Stdout.WriteString(img.KittyClear)
	}
	os.Stdout.WriteString(clear)
	if r.webtoon {
		r.renderWebtoon()
	} else if r.dual && len(r.ch.Pages) > 1 {
		r.renderDual()
	} else {
		r.renderSingle()
	}
	r.drawHud(flash)
}

// drawHud paints the bottom bar: position, title, progress scrubber, flags.
func (r *session) drawHud(flash string) {
	w, h := ui.Size()
	ch := r.ctx.Info.Chapters[r.chIdx]
	total := len(r.ch.Pages)

	var pos, flags string
	var frac float64
	if r.webtoon {
		sc := 1.0
		if r.stripMax > 0 {
			sc = float64(r.scroll) / float64(r.stripMax)
		}
		if total > 0 {
			frac = min(1, (float64(r.page)+sc)/float64(total))
		}
		pos = fmt.Sprintf("p%d/%d", r.page+1, total)
		flags = fmt.Sprintf("strip %d%%", int(frac*100))
	} else {
		if total > 1 {
			frac = float64(r.page) / float64(total-1)
		} else {
			frac = 1
		}
		span := strconv.Itoa(min(r.page+1, total))
		if r.dual && r.page+1 < total {
			span = fmt.Sprintf("%d·%d", r.page+1, r.page+2)
		}
		pos = fmt.Sprintf("%s/%d", span, total)
		if r.rtl {
			flags = "rtl"
		} else {
			flags = "ltr"
		}
		if r.dual {
			flags += " · 2p"
		}
		if r.fit == "width" {
			flags += " · fit:w"
		}
	}
	if r.zoom != 1 {
		flags += fmt.Sprintf(" · %d%%", int(r.zoom*100))
	}

	left := " " + pos + " "
	mid := "Ch." + trimNum(ch.Number)
	if ch.Title != "" && ch.Title != "Chapter "+trimNum(ch.Number) {
		mid += " · " + ch.Title
	}
	right := " " + flags + " · ? help "
	if flash != "" {
		right = " " + flash + " "
	}
	const minBar = 6
	fixed := len([]rune(left)) + len([]rune(right)) + 3
	maxMid := w - fixed - minBar
	if len([]rune(mid)) > maxMid && maxMid > 1 {
		mid = string([]rune(mid)[:maxMid-1]) + "…"
	}
	barW := max(minBar, w-fixed-len([]rune(mid)))
	knob := max(0, min(barW-1, int(frac*float64(barW-1))))
	bar := ui.Cyan(strings.Repeat("━", knob)+"╸") + ui.Dim(strings.Repeat("─", barW-knob-1))

	rightC := ui.Dim(right)
	if flash != "" {
		rightC = ui.Green(right)
	}
	fmt.Printf("\x1b[%d;1H\x1b[2K%s %s %s %s", h,
		ui.Bold(ui.Violet(left)), ui.Cyan(mid), bar, rightC)
}

func (r *session) drawHelp() {
	mode := "left-to-right"
	if r.webtoon {
		mode = "long-strip"
	} else if r.rtl {
		mode = "right-to-left"
	}
	keys := [][2]string{
		{"→ ← / space", "turn page (direction-aware)"},
		{"n / p", "next / previous page"},
		{"] / [", "next / previous chapter"},
		{"g / G", "first / last page"},
		{": or #", "go to page — type a number, Enter"},
		{"w", "toggle long-strip (webtoon) mode"},
		{"d", "toggle dual-page spread"},
		{"t", "toggle reading direction"},
		{"f", "toggle fit (page / width)"},
		{"+ - 0", "zoom in / out / reset"},
		{"b", "follow / unfollow series"},
		{"s", "save current page"},
		{"r", "re-render (after a resize)"},
		{"j", "back to the chapter list"},
		{"m", "back to the main menu"},
		{"q / esc", "quit the reader"},
	}
	keyW, descW := 0, 0
	for _, kv := range keys {
		keyW = max(keyW, len([]rune(kv[0])))
		descW = max(descW, len(kv[1]))
	}
	innerW := 2 + keyW + 3 + descW + 2
	label := " reader · " + mode + " "
	foot := " any key to close "
	var box []string
	box = append(box, ui.Dim("╭─╴")+ui.Violet(label)+ui.Dim("╶"+strings.Repeat("─", max(0, innerW-len(label)-3))+"╮"))
	for _, kv := range keys {
		pad1 := strings.Repeat(" ", keyW-len([]rune(kv[0])))
		pad2 := strings.Repeat(" ", descW-len(kv[1]))
		box = append(box, ui.Dim("│")+"  "+ui.Bold(ui.Cyan(kv[0]))+pad1+"   "+kv[1]+pad2+"  "+ui.Dim("│"))
	}
	box = append(box, ui.Dim("╰─╴"+foot+"╶"+strings.Repeat("─", max(0, innerW-len(foot)-3))+"╯"))

	w, h := ui.Size()
	top := max(1, (h-len(box))/2)
	leftCol := max(1, (w-(innerW+2))/2)
	if r.ctx.Protocol == img.Kitty {
		os.Stdout.WriteString(img.KittyClear)
	}
	os.Stdout.WriteString(clear)
	for i, ln := range box {
		fmt.Printf("\x1b[%d;%dH%s", top+i, leftCol, ln)
	}
}

// ── the main loop ──────────────────────────────────────────────────────────────

func (r *session) loop() (Action, error) {
	keys := &ui.KeyReader{}
	r.render("")
	r.prefetch()
	r.record()

	for {
		key, err := keys.Next()
		if err != nil {
			return ActQuit, nil
		}

		if r.gotoMode {
			r.handleGoto(key)
			continue
		}

		flash := ""
		lastPage := len(r.ch.Pages) - 1
		step := 1
		if r.dual {
			step = 2
		}

		switch {
		case key == "q" || key == ui.KeyEsc || key == ui.KeyCtrlC:
			return ActQuit, nil
		case key == "j":
			return ActJump, nil
		case key == "m":
			return ActMenu, nil
		case key == "?":
			r.drawHelp()
			_, _ = keys.Next()
			r.render("")
			continue
		case key == ":" || key == "#":
			r.gotoMode = true
			r.gotoBuf = ""
			r.drawHud(fmt.Sprintf("go to page (1-%d): ▏", len(r.ch.Pages)))
			continue
		}

		next, prev := r.dirKeys(key)
		switch {
		case r.webtoon && (next || prev):
			r.webtoonScroll(next)
		case next:
			if r.page < lastPage-(step-1) {
				r.page = min(r.page+step, lastPage)
			} else if r.chIdx < len(r.ctx.Info.Chapters)-1 {
				if err := r.loadChapter(r.chIdx + 1); err != nil {
					flash = "⚠ " + err.Error()
				} else {
					r.page = 0
				}
			} else {
				flash = "✓ end of latest chapter"
			}
		case prev:
			if r.page > 0 {
				r.page = max(0, r.page-step)
			} else if r.chIdx > 0 {
				if err := r.loadChapter(r.chIdx - 1); err != nil {
					flash = "⚠ " + err.Error()
				} else {
					r.page = r.lastSpreadStart()
				}
			} else {
				flash = "start of first chapter"
			}
		case key == "]":
			if r.chIdx < len(r.ctx.Info.Chapters)-1 {
				if err := r.loadChapter(r.chIdx + 1); err == nil {
					r.page, r.scroll = 0, 0
				}
			} else {
				flash = "no next chapter"
			}
		case key == "[":
			if r.chIdx > 0 {
				if err := r.loadChapter(r.chIdx - 1); err == nil {
					r.page, r.scroll = 0, 0
				}
			} else {
				flash = "no previous chapter"
			}
		case key == "g":
			r.page, r.scroll = 0, 0
		case key == "G":
			r.page, r.scroll = r.lastSpreadStart(), 0
		case key == "w":
			r.webtoon = !r.webtoon
			r.scroll = 0
			if r.webtoon {
				flash = "long-strip mode"
			} else {
				flash = "page mode"
			}
		case key == "d":
			r.dual = !r.dual
			if r.dual {
				r.page -= r.page % 2
				flash = "dual-page on"
			} else {
				flash = "single-page"
			}
		case key == "t":
			r.rtl = !r.rtl
			if r.rtl {
				flash = "reading right-to-left"
			} else {
				flash = "reading left-to-right"
			}
		case key == "f":
			if r.fit == "page" {
				r.fit = "width"
				flash = "fit: fill width"
			} else {
				r.fit = "page"
				flash = "fit: whole page"
			}
		case key == "+" || key == "=":
			r.zoom = min(1.0, r.zoom+0.1)
			r.stripEls = map[string][]string{}
			flash = fmt.Sprintf("zoom %d%%", int(r.zoom*100))
		case key == "-" || key == "_":
			r.zoom = max(0.4, r.zoom-0.1)
			r.stripEls = map[string][]string{}
			flash = fmt.Sprintf("zoom %d%%", int(r.zoom*100))
		case key == "0":
			r.zoom = 1.0
			r.stripEls = map[string][]string{}
			flash = "zoom 100%"
		case key == "b":
			if r.ctx.NoFollow {
				flash = "following not available here"
			} else if util.ToggleFollow(util.FollowEntry{
				ID: r.ctx.Manga.ID, Title: r.ctx.Manga.Title, Source: string(r.ctx.Manga.Source),
				CoverURL: r.ctx.Manga.Poster, ChapterCount: len(r.ctx.Info.Chapters),
			}) {
				flash = "♥ following"
			} else {
				flash = "unfollowed"
			}
		case key == "s":
			if dest, err := r.savePage(); err == nil {
				flash = "saved → " + dest
			} else {
				flash = "save failed"
			}
		case key == "r":
			r.stripEls = map[string][]string{}
		default:
			continue
		}

		r.render(flash)
		r.prefetch()
		r.record()
	}
}

// dirKeys maps a key to (next, prev) honoring reading direction.
func (r *session) dirKeys(key ui.Key) (bool, bool) {
	switch key {
	case ui.KeyDown, "n", ui.KeySpace, ui.KeyEnter:
		return true, false
	case ui.KeyUp, "p":
		return false, true
	case ui.KeyRight, "l":
		return !r.rtl, r.rtl
	case ui.KeyLeft, "h":
		return r.rtl, !r.rtl
	}
	return false, false
}

func (r *session) webtoonScroll(down bool) {
	_, h := ui.Size()
	stepLines := max(1, h-r.ctx.HudReserve-3)
	if down {
		if r.scroll < r.stripMax {
			r.scroll = min(r.scroll+stepLines, r.stripMax)
		} else if r.page < len(r.ch.Pages)-1 {
			r.page++
			r.scroll = 0
		} else if r.chIdx < len(r.ctx.Info.Chapters)-1 {
			if err := r.loadChapter(r.chIdx + 1); err == nil {
				r.page, r.scroll = 0, 0
			}
		}
	} else {
		if r.scroll > 0 {
			r.scroll = max(0, r.scroll-stepLines)
		} else if r.page > 0 {
			r.page--
			r.scroll = 1 << 30 // clamped to the bottom on render
		} else if r.chIdx > 0 {
			if err := r.loadChapter(r.chIdx - 1); err == nil {
				r.page = len(r.ch.Pages) - 1
				r.scroll = 1 << 30
			}
		}
	}
}

func (r *session) lastSpreadStart() int {
	n := len(r.ch.Pages)
	if n <= 0 {
		return 0
	}
	last := n - 1
	if r.dual {
		return last - last%2
	}
	return last
}

func (r *session) handleGoto(key ui.Key) {
	switch key {
	case ui.KeyEnter:
		r.gotoMode = false
		if n, err := strconv.Atoi(r.gotoBuf); err == nil && n >= 1 && len(r.ch.Pages) > 0 {
			target := min(max(0, n-1), len(r.ch.Pages)-1)
			if r.dual {
				target -= target % 2
			}
			r.page = target
			r.scroll = 0
			r.render(fmt.Sprintf("→ page %d/%d", target+1, len(r.ch.Pages)))
			r.record()
		} else {
			r.render("")
		}
	case ui.KeyEsc, ui.KeyCtrlC, "q":
		r.gotoMode = false
		r.drawHud("")
	case ui.KeyBackspace:
		if r.gotoBuf != "" {
			r.gotoBuf = r.gotoBuf[:len(r.gotoBuf)-1]
		}
		r.drawHud(fmt.Sprintf("go to page (1-%d): %s▏", len(r.ch.Pages), r.gotoBuf))
	default:
		if len(key) == 1 && key[0] >= '0' && key[0] <= '9' && len(r.gotoBuf) < 6 {
			r.gotoBuf += string(key)
		}
		r.drawHud(fmt.Sprintf("go to page (1-%d): %s▏", len(r.ch.Pages), r.gotoBuf))
	}
}

func sanitize(s string) string {
	out := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, s)
	if len(out) > 80 {
		out = out[:80]
	}
	if strings.TrimSpace(out) == "" {
		return "manga"
	}
	return strings.TrimSpace(out)
}

// savePage copies the current cached page into the downloads folder.
func (r *session) savePage() (string, error) {
	if r.page >= len(r.ch.Pages) {
		return "", fmt.Errorf("no page")
	}
	path, err := r.pagePath(r.ch.Pages[r.page])
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	ch := r.ctx.Info.Chapters[r.chIdx]
	dir := r.ctx.DownloadDir
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = home
	}
	dir = dir + string(os.PathSeparator) + sanitize(r.ctx.Manga.Title)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	ext := ".webp"
	if i := strings.LastIndexByte(path, '.'); i > 0 {
		ext = path[i:]
	}
	dest := fmt.Sprintf("%s%cch%s_p%d%s", dir, os.PathSeparator, trimNum(ch.Number), r.page+1, ext)
	return dest, os.WriteFile(dest, data, 0o644)
}

func trimNum(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}
