//go:build windows

package img

// CellAspect on Windows: no pixel-size ioctl — use the classic 2.0.
func CellAspect() float64 { return 2.0 }
