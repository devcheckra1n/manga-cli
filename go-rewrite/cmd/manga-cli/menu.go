// The main menu — bare `manga-cli` lands here. Flows loop back when they
// finish; the reader's `m` key unwinds here from anywhere via errMenu.

package main

import (
	"errors"
	"fmt"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

type menuEntry struct {
	label string
	run   func() error
	pause bool // wait for Enter after (print-flows the picker would wipe)
}

func mainMenu(cfg util.Config) error {
	pad := func(s string) string {
		for len(s) < 10 {
			s += " "
		}
		return s
	}
	for {
		recent := util.MostRecent()
		entries := []menuEntry{
			{label: "🔍  " + ui.Bold(pad("search")) + " " + ui.Dim("find manga by title"),
				run: func() error { return searchFlow(cfg, "") }},
		}
		if recent != nil {
			entries = append(entries, menuEntry{
				label: "📖  " + ui.Bold(pad("continue")) + " " +
					ui.Dim(fmt.Sprintf("%s · Ch.%v", recent.Title, recent.LastChapterNumber)),
				run: func() error { return continueFlow(cfg) }})
		}
		entries = append(entries,
			menuEntry{label: "🎲  " + ui.Bold(pad("random")) + " " + ui.Dim("roll a random manga"),
				run: func() error { return randomFlow(cfg) }},
			menuEntry{label: "🔥  " + ui.Bold(pad("trending")) + " " + ui.Dim("what's hot right now"),
				run: func() error { return discoveryFlow(cfg, "trending", "trending") }},
			menuEntry{label: "⭐  " + ui.Bold(pad("popular")) + " " + ui.Dim("all-time favorites"),
				run: func() error { return discoveryFlow(cfg, "popular", "popular") }},
			menuEntry{label: "🆕  " + ui.Bold(pad("latest")) + " " + ui.Dim("fresh chapter updates"),
				run: func() error { return discoveryFlow(cfg, "recentlyUpdated", "latest updates") }},
			menuEntry{label: "🧭  " + ui.Bold(pad("browse")) + " " + ui.Dim("filter by genre · status · sort"),
				run: func() error { return browseFlow(cfg) }},
			menuEntry{label: "💜  " + ui.Bold(pad("updates")) + " " + ui.Dim("your followed series"),
				run: func() error { return updatesFlow(cfg) }},
			menuEntry{label: "🕘  " + ui.Bold(pad("history")) + " " + ui.Dim("recently read"),
				run: func() error { return historyFlow(cfg) }},
			menuEntry{label: "✨  " + ui.Bold(pad("for you")) + " " + ui.Dim("more like your last read"),
				run: func() error { return recommendedFlow(cfg, "") }},
			menuEntry{label: "📊  " + ui.Bold(pad("stats")) + " " + ui.Dim("your reading wrapped"),
				run: func() error { return statsFlow() }, pause: true},
			menuEntry{label: "🔧  " + ui.Bold(pad("config")) + " " + ui.Dim("settings editor"),
				run: func() error { return configFlow(&cfg, "") }},
		)
		items := make([]ui.PickItem, len(entries))
		for i, e := range entries {
			items[i] = ui.PickItem{Label: e.label}
		}
		idx, err := ui.Pick(items, ui.PickOpts{
			Prompt: "manga-cli ❯ ",
			Header: "what are we reading? · Esc to quit · m in the reader returns here",
		})
		if err != nil {
			return err
		}
		if idx < 0 {
			return nil
		}
		if err := entries[idx].run(); err != nil && !errors.Is(err, errMenu) {
			fmt.Println(ui.Red("✗ " + err.Error()))
			prompt(ui.Dim("\n  ⏎  back to the menu … "))
		} else if entries[idx].pause {
			prompt(ui.Dim("\n  ⏎  back to the menu … "))
		}
	}
}
