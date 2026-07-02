// Package ui: ANSI colors, terminal state, the fuzzy picker, and (in later
// phases) the reader. Pure escape sequences — no external TUI dependency.
package ui

import "os"

// ColorEnabled respects the NO_COLOR convention.
var ColorEnabled = os.Getenv("NO_COLOR") == ""

func paint(code, s string) string {
	if !ColorEnabled {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

// The manga-cli palette (matches the TS ui/colors.ts).
func Violet(s string) string { return paint("38;2;167;139;250", s) }
func Cyan(s string) string   { return paint("38;2;34;211;238", s) }
func Pink(s string) string   { return paint("38;2;244;114;182", s) }
func Green(s string) string  { return paint("38;2;74;222;128", s) }
func Red(s string) string    { return paint("38;2;248;113;113", s) }
func Yellow(s string) string { return paint("38;2;250;204;21", s) }
func Gray(s string) string   { return paint("38;5;245", s) }
func Dim(s string) string    { return paint("2", s) }
func Bold(s string) string   { return paint("1", s) }

// Sel renders the picker's highlighted row (white on the theme's dark violet).
func Sel(s string) string { return paint("1;38;2;255;255;255;48;2;38;35;53", s) }
