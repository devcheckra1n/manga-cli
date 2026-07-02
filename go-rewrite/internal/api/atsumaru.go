// Atsumaru (atsu.moe) source — Typesense same-origin search + Hono /api routes.
// This is the default/primary source.

package api

import (
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const (
	atsuQueryBy = "title,englishTitle,otherNames,authors"
	atsuWeights = "4,3,2,1"
	atsuInclude = "id,title,englishTitle,poster,posterSmall,posterMedium,type,isAdult,status,year,mbRating,populairty"
	atsuInfix   = "off,off,fallback,off"
	atsuTypes   = "Manga,Manwha,Manhua,OEL"
	atsuTTL     = time.Hour
)

var atsuSort = map[BrowseSort]string{
	SortPopular:      "views:desc",
	SortLatest:       "year:desc",
	SortRating:       "mbRating:desc",
	SortAlphabetical: "title:asc",
}

type atsumaruSource struct{}

func (atsumaruSource) ID() SourceID    { return SrcAtsumaru }
func (atsumaruSource) Label() string   { return "Atsumaru (atsu.moe)" }
func (atsumaruSource) Available() bool { return true }

// ── typesense document mapping ─────────────────────────────────────────────────

type tsResponse struct {
	Hits []struct {
		Document map[string]any `json:"document"`
	} `json:"hits"`
}

func docStr(d map[string]any, k string) string {
	if s, ok := d[k].(string); ok {
		return s
	}
	return ""
}
func docNum(d map[string]any, k string) float64 {
	if n, ok := d[k].(float64); ok {
		return n
	}
	return 0
}

func tsToResult(d map[string]any) SearchResult {
	poster := docStr(d, "poster")
	if poster == "" {
		poster = docStr(d, "posterMedium")
	}
	if poster == "" {
		poster = docStr(d, "posterSmall")
	}
	if poster != "" {
		poster = ResolveAssetURL(poster)
	}
	title := docStr(d, "title")
	if title == "" {
		title = docStr(d, "englishTitle")
	}
	if title == "" {
		title = "Untitled"
	}
	typ := docStr(d, "type")
	if typ == "" {
		typ = "Manga"
	}
	isAdult, _ := d["isAdult"].(bool)
	return SearchResult{
		ID:           fmt.Sprintf("%v", d["id"]),
		Title:        title,
		EnglishTitle: docStr(d, "englishTitle"),
		Poster:       poster,
		Type:         typ,
		Status:       docStr(d, "status"),
		Year:         int(docNum(d, "year")),
		IsAdult:      isAdult,
		Rating:       docNum(d, "mbRating"),
		Popularity:   docStr(d, "populairty"), // (sic) — the API misspells it
	}
}

func atsuRunSearch(q string, opts SearchOpts, filterBy, sort string) ([]SearchResult, error) {
	filters := "hidden:!=true"
	if !opts.Adult {
		filters += " && isAdult:=false"
	}
	if filterBy != "" {
		filters += " && " + filterBy
	}
	params := url.Values{}
	if q == "" {
		params.Set("q", "*")
	} else {
		params.Set("q", q)
	}
	params.Set("query_by", atsuQueryBy)
	params.Set("query_by_weights", atsuWeights)
	params.Set("include_fields", atsuInclude)
	params.Set("filter_by", filters)
	params.Set("per_page", "24")
	params.Set("page", strconv.Itoa(opts.Page+1)) // search is 1-based
	if q != "" {
		params.Set("infix", atsuInfix)
	} else if sort != "" {
		params.Set("sort_by", sort)
	}

	key := "go:atsu:search:" + params.Encode()
	var cached []SearchResult
	if util.ReadCache(util.SearchCache, key, 10*time.Minute, &cached) {
		return cached, nil
	}
	var res tsResponse
	if err := apiGet("/collections/manga/documents/search", params, &res); err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, len(res.Hits))
	for _, h := range res.Hits {
		out = append(out, tsToResult(h.Document))
	}
	util.WriteCache(util.SearchCache, key, out)
	return out, nil
}

func (atsumaruSource) Search(query string, opts SearchOpts) ([]SearchResult, error) {
	return atsuRunSearch(query, opts, "", "")
}

func (atsumaruSource) Browse(f BrowseFilter) ([]SearchResult, error) {
	filterBy := ""
	if f.GenreID != "" {
		filterBy = "genreIds:=" + f.GenreID
	}
	if f.Status != "" {
		if filterBy != "" {
			filterBy += " && "
		}
		filterBy += "status:=" + f.Status
	}
	sort := atsuSort[f.Sort]
	if sort == "" {
		sort = "views:desc"
	}
	return atsuRunSearch("", SearchOpts{Adult: f.Adult}, filterBy, sort)
}

// ── discovery / related feeds ──────────────────────────────────────────────────

type atsuInfinite struct {
	Items []map[string]any `json:"items"`
}

func atsuMapItems(items []map[string]any) []DiscoveryItem {
	out := make([]DiscoveryItem, 0, len(items))
	for _, it := range items {
		poster := ""
		for _, k := range []string{"image", "mediumImage", "smallImage", "largeImage", "poster"} {
			if s := docStr(it, k); s != "" {
				poster = ResolveAssetURL(s)
				break
			}
		}
		title := docStr(it, "title")
		if title == "" {
			title = "Untitled"
		}
		typ := docStr(it, "type")
		if typ == "" {
			typ = "Manga"
		}
		isAdult, _ := it["isAdult"].(bool)
		out = append(out, DiscoveryItem{
			ID:      fmt.Sprintf("%v", it["id"]),
			Title:   title,
			Poster:  poster,
			Type:    typ,
			IsAdult: isAdult,
			Rating:  docNum(it, "mbRating"),
			Views:   docStr(it, "views"),
		})
	}
	return out
}

func (atsumaruSource) Discovery(kind DiscoveryKind, page int, adult bool) ([]DiscoveryItem, error) {
	params := url.Values{}
	params.Set("page", strconv.Itoa(page))
	params.Set("types", atsuTypes)
	if adult {
		params.Set("adult", "1")
	}
	var res atsuInfinite
	if err := apiGet("/api/infinite/"+string(kind), params, &res); err != nil {
		return nil, err
	}
	return atsuMapItems(res.Items), nil
}

func (atsumaruSource) Related(mangaID string, page int, adult bool) ([]DiscoveryItem, error) {
	params := url.Values{}
	params.Set("mangaId", mangaID)
	params.Set("page", strconv.Itoa(page))
	params.Set("types", atsuTypes)
	if adult {
		params.Set("adult", "1")
	}
	var res atsuInfinite
	if err := apiGet("/api/infinite/mangaRecommendations", params, &res); err != nil {
		return nil, err
	}
	return atsuMapItems(res.Items), nil
}

// ── filters / info / pages ─────────────────────────────────────────────────────

func (atsumaruSource) Filters() (Filters, error) {
	key := "go:atsu:filters"
	var cached Filters
	if util.ReadCache(util.MangaCache, key, atsuTTL, &cached) {
		return cached, nil
	}
	var res Filters
	if err := apiGet("/api/explore/availableFilters", nil, &res); err != nil {
		return Filters{}, err
	}
	util.WriteCache(util.MangaCache, key, res)
	return res, nil
}

type atsuInfoResponse struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Type       string `json:"type"`
	ForceStrip bool   `json:"forceStrip"`
	Chapters   []struct {
		ID                string  `json:"id"`
		Title             string  `json:"title"`
		Number            float64 `json:"number"`
		Index             int     `json:"index"`
		PageCount         int     `json:"pageCount"`
		ScanID            string  `json:"scanId"`
		ScanlationMangaID string  `json:"scanlationMangaId"`
		CreatedAt         int64   `json:"createdAt"`
	} `json:"chapters"`
}

func (atsumaruSource) Info(mangaID string) (*MangaInfo, error) {
	key := "info:" + mangaID // same key as the TS cache
	var cached MangaInfo
	if util.ReadCache(util.MangaCache, key, atsuTTL, &cached) {
		return &cached, nil
	}
	params := url.Values{}
	params.Set("mangaId", mangaID)
	var res atsuInfoResponse
	if err := apiGet("/api/manga/info", params, &res); err != nil {
		return nil, err
	}
	typ := res.Type
	if typ == "" {
		typ = "Manga"
	}
	info := MangaInfo{ID: res.ID, Title: res.Title, Type: typ, ForceStrip: res.ForceStrip}
	for _, c := range res.Chapters {
		title := c.Title
		if title == "" {
			title = fmt.Sprintf("Chapter %s", trimFloat(c.Number))
		}
		scan := c.ScanID
		if scan == "" {
			scan = c.ScanlationMangaID
		}
		info.Chapters = append(info.Chapters, Chapter{
			ID: c.ID, Title: title, Number: c.Number, Index: c.Index,
			PageCount: c.PageCount, ScanID: scan, CreatedAt: c.CreatedAt,
		})
	}
	util.WriteCache(util.MangaCache, key, info)
	return &info, nil
}

type atsuReadResponse struct {
	ReadChapter *struct {
		ID                string `json:"id"`
		Title             string `json:"title"`
		ScanlationMangaID string `json:"scanlationMangaId"`
		Pages             []struct {
			ID          string  `json:"id"`
			Image       string  `json:"image"`
			Number      int     `json:"number"`
			Width       int     `json:"width"`
			Height      int     `json:"height"`
			AspectRatio float64 `json:"aspectRatio"`
		} `json:"pages"`
	} `json:"readChapter"`
}

func (atsumaruSource) Pages(mangaID, chapterID string) (*ReadChapter, error) {
	key := fmt.Sprintf("read:%s:%s", mangaID, chapterID) // same key as the TS cache
	var cached ReadChapter
	if util.ReadCache(util.ChaptersCache, key, atsuTTL, &cached) {
		return &cached, nil
	}
	params := url.Values{}
	params.Set("mangaId", mangaID)
	params.Set("chapterId", chapterID)
	var res atsuReadResponse
	if err := apiGet("/api/read/chapter", params, &res); err != nil {
		return nil, err
	}
	if res.ReadChapter == nil {
		return nil, apiErrf(0, "Chapter has no readable pages.")
	}
	rc := res.ReadChapter
	out := ReadChapter{ID: rc.ID, Title: rc.Title, ScanID: rc.ScanlationMangaID}
	for _, p := range rc.Pages {
		out.Pages = append(out.Pages, Page{
			ID: p.ID, URL: ResolveAssetURL(p.Image), Number: p.Number,
			Width: p.Width, Height: p.Height, AspectRatio: p.AspectRatio,
		})
	}
	util.WriteCache(util.ChaptersCache, key, out)
	return &out, nil
}

// trimFloat renders 12 as "12" and 12.5 as "12.5".
func trimFloat(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}
