// MangaKatana (mangakatana.com) source — a plain HTML site we scrape. Chapter
// pages hide the real image list in a JS array (with decoy arrays alongside),
// so we pick the longest one.

package api

import (
	"fmt"
	"html"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const (
	mkBase = "https://mangakatana.com"
	mkTTL  = time.Hour
)

var mkHeaders = map[string]string{"Referer": mkBase + "/"}

var (
	mkH1Re    = regexp.MustCompile(`<h1 class="heading">([^<]+)</h1>`)
	mkCanonRe = regexp.MustCompile(`<link rel="canonical" href="(https://mangakatana\.com/manga/[^"]+)"`)
	mkOgImgRe = regexp.MustCompile(`<meta property="og:image" content="([^"]+)"`)
	mkItemRe  = regexp.MustCompile(`(?s)<div class="item" data-genre="[^"]*" data-id="\d+"(.*?)<h3 class="title">\s*<a[^>]*href="(https://mangakatana\.com/manga/[^"]+)"[^>]*>([^<]+)</a>`)
	mkCoverRe = regexp.MustCompile(`<img[^>]+src="(https://mangakatana\.com/imgs/[^"]+)"`)
	mkChapRe  = regexp.MustCompile(`(?i)href="https://mangakatana\.com/manga/[^"]*/(c[0-9.]+)"[^>]*>\s*(?:Chapter|Ch\.?|Episode)?\s*([0-9]+(?:\.[0-9]+)?)`)
	mkArrayRe = regexp.MustCompile(`(?s)var\s+[a-zA-Z_$]+\s*=\s*\[(.*?)\]\s*;`)
	mkImgRe   = regexp.MustCompile(`(?i)["'](https?://[^"']+\.(?:jpg|jpeg|png|webp|avif)[^"']*)["']`)
)

type mangakatanaSource struct{}

func (mangakatanaSource) ID() SourceID    { return SrcMangaKatana }
func (mangakatanaSource) Label() string   { return "MangaKatana (mangakatana.com)" }
func (mangakatanaSource) Available() bool { return true }

// mkIDFromURL: manga id = the path after /manga/, e.g. "berserk.1087".
func mkIDFromURL(raw string) string {
	s := strings.TrimPrefix(raw, "https://mangakatana.com/manga/")
	s = strings.TrimPrefix(s, "http://mangakatana.com/manga/")
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	return s
}

func mkParseSearch(doc string) []SearchResult {
	// A unique exact match 302s straight to the manga page (which has an
	// <h1 class="heading">); return just that title, not its "related" widget.
	h1 := mkH1Re.FindStringSubmatch(doc)
	canon := mkCanonRe.FindStringSubmatch(doc)
	if h1 != nil && canon != nil {
		cover := ""
		if m := mkOgImgRe.FindStringSubmatch(doc); m != nil {
			cover = m[1]
		}
		return []SearchResult{{
			ID:     mkIDFromURL(canon[1]),
			Title:  strings.TrimSpace(html.UnescapeString(h1[1])),
			Poster: cover,
			Type:   "Manga",
			Source: SrcMangaKatana,
		}}
	}
	// Otherwise a results list: only real result cards carry `data-id`.
	var out []SearchResult
	seen := map[string]bool{}
	for _, m := range mkItemRe.FindAllStringSubmatch(doc, -1) {
		id := mkIDFromURL(m[2])
		if seen[id] {
			continue
		}
		seen[id] = true
		cover := ""
		if c := mkCoverRe.FindStringSubmatch(m[1]); c != nil {
			cover = c[1]
		}
		out = append(out, SearchResult{
			ID: id, Title: strings.TrimSpace(html.UnescapeString(m[3])),
			Poster: cover, Type: "Manga", Source: SrcMangaKatana,
		})
	}
	return out
}

func (mangakatanaSource) Search(query string, _ SearchOpts) ([]SearchResult, error) {
	key := "mk:search:" + query
	var cached []SearchResult
	if util.ReadCache(util.SearchCache, key, 10*time.Minute, &cached) {
		return cached, nil
	}
	doc, err := httpText(mkBase+"/?search="+url.QueryEscape(query)+"&search_by=book_name", mkHeaders)
	if err != nil {
		return nil, err
	}
	results := mkParseSearch(doc)
	if len(results) > 24 {
		results = results[:24]
	}
	util.WriteCache(util.SearchCache, key, results)
	return results, nil
}

// Discovery/genres come from other sources; MangaKatana is a search+read backend.
func (mangakatanaSource) Discovery(DiscoveryKind, int, bool) ([]DiscoveryItem, error) {
	return []DiscoveryItem{}, nil
}
func (mangakatanaSource) Filters() (Filters, error) {
	return Filters{Genres: []Genre{}, Tags: []Genre{}, Types: []Genre{}, Statuses: []Genre{}}, nil
}
func (mangakatanaSource) Browse(BrowseFilter) ([]SearchResult, error) {
	return []SearchResult{}, nil
}

func (mangakatanaSource) Info(mangaID string) (*MangaInfo, error) {
	key := "mk:info:" + mangaID
	var cached MangaInfo
	if util.ReadCache(util.MangaCache, key, mkTTL, &cached) {
		return &cached, nil
	}

	doc, err := httpText(mkBase+"/manga/"+mangaID, mkHeaders)
	if err != nil {
		return nil, err
	}
	title := "Untitled"
	if m := mkH1Re.FindStringSubmatch(doc); m != nil {
		title = strings.TrimSpace(html.UnescapeString(m[1]))
	}
	// The page is noisy (sidebars, recommendations), so we don't auto-detect
	// long-strip here — readers can toggle it with `w`.

	type rawCh struct {
		seg string
		num float64
	}
	var raw []rawCh
	seen := map[string]bool{}
	for _, m := range mkChapRe.FindAllStringSubmatch(doc, -1) {
		if seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		n, _ := strconv.ParseFloat(m[2], 64)
		raw = append(raw, rawCh{m[1], n})
	}
	sort.SliceStable(raw, func(a, b int) bool { return raw[a].num < raw[b].num })

	info := MangaInfo{ID: mangaID, Title: title, Type: "Manga", ForceStrip: false}
	for i, ch := range raw {
		info.Chapters = append(info.Chapters, Chapter{
			ID: ch.seg, Title: "Chapter " + trimFloat(ch.num), Number: ch.num, Index: i,
		})
	}
	util.WriteCache(util.MangaCache, key, info)
	return &info, nil
}

func (mangakatanaSource) Pages(mangaID, chapterSeg string) (*ReadChapter, error) {
	key := fmt.Sprintf("mk:pages:%s/%s", mangaID, chapterSeg)
	var cached ReadChapter
	if util.ReadCache(util.ChaptersCache, key, mkTTL, &cached) {
		return &cached, nil
	}
	doc, err := httpText(mkBase+"/manga/"+mangaID+"/"+chapterSeg, mkHeaders)
	if err != nil {
		return nil, err
	}
	// Several `var x=[ '…' ]` arrays exist; only one holds the real images
	// (the rest are decoys). Pick the longest array of image URLs.
	var best []string
	for _, m := range mkArrayRe.FindAllStringSubmatch(doc, -1) {
		var urls []string
		for _, im := range mkImgRe.FindAllStringSubmatch(m[1], -1) {
			urls = append(urls, im[1])
		}
		if len(urls) > len(best) {
			best = urls
		}
	}
	out := ReadChapter{ID: chapterSeg}
	for i, u := range best {
		out.Pages = append(out.Pages, Page{
			ID: fmt.Sprintf("%s-%d", chapterSeg, i), URL: u, Number: i, AspectRatio: 1,
		})
	}
	util.WriteCache(util.ChaptersCache, key, out)
	return &out, nil
}

func (mangakatanaSource) Related(string, int, bool) ([]DiscoveryItem, error) {
	return []DiscoveryItem{}, nil
}
