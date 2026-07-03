package img

import "testing"

func TestFitCellsNoDistortion(t *testing.T) {
	// A 1000x1000 square at cell aspect 2.0 must come out twice as many
	// columns as rows (cols·cw == rows·cw·2 on screen).
	cols, rows := FitCells(1000, 1000, 80, 24, 2.0)
	if cols != rows*2 && cols != rows*2-1 {
		t.Fatalf("square image should be ~2:1 in cells, got %dx%d", cols, rows)
	}
	// A taller cell (2.4) needs MORE columns per row to stay square on screen.
	cols24, rows24 := FitCells(1000, 1000, 80, 24, 2.4)
	if float64(cols24)/float64(rows24) <= float64(cols)/float64(rows) {
		t.Fatalf("higher aspect should widen: 2.0→%dx%d, 2.4→%dx%d", cols, rows, cols24, rows24)
	}
	// Manga page (2:3 portrait), never exceeds the box.
	c, r := FitCells(1066, 1600, 80, 22, 2.0)
	if c > 80 || r > 22 || c < 1 || r < 1 {
		t.Fatalf("out of bounds: %dx%d", c, r)
	}
	// Height-limited: r should hit the row cap.
	if r != 22 {
		t.Fatalf("portrait page should be height-limited, rows=%d", r)
	}
}
