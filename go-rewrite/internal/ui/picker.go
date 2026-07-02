// The built-in fuzzy picker — replaces fzf. Prompt on top (like our old
// --layout reverse), themed to match the banner, single- and multi-select.

package ui

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// PickItem is one selectable row. Label may contain ANSI colors; matching
// runs against the stripped text.
type PickItem struct {
	Label string
}

// PickOpts configure a picker session.
type PickOpts struct {
	Prompt string // e.g. "manga ❯ "
	Header string // one or two lines (\n-separated), rendered dim
}

// Pick shows the picker and returns the chosen index, or -1 if cancelled.
func Pick(items []PickItem, opts PickOpts) (int, error) {
	sel, err := runPicker(items, opts, false)
	if err != nil || len(sel) == 0 {
		return -1, err
	}
	return sel[0], nil
}

// PickMulti is the multi-select variant (Tab toggles). Returns indices in list order.
func PickMulti(items []PickItem, opts PickOpts) ([]int, error) {
	return runPicker(items, opts, true)
}

// ── fuzzy matching ─────────────────────────────────────────────────────────────

// fuzzyScore returns (score, ok): all query runes must appear in order in text;
// lower scores are better. It tries a greedy match from every occurrence of the
// first query rune and keeps the best, so "lag" prefers "Black *Lag*oon"'s tight
// run over a scattered l…a…g.
func fuzzyScore(query, text string) (int, bool) {
	if query == "" {
		return 0, true
	}
	q := []rune(strings.ToLower(query))
	t := []rune(strings.ToLower(text))

	best, found := 0, false
	for start := 0; start < len(t); start++ {
		if t[start] != q[0] {
			continue
		}
		// Greedy match from this start.
		gaps, qi, lastMatch := 0, 1, start
		for ti := start + 1; ti < len(t) && qi < len(q); ti++ {
			if t[ti] != q[qi] {
				continue
			}
			if ti != lastMatch+1 {
				gaps += 2 + (ti - lastMatch) // gap penalty
			}
			lastMatch = ti
			qi++
		}
		if qi < len(q) {
			break // later starts can only match less
		}
		startCost := start
		if start == 0 {
			startCost = 0
		} else if t[start-1] == ' ' || unicode.IsPunct(t[start-1]) {
			startCost = start / 2 // word-boundary starts are half price
		}
		score := gaps + startCost
		if !found || score < best {
			best, found = score, true
		}
	}
	return best, found
}

// ── the picker loop ────────────────────────────────────────────────────────────

type row struct {
	idx   int
	score int
}

func runPicker(items []PickItem, opts PickOpts, multi bool) ([]int, error) {
	if len(items) == 0 {
		return nil, nil
	}
	if !IsTTY() {
		return nil, fmt.Errorf("picker needs an interactive terminal")
	}
	plain := make([]string, len(items))
	for i, it := range items {
		plain[i] = StripANSI(it.Label)
	}

	if err := RawOn(); err != nil {
		return nil, err
	}
	EnterAlt()
	defer func() {
		LeaveAlt()
		RawOff()
	}()

	query := ""
	cursor, top := 0, 0
	selected := map[int]bool{}
	keys := &KeyReader{}

	filter := func() []row {
		rows := make([]row, 0, len(items))
		for i := range items {
			if s, ok := fuzzyScore(query, plain[i]); ok {
				rows = append(rows, row{i, s})
			}
		}
		if query != "" {
			sort.SliceStable(rows, func(a, b int) bool { return rows[a].score < rows[b].score })
		}
		return rows
	}
	rows := filter()

	for {
		render(items, rows, opts, query, cursor, top, selected, multi)

		key, err := keys.Next()
		if err != nil {
			return nil, err
		}
		switch key {
		case KeyCtrlC, KeyEsc:
			return nil, nil
		case KeyEnter:
			if len(rows) == 0 {
				continue
			}
			if multi {
				if len(selected) == 0 {
					return []int{rows[cursor].idx}, nil
				}
				var out []int
				for i := range items {
					if selected[i] {
						out = append(out, i)
					}
				}
				return out, nil
			}
			return []int{rows[cursor].idx}, nil
		case KeyUp, KeyShiftTab:
			if key == KeyShiftTab && multi && len(rows) > 0 {
				selected[rows[cursor].idx] = !selected[rows[cursor].idx]
			}
			if cursor > 0 {
				cursor--
			} else {
				cursor = len(rows) - 1 // cycle
			}
		case KeyDown:
			if cursor < len(rows)-1 {
				cursor++
			} else {
				cursor = 0 // cycle
			}
		case KeyTab:
			if multi && len(rows) > 0 {
				selected[rows[cursor].idx] = !selected[rows[cursor].idx]
				if cursor < len(rows)-1 {
					cursor++
				}
			}
		case KeyPgUp, KeyPgDn:
			_, h := Size()
			step := listHeight(h, opts) - 1
			if key == KeyPgUp {
				cursor -= step
			} else {
				cursor += step
			}
			cursor = min(max(cursor, 0), max(len(rows)-1, 0))
		case KeyBackspace:
			if query != "" {
				_, size := utf8.DecodeLastRuneInString(query)
				query = query[:len(query)-size]
				rows = filter()
				cursor, top = 0, 0
			}
		case KeySpace:
			query += " "
			rows = filter()
			cursor, top = 0, 0
		case KeyLeft, KeyRight:
			// no-op in the picker
		default:
			if len(key) > 0 && !strings.HasPrefix(string(key), "\x1b") {
				query += string(key)
				rows = filter()
				cursor, top = 0, 0
			}
		}
		// Keep the cursor inside the scroll window.
		_, h := Size()
		lh := listHeight(h, opts)
		if cursor < top {
			top = cursor
		}
		if cursor >= top+lh {
			top = cursor - lh + 1
		}
	}
}

func headerLines(opts PickOpts) []string {
	if opts.Header == "" {
		return nil
	}
	return strings.Split(opts.Header, "\n")
}

func listHeight(termH int, opts PickOpts) int {
	// header lines + prompt row + bottom hint row
	return max(termH-len(headerLines(opts))-2, 3)
}

// visWidth is the display width of s ignoring ANSI (CJK-naive but fine here).
func visWidth(s string) int { return utf8.RuneCountInString(StripANSI(s)) }

// truncANSI truncates a styled string to width visible cells, preserving codes.
func truncANSI(s string, width int) string {
	if visWidth(s) <= width {
		return s
	}
	var b strings.Builder
	vis := 0
	i := 0
	for i < len(s) {
		if s[i] == 0x1b {
			if loc := ansiRe.FindStringIndex(s[i:]); loc != nil && loc[0] == 0 {
				b.WriteString(s[i : i+loc[1]])
				i += loc[1]
				continue
			}
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if vis >= width-1 {
			b.WriteString("…")
			break
		}
		b.WriteRune(r)
		vis++
		i += size
	}
	return b.String() + "\x1b[0m"
}

func render(items []PickItem, rows []row, opts PickOpts, query string, cursor, top int, selected map[int]bool, multi bool) {
	w, h := Size()
	var b strings.Builder
	b.WriteString("\x1b[H\x1b[2J")

	line := 1
	for _, hl := range headerLines(opts) {
		b.WriteString(fmt.Sprintf("\x1b[%d;1H", line))
		b.WriteString(Dim(truncANSI(hl, w-2)))
		line++
	}

	// Prompt row with the live query and match count.
	count := fmt.Sprintf("%d/%d", len(rows), len(items))
	b.WriteString(fmt.Sprintf("\x1b[%d;1H", line))
	prompt := Violet(opts.Prompt) + query + Dim("▏")
	b.WriteString(truncANSI(prompt, w-len(count)-3))
	b.WriteString(fmt.Sprintf("\x1b[%d;%dH%s", line, w-len(count), Dim(count)))
	line++

	lh := listHeight(h, opts)
	for i := 0; i < lh; i++ {
		ri := top + i
		b.WriteString(fmt.Sprintf("\x1b[%d;1H", line+i))
		if ri >= len(rows) {
			continue
		}
		it := items[rows[ri].idx]
		mark := "  "
		if multi && selected[rows[ri].idx] {
			mark = Pink("✓ ")
		}
		if ri == cursor {
			b.WriteString(Cyan("▌") + mark + truncANSI(it.Label, w-4))
		} else {
			b.WriteString(" " + mark + truncANSI(it.Label, w-4))
		}
	}

	hint := "↑↓ move · enter select · esc cancel"
	if multi {
		hint = "↑↓ move · tab toggle · enter confirm · esc cancel"
	}
	b.WriteString(fmt.Sprintf("\x1b[%d;1H%s", h, Dim(hint)))
	_, _ = os.Stdout.WriteString(b.String()) // one write per frame — no flicker
}
