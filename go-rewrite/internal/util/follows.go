// Followed series — same ~/.config/manga-cli/follows.json as the TS version.
// Local-only: the stored chapter count is the baseline for "new chapters".

package util

import (
	"encoding/json"
	"os"
	"time"
)

type FollowEntry struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Source       string `json:"source,omitempty"`
	CoverURL     string `json:"coverUrl,omitempty"`
	ChapterCount int    `json:"chapterCount"`
	FollowedAt   string `json:"followedAt"`
}

type followsFile struct {
	Follows []FollowEntry `json:"follows"`
}

func LoadFollows() []FollowEntry {
	raw, err := os.ReadFile(FollowsFile)
	if err != nil {
		return nil
	}
	var f followsFile
	if json.Unmarshal(raw, &f) != nil {
		return nil
	}
	return f.Follows
}

func saveFollows(follows []FollowEntry) {
	blob, err := json.MarshalIndent(followsFile{Follows: follows}, "", "  ")
	if err != nil {
		return
	}
	if os.MkdirAll(ConfigDir, 0o755) != nil {
		return
	}
	_ = os.WriteFile(FollowsFile, blob, 0o644)
}

func IsFollowed(id string) bool {
	for _, f := range LoadFollows() {
		if f.ID == id {
			return true
		}
	}
	return false
}

func AddFollow(e FollowEntry) {
	out := []FollowEntry{e}
	for _, f := range LoadFollows() {
		if f.ID != e.ID {
			out = append(out, f)
		}
	}
	saveFollows(out)
}

func RemoveFollow(id string) {
	var out []FollowEntry
	for _, f := range LoadFollows() {
		if f.ID != id {
			out = append(out, f)
		}
	}
	saveFollows(out)
}

// ToggleFollow flips follow state; returns the new state (true = now followed).
func ToggleFollow(e FollowEntry) bool {
	if IsFollowed(e.ID) {
		RemoveFollow(e.ID)
		return false
	}
	e.FollowedAt = time.Now().UTC().Format(time.RFC3339)
	AddFollow(e)
	return true
}

// MarkSeen updates the stored baseline chapter count.
func MarkSeen(id string, count int) {
	follows := LoadFollows()
	for i := range follows {
		if follows[i].ID == id {
			follows[i].ChapterCount = count
			saveFollows(follows)
			return
		}
	}
}
