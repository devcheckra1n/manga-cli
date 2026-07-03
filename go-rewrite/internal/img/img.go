// Package img: the built-in image pipeline that replaces chafa.
// Decode (webp/jpeg/png/gif) → scale → render as truecolor half-block cells
// (▀ fg=top px, bg=bottom px), with 256-color fallback — or hand the terminal
// the real pixels via the kitty / iTerm2 inline-image protocols.
package img

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"os"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Decode parses any supported image format.
func Decode(data []byte) (image.Image, error) {
	im, _, err := image.Decode(bytes.NewReader(data))
	return im, err
}

// Protocol is how images reach the terminal.
type Protocol string

const (
	Kitty  Protocol = "kitty"
	ITerm2 Protocol = "iterm2"
	Cells  Protocol = "cells" // universal half-block renderer
)

// DetectProtocol picks the best protocol, honoring the config override
// ("chafa" from the TS config maps to the cell renderer).
func DetectProtocol(override string) Protocol {
	switch override {
	case "kitty":
		return Kitty
	case "iterm2":
		return ITerm2
	case "chafa", "cells":
		return Cells
	}
	term := os.Getenv("TERM")
	prog := os.Getenv("TERM_PROGRAM")
	switch {
	case strings.Contains(term, "kitty"), strings.Contains(term, "ghostty"),
		prog == "ghostty", prog == "WezTerm", prog == "kitty":
		return Kitty
	case prog == "iTerm.app":
		return ITerm2
	}
	return Cells
}

func trueColor() bool {
	ct := os.Getenv("COLORTERM")
	return strings.Contains(ct, "truecolor") || strings.Contains(ct, "24bit") ||
		strings.Contains(os.Getenv("TERM"), "kitty") || strings.Contains(os.Getenv("TERM"), "ghostty")
}

// FitCells computes the cell rectangle (cols, rows) that shows a w×h-pixel
// image inside maxCols×maxRows cells without distortion. `aspect` is the
// terminal cell's height/width pixel ratio (from CellAspect) — using the real
// ratio is what keeps pages from stretching.
func FitCells(w, h, maxCols, maxRows int, aspect float64) (int, int) {
	if w <= 0 || h <= 0 || maxCols <= 0 || maxRows <= 0 {
		return 1, 1
	}
	if aspect <= 0 {
		aspect = 2.0
	}
	// On screen: width = cols·cw, height = rows·(cw·aspect). No distortion ⇔
	// cols/rows = (w/h)·aspect.
	ratio := float64(w) / float64(h) * aspect
	cols := float64(maxCols)
	rows := cols / ratio
	if rows > float64(maxRows) {
		rows = float64(maxRows)
		cols = rows * ratio
	}
	return max(1, min(int(cols), maxCols)), max(1, min(int(rows), maxRows))
}

func scaleTo(src image.Image, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	// CatmullRom: proper filtering at heavy downscale (manga page → cells).
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	return dst
}

// ── half-block cell renderer ───────────────────────────────────────────────────

// to256 quantizes to the xterm-256 palette (16..255).
func to256(r, g, b uint8) int {
	// grayscale ramp when the channels are close
	if maxc, minc := max(r, max(g, b)), min(r, min(g, b)); int(maxc)-int(minc) < 12 {
		gray := (int(r) + int(g) + int(b)) / 3
		if gray < 8 {
			return 16
		}
		if gray > 238 {
			return 231
		}
		return 232 + (gray-8)/10
	}
	q := func(v uint8) int { return (int(v)*5 + 127) / 255 }
	return 16 + 36*q(r) + 6*q(g) + q(b)
}

// RenderCells scales the image into cols×rows cells and returns one styled
// string per terminal row, using ▀ with fg=upper pixel and bg=lower pixel.
func RenderCells(src image.Image, cols, rows int) []string {
	px := scaleTo(src, cols, rows*2)
	tc := trueColor()
	lines := make([]string, rows)
	var b strings.Builder
	for y := 0; y < rows; y++ {
		b.Reset()
		lastFg, lastBg := "", ""
		for x := 0; x < cols; x++ {
			tr, tg, tb, _ := px.At(x, y*2).RGBA()
			br, bg_, bb, _ := px.At(x, y*2+1).RGBA()
			var fg, bg string
			if tc {
				fg = fmt.Sprintf("38;2;%d;%d;%d", tr>>8, tg>>8, tb>>8)
				bg = fmt.Sprintf("48;2;%d;%d;%d", br>>8, bg_>>8, bb>>8)
			} else {
				fg = fmt.Sprintf("38;5;%d", to256(uint8(tr>>8), uint8(tg>>8), uint8(tb>>8)))
				bg = fmt.Sprintf("48;5;%d", to256(uint8(br>>8), uint8(bg_>>8), uint8(bb>>8)))
			}
			if fg != lastFg || bg != lastBg {
				b.WriteString("\x1b[" + fg + ";" + bg + "m")
				lastFg, lastBg = fg, bg
			}
			b.WriteString("▀")
		}
		b.WriteString("\x1b[0m")
		lines[y] = b.String()
	}
	return lines
}

// ── kitty / iTerm2 protocols ───────────────────────────────────────────────────

// KittySeq encodes the image as a PNG placed into cols×rows cells at the
// current cursor position (a=T places immediately; q=2 keeps it quiet).
func KittySeq(src image.Image, cols, rows int) (string, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		return "", err
	}
	payload := base64.StdEncoding.EncodeToString(buf.Bytes())
	var b strings.Builder
	first := true
	for len(payload) > 0 {
		chunk := payload
		if len(chunk) > 4096 {
			chunk = payload[:4096]
		}
		payload = payload[len(chunk):]
		more := 0
		if len(payload) > 0 {
			more = 1
		}
		if first {
			b.WriteString(fmt.Sprintf("\x1b_Ga=T,f=100,q=2,c=%d,r=%d,m=%d;%s\x1b\\", cols, rows, more, chunk))
			first = false
		} else {
			b.WriteString(fmt.Sprintf("\x1b_Gm=%d;%s\x1b\\", more, chunk))
		}
	}
	return b.String(), nil
}

// KittyClear deletes all kitty images (anti-ghosting between pages).
const KittyClear = "\x1b_Ga=d,d=A\x1b\\"

// ITermSeq encodes the raw file bytes for iTerm2's inline-image protocol.
func ITermSeq(data []byte, cols, rows int) string {
	return fmt.Sprintf("\x1b]1337;File=inline=1;width=%d;height=%d;preserveAspectRatio=1:%s\x07",
		cols, rows, base64.StdEncoding.EncodeToString(data))
}
