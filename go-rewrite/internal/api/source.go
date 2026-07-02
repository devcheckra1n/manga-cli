// Source registry + fallback routing. Top-level operations try the primary,
// then each fallback in order until one answers. A manga remembers which
// source it came from, so info/chapters/pages route back to that same source.

package api

import (
	"fmt"
	"os"
)

var registry = map[SourceID]Source{
	SrcAtsumaru:    atsumaruSource{},
	SrcWeebCentral: weebcentralSource{},
	SrcMangaKatana: mangakatanaSource{},
	SrcMangaDex:    mangadexSource{},
}

var (
	primary   = SrcAtsumaru
	fallbacks = []SourceID{SrcWeebCentral, SrcMangaKatana, SrcMangaDex}
)

// AllSources returns every source in canonical order.
func AllSources() []Source {
	out := make([]Source, 0, len(AllSourceIDs))
	for _, id := range AllSourceIDs {
		out = append(out, registry[id])
	}
	return out
}

// Configure sets the primary source and the ordered fallbacks.
func Configure(primaryID SourceID, fallbackIDs []SourceID) {
	if _, ok := registry[primaryID]; ok {
		primary = primaryID
	}
	fallbacks = fallbacks[:0]
	for _, id := range fallbackIDs {
		if _, ok := registry[id]; ok && id != primary {
			fallbacks = append(fallbacks, id)
		}
	}
}

func PrimaryID() SourceID { return primary }

// Get returns the source a manga is bound to, or the primary for empty ids.
func Get(id SourceID) Source {
	if s, ok := registry[id]; ok {
		return s
	}
	return registry[primary]
}

// Chain is the ordered, de-duplicated source chain: primary, configured
// fallbacks, then any remaining available source as a last resort.
func Chain() []SourceID {
	seen := map[SourceID]bool{}
	var out []SourceID
	add := func(id SourceID) {
		if _, ok := registry[id]; ok && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	add(primary)
	for _, id := range fallbacks {
		add(id)
	}
	for _, id := range AllSourceIDs {
		if registry[id].Available() {
			add(id)
		}
	}
	return out
}

// liveOrderedChain puts healthy sources first and any in their failure
// cooldown last (still tried, but only as a last resort).
func liveOrderedChain() []SourceID {
	down := DownSources()
	var live, cooling []SourceID
	for _, id := range Chain() {
		if !registry[id].Available() {
			continue
		}
		if down[id] {
			cooling = append(cooling, id)
		} else {
			live = append(live, id)
		}
	}
	return append(live, cooling...)
}

func note(format string, args ...any) {
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[source] "+format+"\n", args...)
	}
}

// chainError blames the right thing: their servers or the user's wifi.
func chainError(lastErr error) error {
	if !HasInternet() {
		return apiErrf(0, "your internet connection looks down — nothing was marked unhealthy; retry when you're back online")
	}
	return lastErr
}

// SearchAny searches across the chain; returns the first source with results.
func SearchAny(query string, opts SearchOpts) ([]SearchResult, SourceID, error) {
	var lastErr error
	for _, id := range liveOrderedChain() {
		items, err := registry[id].Search(query, opts)
		if err != nil {
			lastErr = err
			if !MarkDown(id) {
				note("%s: failure not recorded (connection looks offline)", id)
			} else {
				note("%s failed: %v", id, err)
			}
			continue
		}
		MarkUp(id)
		if len(items) > 0 {
			for i := range items {
				items[i].Source = id
			}
			return items, id, nil
		}
		note("%s: no results, trying next", id)
	}
	if lastErr != nil {
		return nil, primary, chainError(lastErr)
	}
	return []SearchResult{}, primary, nil
}

// DiscoveryAny returns the first source that yields feed items.
func DiscoveryAny(kind DiscoveryKind, page int, adult bool) ([]DiscoveryItem, SourceID, error) {
	var lastErr error
	for _, id := range liveOrderedChain() {
		items, err := registry[id].Discovery(kind, page, adult)
		if err != nil {
			lastErr = err
			if !MarkDown(id) {
				note("%s: failure not recorded (connection looks offline)", id)
			} else {
				note("%s discovery failed: %v", id, err)
			}
			continue
		}
		MarkUp(id)
		if len(items) > 0 {
			for i := range items {
				items[i].Source = id
			}
			return items, id, nil
		}
	}
	if lastErr != nil {
		return nil, primary, chainError(lastErr)
	}
	return []DiscoveryItem{}, primary, nil
}

// FiltersAny returns genre filters from the first working source
// (genre ids are source-specific, so the source id rides along).
func FiltersAny() (Filters, SourceID, error) {
	var lastErr error
	for _, id := range liveOrderedChain() {
		filters, err := registry[id].Filters()
		if err != nil {
			lastErr = err
			if !MarkDown(id) {
				note("%s: failure not recorded (connection looks offline)", id)
			} else {
				note("%s filters failed: %v", id, err)
			}
			continue
		}
		MarkUp(id)
		if len(filters.Genres) > 0 {
			return filters, id, nil
		}
	}
	if lastErr == nil {
		lastErr = apiErrf(0, "No source could provide genres.")
	}
	return Filters{}, primary, chainError(lastErr)
}
