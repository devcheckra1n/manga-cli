// Reading history — same ~/.config/manga-cli/history.json as the TS version,
// including the dedup-by-title behavior (one entry per series across sources).

package util

import (
	"encoding/json"
	"os"
	"strings"
)

type HistoryEntry struct {
	ID                string  `json:"id"`
	Title             string  `json:"title"`
	Source            string  `json:"source,omitempty"`
	CoverURL          string  `json:"coverUrl,omitempty"`
	LastChapterID     string  `json:"lastChapterId"`
	LastChapterNumber float64 `json:"lastChapterNumber"`
	LastChapterTitle  string  `json:"lastChapterTitle"`
	LastChapterIndex  int     `json:"lastChapterIndex"`
	LastPage          int     `json:"lastPage"`
	TotalChapters     int     `json:"totalChapters"`
	LastReadAt        string  `json:"lastReadAt"` // ISO 8601
}

type historyFile struct {
	History []HistoryEntry `json:"history"`
}

const maxHistory = 200

func titleKey(t string) string { return strings.ToLower(strings.TrimSpace(t)) }

// LoadHistory returns entries most-recent-first, duplicates collapsed by title.
func LoadHistory() []HistoryEntry {
	raw, err := os.ReadFile(HistoryFile)
	if err != nil {
		return nil
	}
	var f historyFile
	if json.Unmarshal(raw, &f) != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []HistoryEntry
	for _, h := range f.History {
		k := titleKey(h.Title)
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, h)
	}
	return out
}

// RecordHistory upserts by id or title and moves the entry to the front.
func RecordHistory(e HistoryEntry) {
	k := titleKey(e.Title)
	all := LoadHistory()
	out := []HistoryEntry{e}
	for _, h := range all {
		if h.ID == e.ID || titleKey(h.Title) == k {
			continue
		}
		out = append(out, h)
	}
	if len(out) > maxHistory {
		out = out[:maxHistory]
	}
	blob, err := json.MarshalIndent(historyFile{History: out}, "", "  ")
	if err != nil {
		return
	}
	if os.MkdirAll(ConfigDir, 0o755) != nil {
		return
	}
	_ = os.WriteFile(HistoryFile, blob, 0o644)
}

// MostRecent returns the newest entry, or nil.
func MostRecent() *HistoryEntry {
	h := LoadHistory()
	if len(h) == 0 {
		return nil
	}
	return &h[0]
}
