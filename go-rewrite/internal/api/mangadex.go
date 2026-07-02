// MangaDex source (api.mangadex.org) — an open, documented JSON API.

package api

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const (
	mdAPI     = "https://api.mangadex.org"
	mdUploads = "https://uploads.mangadex.org"
	mdTTL     = time.Hour
)

var mdHeaders = map[string]string{
	"User-Agent": "manga-cli/2.0 (+https://github.com/devcheckra1n/manga-cli)",
}

type mangadexSource struct{}

func (mangadexSource) ID() SourceID    { return SrcMangaDex }
func (mangadexSource) Label() string   { return "MangaDex (mangadex.org)" }
func (mangadexSource) Available() bool { return true }

func mdURL(path string, params url.Values) string {
	if len(params) == 0 {
		return mdAPI + path
	}
	return mdAPI + path + "?" + params.Encode()
}

func mdRatings(adult bool) []string {
	if adult {
		return []string{"safe", "suggestive", "erotica", "pornographic"}
	}
	return []string{"safe", "suggestive"}
}

// ── API shapes ─────────────────────────────────────────────────────────────────

type mdTag struct {
	ID         string `json:"id"`
	Attributes struct {
		Name  map[string]string `json:"name"`
		Group string            `json:"group"`
	} `json:"attributes"`
}

type mdManga struct {
	ID         string `json:"id"`
	Attributes struct {
		Title                          map[string]string   `json:"title"`
		AltTitles                      []map[string]string `json:"altTitles"`
		Year                           *int                `json:"year"`
		Status                         string              `json:"status"`
		ContentRating                  string              `json:"contentRating"`
		AvailableTranslatedLanguages   []string            `json:"availableTranslatedLanguages"`
		Tags                           []mdTag             `json:"tags"`
	} `json:"attributes"`
	Relationships []struct {
		Type       string `json:"type"`
		ID         string `json:"id"`
		Attributes *struct {
			FileName string `json:"fileName"`
		} `json:"attributes"`
	} `json:"relationships"`
}

type mdChapter struct {
	ID         string `json:"id"`
	Attributes struct {
		Chapter            *string `json:"chapter"`
		Title              *string `json:"title"`
		Pages              int     `json:"pages"`
		TranslatedLanguage string  `json:"translatedLanguage"`
		PublishAt          string  `json:"publishAt"`
		CreatedAt          string  `json:"createdAt"`
	} `json:"attributes"`
	Relationships []struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"relationships"`
}

func mdPickTitle(m *mdManga) string {
	if t := m.Attributes.Title["en"]; t != "" {
		return t
	}
	for _, t := range m.Attributes.Title {
		if t != "" {
			return t
		}
	}
	for _, alt := range m.Attributes.AltTitles {
		if t := alt["en"]; t != "" {
			return t
		}
	}
	return "Untitled"
}

func mdCoverURL(m *mdManga) string {
	for _, r := range m.Relationships {
		if r.Type == "cover_art" && r.Attributes != nil && r.Attributes.FileName != "" {
			return fmt.Sprintf("%s/covers/%s/%s.512.jpg", mdUploads, m.ID, r.Attributes.FileName)
		}
	}
	return ""
}

func mdMapManga(m *mdManga) SearchResult {
	cr := m.Attributes.ContentRating
	status := m.Attributes.Status
	if status != "" {
		status = strings.ToUpper(status[:1]) + status[1:]
	}
	year := 0
	if m.Attributes.Year != nil {
		year = *m.Attributes.Year
	}
	return SearchResult{
		ID:      m.ID,
		Title:   mdPickTitle(m),
		Poster:  mdCoverURL(m),
		Type:    "Manga",
		Status:  status,
		Year:    year,
		IsAdult: cr == "pornographic" || cr == "erotica",
		Source:  SrcMangaDex,
	}
}

var mdOrder = map[DiscoveryKind][2]string{
	Trending:        {"order[followedCount]", "desc"},
	Popular:         {"order[followedCount]", "desc"},
	MostBookmarked:  {"order[followedCount]", "desc"},
	TopRated:        {"order[rating]", "desc"},
	RecentlyAdded:   {"order[createdAt]", "desc"},
	RecentlyUpdated: {"order[latestUploadedChapter]", "desc"},
}

func mdListManga(params url.Values) ([]SearchResult, error) {
	params.Set("limit", "24")
	params.Add("includes[]", "cover_art")
	params.Add("availableTranslatedLanguage[]", "en") // only titles with English chapters
	var res struct {
		Data []mdManga `json:"data"`
	}
	if err := httpJSON(mdURL("/manga", params), mdHeaders, &res); err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, len(res.Data))
	for i := range res.Data {
		out = append(out, mdMapManga(&res.Data[i]))
	}
	return out, nil
}

// mdRerank bubbles exact / prefix title matches up (MangaDex relevance is weak).
func mdRerank(results []SearchResult, query string) []SearchResult {
	q := strings.ToLower(strings.TrimSpace(query))
	type scored struct {
		r     SearchResult
		score int
	}
	rows := make([]scored, len(results))
	for i, r := range results {
		t := strings.ToLower(r.Title)
		score := i
		switch {
		case t == q:
			score -= 1000
		case strings.HasPrefix(t, q):
			score -= 500
		case strings.Contains(t, q):
			score -= 100
		}
		rows[i] = scored{r, score}
	}
	sort.SliceStable(rows, func(a, b int) bool { return rows[a].score < rows[b].score })
	out := make([]SearchResult, len(rows))
	for i, s := range rows {
		out[i] = s.r
	}
	return out
}

func (mangadexSource) Search(query string, opts SearchOpts) ([]SearchResult, error) {
	key := fmt.Sprintf("md:search:%s:%d:%d", query, boolInt(opts.Adult), opts.Page)
	var cached []SearchResult
	if util.ReadCache(util.SearchCache, key, 10*time.Minute, &cached) {
		return cached, nil
	}
	params := url.Values{}
	params.Set("title", query)
	params.Set("offset", strconv.Itoa(opts.Page*24))
	for _, r := range mdRatings(opts.Adult) {
		params.Add("contentRating[]", r)
	}
	params.Set("hasAvailableChapters", "true") // skip delicensed titles
	params.Set("order[relevance]", "desc")
	results, err := mdListManga(params)
	if err != nil {
		return nil, err
	}
	results = mdRerank(results, query)
	util.WriteCache(util.SearchCache, key, results)
	return results, nil
}

func (mangadexSource) Discovery(kind DiscoveryKind, page int, adult bool) ([]DiscoveryItem, error) {
	order, ok := mdOrder[kind]
	if !ok {
		order = mdOrder[Popular]
	}
	params := url.Values{}
	params.Set("offset", strconv.Itoa(page*24))
	for _, r := range mdRatings(adult) {
		params.Add("contentRating[]", r)
	}
	params.Set(order[0], order[1])
	params.Set("hasAvailableChapters", "true")
	results, err := mdListManga(params)
	if err != nil {
		return nil, err
	}
	out := make([]DiscoveryItem, len(results))
	for i, r := range results {
		out[i] = DiscoveryItem{
			ID: r.ID, Title: r.Title, Poster: r.Poster, Type: r.Type,
			IsAdult: r.IsAdult, Source: SrcMangaDex,
		}
	}
	return out, nil
}

func (mangadexSource) Filters() (Filters, error) {
	key := "md:tags"
	var cached Filters
	if util.ReadCache(util.MangaCache, key, 24*time.Hour, &cached) {
		return cached, nil
	}
	var res struct {
		Data []mdTag `json:"data"`
	}
	if err := httpJSON(mdURL("/manga/tag", nil), mdHeaders, &res); err != nil {
		return Filters{}, err
	}
	var genres []Genre
	for _, t := range res.Data {
		if t.Attributes.Group != "genre" && t.Attributes.Group != "theme" {
			continue
		}
		name := t.Attributes.Name["en"]
		if name == "" {
			for _, n := range t.Attributes.Name {
				name = n
				break
			}
		}
		genres = append(genres, Genre{ID: t.ID, Name: name})
	}
	sort.Slice(genres, func(a, b int) bool { return genres[a].Name < genres[b].Name })
	filters := Filters{
		Genres: genres,
		Tags:   []Genre{},
		Types:  []Genre{},
		Statuses: []Genre{
			{ID: "ongoing", Name: "Ongoing"},
			{ID: "completed", Name: "Completed"},
			{ID: "hiatus", Name: "Hiatus"},
			{ID: "cancelled", Name: "Cancelled"},
		},
	}
	util.WriteCache(util.MangaCache, key, filters)
	return filters, nil
}

func (mangadexSource) Browse(f BrowseFilter) ([]SearchResult, error) {
	orders := map[BrowseSort][2]string{
		SortPopular:      {"order[followedCount]", "desc"},
		SortLatest:       {"order[latestUploadedChapter]", "desc"},
		SortRating:       {"order[rating]", "desc"},
		SortAlphabetical: {"order[title]", "asc"},
	}
	order, ok := orders[f.Sort]
	if !ok {
		order = orders[SortPopular]
	}
	params := url.Values{}
	if f.GenreID != "" {
		params.Add("includedTags[]", f.GenreID)
	}
	if f.Status != "" {
		params.Add("status[]", f.Status)
	}
	for _, r := range mdRatings(f.Adult) {
		params.Add("contentRating[]", r)
	}
	params.Set("hasAvailableChapters", "true")
	params.Set(order[0], order[1])
	return mdListManga(params)
}

// mdFetchReadable paginates a manga's feed and keeps only readable
// (non-external, pages > 0) chapters.
func mdFetchReadable(mangaID string, langs []string) ([]mdChapter, error) {
	var raw []mdChapter
	offset := 0
	total := 1 << 30
	for offset < total && offset < 2000 {
		params := url.Values{}
		for _, l := range langs {
			params.Add("translatedLanguage[]", l)
		}
		params.Set("order[chapter]", "asc")
		params.Add("includes[]", "scanlation_group")
		for _, r := range []string{"safe", "suggestive", "erotica", "pornographic"} {
			params.Add("contentRating[]", r)
		}
		params.Set("limit", "100")
		params.Set("offset", strconv.Itoa(offset))
		var feed struct {
			Data  []mdChapter `json:"data"`
			Total int         `json:"total"`
		}
		if err := httpJSON(mdURL("/manga/"+mangaID+"/feed", params), mdHeaders, &feed); err != nil {
			return nil, err
		}
		raw = append(raw, feed.Data...)
		if feed.Total > 0 {
			total = feed.Total
		} else {
			total = len(raw)
		}
		offset += 100
		if len(feed.Data) == 0 {
			break
		}
	}
	out := raw[:0]
	for _, ch := range raw {
		if ch.Attributes.Pages > 0 {
			out = append(out, ch)
		}
	}
	return out, nil
}

func (mangadexSource) Info(mangaID string) (*MangaInfo, error) {
	key := "md:info:" + mangaID
	var cached MangaInfo
	if util.ReadCache(util.MangaCache, key, mdTTL, &cached) {
		return &cached, nil
	}

	params := url.Values{}
	params.Add("includes[]", "cover_art")
	var detail struct {
		Data mdManga `json:"data"`
	}
	if err := httpJSON(mdURL("/manga/"+mangaID, params), mdHeaders, &detail); err != nil {
		return nil, err
	}
	longStrip := false
	for _, t := range detail.Data.Attributes.Tags {
		if strings.EqualFold(t.Attributes.Name["en"], "long strip") {
			longStrip = true
			break
		}
	}

	// Prefer English; if it has no readable chapters, fall back to whichever
	// language has the most (so big multi-language titles still open).
	raw, err := mdFetchReadable(mangaID, []string{"en"})
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		var others []string
		for _, l := range detail.Data.Attributes.AvailableTranslatedLanguages {
			if l != "" && l != "en" {
				others = append(others, l)
			}
		}
		if len(others) > 0 {
			all, err := mdFetchReadable(mangaID, others)
			if err == nil {
				byLang := map[string][]mdChapter{}
				for _, ch := range all {
					l := ch.Attributes.TranslatedLanguage
					byLang[l] = append(byLang[l], ch)
				}
				for _, arr := range byLang {
					if len(arr) > len(raw) {
						raw = arr
					}
				}
			}
		}
	}

	// One release per chapter number (first scanlation wins).
	seen := map[string]bool{}
	var picked []mdChapter
	for _, ch := range raw {
		k := "oneshot:" + ch.ID
		if ch.Attributes.Chapter != nil {
			k = *ch.Attributes.Chapter
		}
		if seen[k] {
			continue
		}
		seen[k] = true
		picked = append(picked, ch)
	}
	chNum := func(ch mdChapter) float64 {
		if ch.Attributes.Chapter == nil {
			return 1e9
		}
		n, err := strconv.ParseFloat(*ch.Attributes.Chapter, 64)
		if err != nil {
			return 1e9
		}
		return n
	}
	sort.SliceStable(picked, func(a, b int) bool { return chNum(picked[a]) < chNum(picked[b]) })

	info := MangaInfo{
		ID:         mangaID,
		Title:      mdPickTitle(&detail.Data),
		Type:       "Manga",
		ForceStrip: longStrip,
	}
	for i, ch := range picked {
		title := ""
		if ch.Attributes.Title != nil {
			title = *ch.Attributes.Title
		}
		if title == "" {
			if ch.Attributes.Chapter != nil {
				title = "Chapter " + *ch.Attributes.Chapter
			} else {
				title = "Oneshot"
			}
		}
		num := chNum(ch)
		if num >= 1e9 {
			num = float64(i + 1)
		}
		scan := ""
		for _, r := range ch.Relationships {
			if r.Type == "scanlation_group" {
				scan = r.ID
				break
			}
		}
		created := int64(0)
		for _, ts := range []string{ch.Attributes.PublishAt, ch.Attributes.CreatedAt} {
			if ts == "" {
				continue
			}
			if t, err := time.Parse(time.RFC3339, ts); err == nil {
				created = t.UnixMilli()
				break
			}
		}
		info.Chapters = append(info.Chapters, Chapter{
			ID: ch.ID, Title: title, Number: num, Index: i,
			PageCount: ch.Attributes.Pages, ScanID: scan, CreatedAt: created,
		})
	}
	util.WriteCache(util.MangaCache, key, info)
	return &info, nil
}

func (mangadexSource) Pages(_ string, chapterID string) (*ReadChapter, error) {
	key := "md:pages:" + chapterID
	var cached ReadChapter
	if util.ReadCache(util.ChaptersCache, key, mdTTL, &cached) {
		return &cached, nil
	}
	var res struct {
		BaseURL string `json:"baseUrl"`
		Chapter struct {
			Hash string   `json:"hash"`
			Data []string `json:"data"`
		} `json:"chapter"`
	}
	if err := httpJSON(mdURL("/at-home/server/"+chapterID, nil), mdHeaders, &res); err != nil {
		return nil, err
	}
	out := ReadChapter{ID: chapterID}
	for i, file := range res.Chapter.Data {
		out.Pages = append(out.Pages, Page{
			ID:          fmt.Sprintf("%s-%d", chapterID, i),
			URL:         fmt.Sprintf("%s/data/%s/%s", res.BaseURL, res.Chapter.Hash, file),
			Number:      i,
			AspectRatio: 1,
		})
	}
	util.WriteCache(util.ChaptersCache, key, out)
	return &out, nil
}

// MangaDex has no public "similar" endpoint; recommendations fall back elsewhere.
func (mangadexSource) Related(string, int, bool) ([]DiscoveryItem, error) {
	return []DiscoveryItem{}, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
