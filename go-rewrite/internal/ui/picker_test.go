package ui

import "testing"

func TestFuzzyScore(t *testing.T) {
	// Must match in order.
	if _, ok := fuzzyScore("brk", "Berserk"); !ok {
		t.Fatal("brk should match Berserk")
	}
	if _, ok := fuzzyScore("xyz", "Berserk"); ok {
		t.Fatal("xyz should not match Berserk")
	}
	// Exact prefix beats scattered match.
	exact, ok1 := fuzzyScore("berserk", "Berserk")
	scattered, ok2 := fuzzyScore("berserk", "ba ea ra sa ea ra ka")
	if !ok1 || !ok2 {
		t.Fatal("both should match")
	}
	if exact >= scattered {
		t.Fatalf("exact (%d) should score lower than scattered (%d)", exact, scattered)
	}
	// Multi-start: "lag" should find the tight run in "Lagoon", not pay for
	// the scattered l…a…g through "bLack lAGoon".
	tight, ok3 := fuzzyScore("lag", "Black Lagoon")
	loose, ok4 := fuzzyScore("lag", "listen: a good day")
	if !ok3 || !ok4 {
		t.Fatal("both should match")
	}
	if tight >= loose {
		t.Fatalf("tight run (%d) should beat scattered (%d)", tight, loose)
	}
	// Prefix match ranks above a late match.
	early, _ := fuzzyScore("ber", "Berserk")
	late, _ := fuzzyScore("ber", "Number of the Beast: berserk arc")
	if early >= late {
		t.Fatalf("prefix (%d) should beat late (%d)", early, late)
	}
	// Empty query matches everything with zero score.
	if s, ok := fuzzyScore("", "anything"); !ok || s != 0 {
		t.Fatal("empty query should match all")
	}
}

func TestTruncANSI(t *testing.T) {
	styled := Violet("Hello") + " " + Dim("World")
	if got := StripANSI(truncANSI(styled, 100)); got != "Hello World" {
		t.Fatalf("no-trunc mangled: %q", got)
	}
	short := truncANSI(styled, 7)
	if plain := StripANSI(short); len([]rune(plain)) > 7 {
		t.Fatalf("trunc too long: %q (%d)", plain, len([]rune(plain)))
	}
}
