// Reading statistics derived from history.json (all local, no network).

package util

import (
	"sort"
	"time"
)

type TopTitle struct {
	Title    string
	Chapters int
	Total    int
	Pct      int
}

type Stats struct {
	Titles             int
	ChaptersProgressed int
	Finished           int
	InProgress         int
	TopTitles          []TopTitle
	Weekday            [7]int // Sun..Sat
	ActiveDays         int
	LongestStreak      int
	CurrentStreak      int
	Since              string
	LastReadTitle      string
}

func dayKey(t time.Time) string { return t.Local().Format("2006-01-02") }

func ComputeStats(history []HistoryEntry) Stats {
	var s Stats
	s.Titles = len(history)
	days := map[string]bool{}
	for _, h := range history {
		reached := max(h.LastChapterIndex+1, int(h.LastChapterNumber))
		s.ChaptersProgressed += max(0, h.LastChapterIndex+1)
		if h.TotalChapters > 0 && reached >= h.TotalChapters {
			s.Finished++
		} else {
			s.InProgress++
		}
		if t, err := time.Parse(time.RFC3339, h.LastReadAt); err == nil {
			s.Weekday[int(t.Local().Weekday())]++
			days[dayKey(t)] = true
			if s.Since == "" || h.LastReadAt < s.Since {
				s.Since = h.LastReadAt
			}
		}
	}
	for _, h := range history {
		ch := max(h.LastChapterIndex+1, 0)
		total := h.TotalChapters
		if total == 0 {
			total = ch
		}
		pct := 0
		if total > 0 {
			pct = ch * 100 / total
		}
		s.TopTitles = append(s.TopTitles, TopTitle{h.Title, ch, total, pct})
	}
	sort.SliceStable(s.TopTitles, func(a, b int) bool {
		return s.TopTitles[a].Chapters > s.TopTitles[b].Chapters
	})
	if len(s.TopTitles) > 8 {
		s.TopTitles = s.TopTitles[:8]
	}
	s.ActiveDays = len(days)
	s.LongestStreak, s.CurrentStreak = streaks(days)
	if len(history) > 0 {
		s.LastReadTitle = history[0].Title
	}
	return s
}

func streaks(days map[string]bool) (longest, current int) {
	if len(days) == 0 {
		return 0, 0
	}
	var times []time.Time
	for k := range days {
		if t, err := time.ParseInLocation("2006-01-02", k, time.Local); err == nil {
			times = append(times, t)
		}
	}
	sort.Slice(times, func(a, b int) bool { return times[a].Before(times[b]) })
	longest, run := 1, 1
	for i := 1; i < len(times); i++ {
		if int(times[i].Sub(times[i-1]).Hours()/24+0.5) == 1 {
			run++
		} else {
			run = 1
		}
		longest = max(longest, run)
	}
	// current streak: consecutive days ending today or yesterday
	cursor := time.Now().Local().Truncate(24 * time.Hour)
	if !days[dayKey(cursor)] {
		cursor = cursor.AddDate(0, 0, -1)
	}
	for days[dayKey(cursor)] {
		current++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return longest, current
}
