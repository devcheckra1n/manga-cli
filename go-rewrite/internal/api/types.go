// Package api: shared domain types, the HTTP client, the four content sources,
// and the fallback registry. JSON tags mirror the TypeScript field names so both
// implementations share cache entries, history, and follows files.
package api

// SourceID identifies which backend a manga came from.
type SourceID string

const (
	SrcAtsumaru    SourceID = "atsumaru"
	SrcWeebCentral SourceID = "weebcentral"
	SrcMangaKatana SourceID = "mangakatana"
	SrcMangaDex    SourceID = "mangadex"
)

// AllSourceIDs is the canonical display/fallback order.
var AllSourceIDs = []SourceID{SrcAtsumaru, SrcWeebCentral, SrcMangaKatana, SrcMangaDex}

func IsSourceID(s string) bool {
	for _, id := range AllSourceIDs {
		if string(id) == s {
			return true
		}
	}
	return false
}

// SearchResult is a manga as returned by search.
type SearchResult struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	EnglishTitle string   `json:"englishTitle,omitempty"`
	Poster       string   `json:"poster,omitempty"`
	Type         string   `json:"type"`
	Status       string   `json:"status,omitempty"`
	Year         int      `json:"year,omitempty"`
	IsAdult      bool     `json:"isAdult"`
	Rating       float64  `json:"rating,omitempty"`
	Popularity   string   `json:"popularity,omitempty"`
	Source       SourceID `json:"source,omitempty"`
}

// DiscoveryItem is a manga as returned by the discovery feeds.
type DiscoveryItem struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Poster  string   `json:"poster,omitempty"`
	Type    string   `json:"type"`
	IsAdult bool     `json:"isAdult"`
	Rating  float64  `json:"rating,omitempty"`
	Views   string   `json:"views,omitempty"`
	Source  SourceID `json:"source,omitempty"`
}

// MangaRef is a lightweight reference, enough to open a manga.
type MangaRef struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Poster string   `json:"poster,omitempty"`
	Source SourceID `json:"source,omitempty"`
}

// Chapter is a single chapter within a manga.
type Chapter struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Number    float64 `json:"number"`
	Index     int     `json:"index"`
	PageCount int     `json:"pageCount"`
	ScanID    string  `json:"scanId"`
	CreatedAt int64   `json:"createdAt,omitempty"` // epoch ms
}

// MangaInfo is the manga detail with its chapter list (ascending by number).
type MangaInfo struct {
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Type       string    `json:"type"`
	ForceStrip bool      `json:"forceStrip"`
	Chapters   []Chapter `json:"chapters"`
}

// Page is a single page image within a chapter.
type Page struct {
	ID          string  `json:"id"`
	URL         string  `json:"url"`
	Number      int     `json:"number"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
	AspectRatio float64 `json:"aspectRatio"`
}

// ReadChapter is a chapter's full page list, ready for the reader.
type ReadChapter struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	ScanID string `json:"scanId"`
	Pages  []Page `json:"pages"`
}

type Genre struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Filters struct {
	Genres   []Genre `json:"genres"`
	Tags     []Genre `json:"tags"`
	Types    []Genre `json:"types"`
	Statuses []Genre `json:"statuses"`
}

// DiscoveryKind names a discovery feed, mapped per-source to the nearest equivalent.
type DiscoveryKind string

const (
	Trending        DiscoveryKind = "trending"
	Popular         DiscoveryKind = "popular"
	RecentlyAdded   DiscoveryKind = "recentlyAdded"
	RecentlyUpdated DiscoveryKind = "recentlyUpdated"
	TopRated        DiscoveryKind = "topRated"
	MostBookmarked  DiscoveryKind = "mostBookmarked"
)

// BrowseSort is the abstract sort order for filtered browsing.
type BrowseSort string

const (
	SortPopular      BrowseSort = "popular"
	SortLatest       BrowseSort = "latest"
	SortRating       BrowseSort = "rating"
	SortAlphabetical BrowseSort = "alphabetical"
)

// BrowseFilter is a filtered-browse query. IDs come from Source.Filters().
type BrowseFilter struct {
	GenreID string
	Status  string
	Sort    BrowseSort
	Adult   bool
}

// SearchOpts are options for Source.Search.
type SearchOpts struct {
	Adult bool
	Page  int // 0-based
}

// Source is a content backend. Every read operation routes through one.
type Source interface {
	ID() SourceID
	Label() string
	// Available is false for sources we know are blocked (skipped in fallback).
	Available() bool
	Search(query string, opts SearchOpts) ([]SearchResult, error)
	Discovery(kind DiscoveryKind, page int, adult bool) ([]DiscoveryItem, error)
	Filters() (Filters, error)
	Browse(f BrowseFilter) ([]SearchResult, error)
	Info(mangaID string) (*MangaInfo, error)
	Pages(mangaID, chapterID string) (*ReadChapter, error)
	Related(mangaID string, page int, adult bool) ([]DiscoveryItem, error)
}
