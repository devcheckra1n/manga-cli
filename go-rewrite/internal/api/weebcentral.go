// Weeb Central (weebcentral.com) source — an HTMX site (no JSON API), so we
// scrape its HTML fragments. Large, current scanlation library.

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
	wcBase = "https://weebcentral.com"
	wcTTL  = time.Hour
)

var wcHeaders = map[string]string{"Referer": wcBase + "/"}

var (
	wcCoverRe  = regexp.MustCompile(`src="(https://[^"]*/cover/[^"]*/([A-Z0-9]{10,})\.[a-z]+)"`)
	wcSeriesRe = regexp.MustCompile(`href="https://weebcentral\.com/series/([A-Z0-9]{10,})/[^"]*"[^>]*>([^<]{1,160})<`)
	wcTitleRe  = regexp.MustCompile(`(?i)<title>(.+?)(?:\s*\|\s*Weeb Central)?</title>`)
	wcStripRe  = regexp.MustCompile(`(?i)\b(Manhwa|Manhua|Webtoon|Long Strip)\b`)
	wcSvgRe    = regexp.MustCompile(`(?s)<svg.*?</svg>`)
	// Labels look like "Chapter 385", "Episode 5", or "# 122".
	wcChapterRe = regexp.MustCompile(`(?s)href="https://weebcentral\.com/chapters/([A-Z0-9]{10,})".{0,600}?>\s*(?:Chapter\s+|Episode\s+|#\s*)([0-9]+(?:\.[0-9]+)?)\s*<`)
	wcImageRe   = regexp.MustCompile(`(?i)src="(https://[^"]+\.(?:webp|jpg|jpeg|png|avif))"`)
)

type weebcentralSource struct{}

func (weebcentralSource) ID() SourceID    { return SrcWeebCentral }
func (weebcentralSource) Label() string   { return "Weeb Central (weebcentral.com)" }
func (weebcentralSource) Available() bool { return true }

func wcFragment(path string) (string, error) {
	return httpText(wcBase+path, wcHeaders)
}

// wcParseSeries parses weebcentral series cards (search + discovery fragments).
func wcParseSeries(doc string) []SearchResult {
	coverByID := map[string]string{}
	for _, m := range wcCoverRe.FindAllStringSubmatch(doc, -1) {
		coverByID[m[2]] = m[1]
	}
	var out []SearchResult
	seen := map[string]bool{}
	for _, m := range wcSeriesRe.FindAllStringSubmatch(doc, -1) {
		id := m[1]
		title := strings.TrimSpace(html.UnescapeString(m[2]))
		if title == "" || seen[id] {
			continue
		}
		seen[id] = true
		poster := coverByID[id]
		if poster == "" {
			poster = "https://temp.compsci88.com/cover/normal/" + id + ".webp"
		}
		out = append(out, SearchResult{
			ID: id, Title: title, Poster: poster, Type: "Manga", Source: SrcWeebCentral,
		})
	}
	return out
}

func (weebcentralSource) Search(query string, _ SearchOpts) ([]SearchResult, error) {
	key := "wc:search:" + query
	var cached []SearchResult
	if util.ReadCache(util.SearchCache, key, 10*time.Minute, &cached) {
		return cached, nil
	}
	params := url.Values{}
	params.Set("text", query)
	params.Set("sort", "Best Match")
	params.Set("order", "Descending")
	params.Set("official", "Any")
	params.Set("display_mode", "Full Display")
	doc, err := wcFragment("/search/data?" + params.Encode())
	if err != nil {
		return nil, err
	}
	results := wcParseSeries(doc)
	if len(results) > 24 {
		results = results[:24]
	}
	util.WriteCache(util.SearchCache, key, results)
	return results, nil
}

func (weebcentralSource) Discovery(kind DiscoveryKind, page int, _ bool) ([]DiscoveryItem, error) {
	path := "/hot-series"
	switch kind {
	case RecentlyAdded:
		path = fmt.Sprintf("/recently-added/%d", page+1)
	case RecentlyUpdated:
		path = fmt.Sprintf("/latest-updates/%d", page+1)
	}
	doc, err := wcFragment(path)
	if err != nil {
		return nil, err
	}
	results := wcParseSeries(doc)
	if len(results) > 32 {
		results = results[:32]
	}
	out := make([]DiscoveryItem, len(results))
	for i, r := range results {
		out[i] = DiscoveryItem{ID: r.ID, Title: r.Title, Poster: r.Poster, Type: r.Type, Source: SrcWeebCentral}
	}
	return out, nil
}

// No public genre listing; let another source provide genres.
func (weebcentralSource) Filters() (Filters, error) {
	return Filters{Genres: []Genre{}, Tags: []Genre{}, Types: []Genre{}, Statuses: []Genre{}}, nil
}
func (weebcentralSource) Browse(BrowseFilter) ([]SearchResult, error) {
	return []SearchResult{}, nil
}

func (weebcentralSource) Info(seriesID string) (*MangaInfo, error) {
	key := "wc:info:" + seriesID
	var cached MangaInfo
	if util.ReadCache(util.MangaCache, key, wcTTL, &cached) {
		return &cached, nil
	}

	page, err := wcFragment("/series/" + seriesID)
	if err != nil {
		return nil, err
	}
	title := "Untitled"
	if m := wcTitleRe.FindStringSubmatch(page); m != nil {
		title = strings.TrimSpace(html.UnescapeString(m[1]))
	}
	longStrip := wcStripRe.MatchString(page)

	// Strip the inline SVG icons first — they're huge and contain `#color`
	// codes that would otherwise be mistaken for "# 122"-style chapter labels.
	listDoc, err := wcFragment("/series/" + seriesID + "/full-chapter-list")
	if err != nil {
		return nil, err
	}
	listDoc = wcSvgRe.ReplaceAllString(listDoc, "")

	type rawCh struct {
		id  string
		num float64
	}
	var raw []rawCh
	seen := map[string]bool{}
	for _, m := range wcChapterRe.FindAllStringSubmatch(listDoc, -1) {
		if seen[m[1]] {
			continue
		}
		seen[m[1]] = true
		n, _ := strconv.ParseFloat(m[2], 64)
		raw = append(raw, rawCh{m[1], n})
	}
	sort.SliceStable(raw, func(a, b int) bool { return raw[a].num < raw[b].num })

	typ := "Manga"
	if longStrip {
		typ = "Manhwa"
	}
	info := MangaInfo{ID: seriesID, Title: title, Type: typ, ForceStrip: longStrip}
	for i, ch := range raw {
		info.Chapters = append(info.Chapters, Chapter{
			ID: ch.id, Title: "Chapter " + trimFloat(ch.num), Number: ch.num, Index: i,
		})
	}
	util.WriteCache(util.MangaCache, key, info)
	return &info, nil
}

func (weebcentralSource) Pages(_ string, chapterID string) (*ReadChapter, error) {
	key := "wc:pages:" + chapterID
	var cached ReadChapter
	if util.ReadCache(util.ChaptersCache, key, wcTTL, &cached) {
		return &cached, nil
	}
	doc, err := wcFragment("/chapters/" + chapterID + "/images?is_prev=False&current_page=1&reading_style=long_strip")
	if err != nil {
		return nil, err
	}
	out := ReadChapter{ID: chapterID}
	for i, m := range wcImageRe.FindAllStringSubmatch(doc, -1) {
		out.Pages = append(out.Pages, Page{
			ID: fmt.Sprintf("%s-%d", chapterID, i), URL: m[1], Number: i, AspectRatio: 1,
		})
	}
	util.WriteCache(util.ChaptersCache, key, out)
	return &out, nil
}

func (weebcentralSource) Related(string, int, bool) ([]DiscoveryItem, error) {
	return []DiscoveryItem{}, nil
}
