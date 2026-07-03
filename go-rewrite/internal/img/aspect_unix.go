//go:build !windows

package img

import (
	"os"

	"golang.org/x/sys/unix"
)

// CellAspect returns the terminal cell's height/width pixel ratio, straight
// from the terminal via TIOCGWINSZ. Terminals that don't report pixel sizes
// fall back to the classic 2.0 (cells twice as tall as wide).
func CellAspect() float64 {
	ws, err := unix.IoctlGetWinsize(int(os.Stdout.Fd()), unix.TIOCGWINSZ)
	if err == nil && ws.Xpixel > 0 && ws.Ypixel > 0 && ws.Col > 0 && ws.Row > 0 {
		cw := float64(ws.Xpixel) / float64(ws.Col)
		chh := float64(ws.Ypixel) / float64(ws.Row)
		if cw > 0 && chh > 0 {
			if a := chh / cw; a > 1.2 && a < 3.5 {
				return a
			}
		}
	}
	return 2.0
}
