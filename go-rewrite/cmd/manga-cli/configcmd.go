// The config command: interactive settings editor + get / set / edit / path.
// Secrets are masked in every listing.

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

type settingKind int

const (
	kEnum settingKind = iota
	kBool
	kNumber
	kString
	kSources
)

type settingMeta struct {
	key     string
	kind    settingKind
	desc    string
	options []string
	minV    float64
	maxV    float64
	secret  bool
	get     func(c *util.Config) string
	set     func(c *util.Config, v string)
}

func settingsTable() []settingMeta {
	srcs := make([]string, len(api.AllSourceIDs))
	for i, s := range api.AllSourceIDs {
		srcs[i] = string(s)
	}
	return []settingMeta{
		{key: "source", kind: kEnum, desc: "primary content source", options: srcs,
			get: func(c *util.Config) string { return c.Source }, set: func(c *util.Config, v string) { c.Source = v }},
		{key: "fallback", kind: kSources, desc: "ordered backup sources (comma-separated)",
			get: func(c *util.Config) string { return strings.Join(c.Fallback, ", ") },
			set: func(c *util.Config, v string) {
				var out []string
				for _, s := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' }) {
					if api.IsSourceID(s) {
						out = append(out, s)
					}
				}
				c.Fallback = out
			}},
		{key: "readerMode", kind: kEnum, desc: "image protocol", options: []string{"auto", "kitty", "iterm2", "cells"},
			get: func(c *util.Config) string { return c.ReaderMode }, set: func(c *util.Config, v string) { c.ReaderMode = v }},
		{key: "direction", kind: kEnum, desc: "reading direction (manga = rtl)", options: []string{"rtl", "ltr"},
			get: func(c *util.Config) string { return c.Direction }, set: func(c *util.Config, v string) { c.Direction = v }},
		{key: "dualPage", kind: kBool, desc: "two-page spreads",
			get: func(c *util.Config) string { return fmt.Sprint(c.DualPage) },
			set: func(c *util.Config, v string) { c.DualPage = v == "true" }},
		{key: "fit", kind: kEnum, desc: "single-page fit", options: []string{"page", "width"},
			get: func(c *util.Config) string { return c.Fit }, set: func(c *util.Config, v string) { c.Fit = v }},
		{key: "zoom", kind: kNumber, desc: "render scale", minV: 0.4, maxV: 1.0,
			get: func(c *util.Config) string { return strconv.FormatFloat(c.Zoom, 'f', -1, 64) },
			set: func(c *util.Config, v string) { f, _ := strconv.ParseFloat(v, 64); c.Zoom = f }},
		{key: "hudReserve", kind: kNumber, desc: "rows reserved for the reader HUD", minV: 1, maxV: 6,
			get: func(c *util.Config) string { return strconv.Itoa(c.HudReserve) },
			set: func(c *util.Config, v string) { n, _ := strconv.Atoi(v); c.HudReserve = n }},
		{key: "prefetchPages", kind: kNumber, desc: "pages to prefetch while reading", minV: 0, maxV: 8,
			get: func(c *util.Config) string { return strconv.Itoa(c.PrefetchPages) },
			set: func(c *util.Config, v string) { n, _ := strconv.Atoi(v); c.PrefetchPages = n }},
		{key: "showBanner", kind: kBool, desc: "show the ASCII banner",
			get: func(c *util.Config) string { return fmt.Sprint(c.ShowBanner) },
			set: func(c *util.Config, v string) { c.ShowBanner = v == "true" }},
		{key: "adult", kind: kBool, desc: "include 18+ results",
			get: func(c *util.Config) string { return fmt.Sprint(c.Adult) },
			set: func(c *util.Config, v string) { c.Adult = v == "true" }},
		{key: "downloadDir", kind: kString, desc: "downloads folder",
			get: func(c *util.Config) string { return c.DownloadDir },
			set: func(c *util.Config, v string) { c.DownloadDir = util.ExpandTilde(v) }},
		{key: "malClientId", kind: kString, desc: "MyAnimeList API client id", secret: true,
			get: func(c *util.Config) string { return c.MalClientID },
			set: func(c *util.Config, v string) { c.MalClientID = v }},
		{key: "malClientSecret", kind: kString, desc: "MyAnimeList API client secret", secret: true,
			get: func(c *util.Config) string { return c.MalClientSecret },
			set: func(c *util.Config, v string) { c.MalClientSecret = v }},
	}
}

func showValue(m settingMeta, cfg *util.Config) string {
	v := m.get(cfg)
	if m.secret {
		if v == "" {
			return "(not set)"
		}
		return v[:min(4, len(v))] + "…"
	}
	if v == "" {
		return "(empty)"
	}
	return v
}

// validate returns an error message, or "" if raw is acceptable.
func validate(m settingMeta, raw string) string {
	v := strings.TrimSpace(raw)
	switch m.kind {
	case kEnum:
		for _, o := range m.options {
			if o == v {
				return ""
			}
		}
		return "must be one of: " + strings.Join(m.options, " · ")
	case kBool:
		if v == "true" || v == "false" {
			return ""
		}
		return "must be true or false"
	case kNumber:
		n, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return "must be a number"
		}
		if n < m.minV || n > m.maxV {
			return fmt.Sprintf("must be between %v and %v", m.minV, m.maxV)
		}
	case kSources:
		for _, s := range strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' }) {
			if !api.IsSourceID(s) {
				return "unknown source “" + s + "”"
			}
		}
	}
	return ""
}

func configFlow(cfg *util.Config, sub string) error {
	parts := strings.Fields(sub)
	action := ""
	if len(parts) > 0 {
		action = strings.ToLower(parts[0])
	}
	table := settingsTable()

	switch action {
	case "path":
		fmt.Println(util.ConfigFile)
		return nil
	case "edit":
		editor := os.Getenv("VISUAL")
		if editor == "" {
			editor = os.Getenv("EDITOR")
		}
		if editor == "" {
			editor = "nano"
		}
		cmd := exec.Command(editor, util.ConfigFile)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		return cmd.Run()
	case "get":
		var list []settingMeta
		if len(parts) > 1 {
			for _, m := range table {
				if m.key == parts[1] {
					list = append(list, m)
				}
			}
			if len(list) == 0 {
				fmt.Println(ui.Red("unknown setting “" + parts[1] + "”"))
				return nil
			}
		} else {
			list = table
		}
		for _, m := range list {
			fmt.Printf("  %s  %s  %s\n", ui.Cyan(fmt.Sprintf("%-15s", m.key)),
				ui.Bold(showValue(m, cfg)), ui.Dim(m.desc))
		}
		return nil
	case "set":
		if len(parts) < 3 {
			fmt.Println(ui.Yellow("usage: manga-cli config set <key> <value>"))
			return nil
		}
		for _, m := range table {
			if m.key != parts[1] {
				continue
			}
			raw := strings.Join(parts[2:], " ")
			if msg := validate(m, raw); msg != "" {
				fmt.Println(ui.Red("✗ " + m.key + ": " + msg))
				return nil
			}
			m.set(cfg, strings.TrimSpace(raw))
			if err := util.SaveConfig(*cfg); err != nil {
				return err
			}
			fmt.Println(ui.Green("✓ "+m.key) + ui.Dim(" = ") + ui.Bold(showValue(m, cfg)))
			return nil
		}
		fmt.Println(ui.Red("unknown setting “" + parts[1] + "”") + ui.Dim(" — see: manga-cli config get"))
		return nil
	}

	// Interactive editor: pick a setting → pick/enter a value → save → repeat.
	for {
		items := make([]ui.PickItem, len(table))
		for i, m := range table {
			items[i] = ui.PickItem{Label: fmt.Sprintf("%s  %s  %s",
				ui.Cyan(fmt.Sprintf("%-15s", m.key)),
				ui.Bold(fmt.Sprintf("%-20s", showValue(m, cfg))), ui.Dim(m.desc))}
		}
		idx, err := ui.Pick(items, ui.PickOpts{
			Prompt: "setting ❯ ",
			Header: "config · " + util.ConfigFile + "\nEnter to change · Esc when done",
		})
		if err != nil || idx < 0 {
			return err
		}
		m := table[idx]
		var raw string
		if m.kind == kEnum || m.kind == kBool {
			options := m.options
			if m.kind == kBool {
				options = []string{"true", "false"}
			}
			cur := m.get(cfg)
			oi := make([]ui.PickItem, len(options))
			for i, o := range options {
				markPfx := "  "
				if o == cur {
					markPfx = ui.Green("● ")
				}
				oi[i] = ui.PickItem{Label: markPfx + ui.Bold(o)}
			}
			odx, err := ui.Pick(oi, ui.PickOpts{Prompt: m.key + " ❯ ", Header: m.desc})
			if err != nil || odx < 0 {
				continue
			}
			raw = options[odx]
		} else {
			rangeHint := ""
			if m.kind == kNumber {
				rangeHint = ui.Dim(fmt.Sprintf("  (%v–%v)", m.minV, m.maxV))
			}
			fmt.Printf("\n  %s %s%s\n", ui.Cyan(m.key), ui.Dim("· "+m.desc), rangeHint)
			fmt.Println(ui.Dim("  current: " + showValue(m, cfg)))
			raw = prompt(ui.Violet("  new value ❯ "))
			if strings.TrimSpace(raw) == "" {
				continue
			}
		}
		if msg := validate(m, raw); msg != "" {
			fmt.Println(ui.Red("  ✗ " + msg))
			prompt(ui.Dim("  press Enter …"))
			continue
		}
		m.set(cfg, strings.TrimSpace(raw))
		if err := util.SaveConfig(*cfg); err != nil {
			return err
		}
	}
}
