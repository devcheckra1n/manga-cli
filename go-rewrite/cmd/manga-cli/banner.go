// The ASCII banner with a diagonal violet → pink → cyan gradient.

package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/ui"
)

var bannerArt = []string{
	" ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗  █████╗ ",
	" ████╗ ████║██╔══██╗████╗  ██║██╔════╝ ██╔══██╗",
	" ██╔████╔██║███████║██╔██╗ ██║██║  ███╗███████║",
	" ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║",
	" ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║",
	" ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝",
	"          ██████╗██╗     ██╗                   ",
	"         ██╔════╝██║     ██║                    ",
	"         ██║     ██║     ██║                    ",
	"         ██║     ██║     ██║                    ",
	"         ╚██████╗███████╗██║                    ",
	"          ╚═════╝╚══════╝╚═╝                    ",
}

var bannerStops = [3][3]int{{149, 76, 233}, {244, 114, 182}, {34, 211, 238}}

func bannerGradient(t float64) (int, int, int) {
	seg := 0
	if t >= 0.5 {
		seg = 1
	}
	local := (t - float64(seg)*0.5) * 2
	a, b := bannerStops[seg], bannerStops[seg+1]
	lerp := func(x, y int) int { return x + int(float64(y-x)*local) }
	return lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2])
}

func banner(version string) string {
	h := len(bannerArt)
	w := 0
	for _, l := range bannerArt {
		w = max(w, len([]rune(l)))
	}
	span := float64(w) + 2.2*float64(h-1)
	var out strings.Builder
	out.WriteString("\n")
	for y, line := range bannerArt {
		if !ui.ColorEnabled {
			out.WriteString(line + "\n")
			continue
		}
		last := ""
		for x, chr := range []rune(line) {
			if chr == ' ' {
				out.WriteRune(' ')
				continue
			}
			t := min(1.0, (float64(x)+2.2*float64(y))/span)
			r, g, b := bannerGradient(t)
			code := fmt.Sprintf("\x1b[38;2;%d;%d;%dm", r, g, b)
			if code != last {
				out.WriteString(code)
				last = code
			}
			out.WriteRune(chr)
		}
		out.WriteString("\x1b[0m\n")
	}
	text := "terminal manga reader 🎲"
	if version != "" {
		text += " · v" + version
	}
	pad := strings.Repeat(" ", max(0, (w-len([]rune(text)))/2))
	out.WriteString(pad + ui.Dim(text) + "\n")
	return out.String()
}

func shouldShowBanner(configShow bool) bool {
	if os.Getenv("MANGA_CLI_NO_BANNER") == "1" {
		return false
	}
	return configShow && ui.IsTTY()
}
