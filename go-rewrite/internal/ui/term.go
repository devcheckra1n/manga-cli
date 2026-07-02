// Terminal state: raw mode, the alternate screen, size, and key decoding.
// Cleanup only undoes what was actually done (the Ghostty lesson: sending
// "leave alt screen" when it was never entered wipes command output).

package ui

import (
	"os"
	"regexp"
	"unicode/utf8"

	"golang.org/x/term"
)

var (
	altActive = false
	rawState  *term.State
)

// Size returns the terminal dimensions (cols, rows), with a sane fallback.
func Size() (int, int) {
	w, h, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || w <= 0 || h <= 0 {
		return 80, 24
	}
	return w, h
}

// IsTTY reports whether we're attached to an interactive terminal.
func IsTTY() bool {
	return term.IsTerminal(int(os.Stdout.Fd())) && term.IsTerminal(int(os.Stdin.Fd()))
}

// EnterAlt switches to the alternate screen and hides the cursor.
func EnterAlt() {
	os.Stdout.WriteString("\x1b[?1049h\x1b[?25l")
	altActive = true
}

// LeaveAlt restores the main screen. No-op if the alt screen was never entered.
func LeaveAlt() {
	if altActive {
		os.Stdout.WriteString("\x1b[?25h\x1b[?1049l")
	}
	altActive = false
}

// RawOn puts stdin into raw mode.
func RawOn() error {
	st, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return err
	}
	rawState = st
	return nil
}

// RawOff restores cooked mode.
func RawOff() {
	if rawState != nil {
		_ = term.Restore(int(os.Stdin.Fd()), rawState)
		rawState = nil
	}
}

// Restore is the safety-net cleanup on exit/interrupt.
func Restore() {
	if altActive {
		os.Stdout.WriteString("\x1b[?1049l")
		altActive = false
	}
	os.Stdout.WriteString("\x1b[?25h")
	RawOff()
}

// ── key decoding ───────────────────────────────────────────────────────────────

// Key is a decoded keypress: named specials, or the literal rune(s) typed.
type Key string

const (
	KeyUp        Key = "up"
	KeyDown      Key = "down"
	KeyLeft      Key = "left"
	KeyRight     Key = "right"
	KeyPgUp      Key = "pgup"
	KeyPgDn      Key = "pgdn"
	KeyEnter     Key = "enter"
	KeyEsc       Key = "esc"
	KeyTab       Key = "tab"
	KeyShiftTab  Key = "shift-tab"
	KeyBackspace Key = "backspace"
	KeyCtrlC     Key = "ctrl-c"
	KeySpace     Key = "space"
)

// KeyReader decodes raw stdin bytes into Keys (arrows arrive batched when held).
type KeyReader struct {
	buf     [64]byte
	pending []byte
}

func (k *KeyReader) fill() error {
	n, err := os.Stdin.Read(k.buf[:])
	if err != nil {
		return err
	}
	k.pending = append(k.pending, k.buf[:n]...)
	return nil
}

// Next blocks for the next keypress.
func (k *KeyReader) Next() (Key, error) {
	for len(k.pending) == 0 {
		if err := k.fill(); err != nil {
			return "", err
		}
	}
	b := k.pending
	// Escape sequences.
	if b[0] == 0x1b {
		if len(b) >= 3 && b[1] == '[' {
			switch b[2] {
			case 'A':
				k.pending = b[3:]
				return KeyUp, nil
			case 'B':
				k.pending = b[3:]
				return KeyDown, nil
			case 'C':
				k.pending = b[3:]
				return KeyRight, nil
			case 'D':
				k.pending = b[3:]
				return KeyLeft, nil
			case 'Z':
				k.pending = b[3:]
				return KeyShiftTab, nil
			case '5', '6':
				if len(b) >= 4 && b[3] == '~' {
					k.pending = b[4:]
					if b[2] == '5' {
						return KeyPgUp, nil
					}
					return KeyPgDn, nil
				}
			}
			// Unknown CSI — swallow it conservatively.
			i := 2
			for i < len(b) && (b[i] < 0x40 || b[i] > 0x7e) {
				i++
			}
			if i < len(b) {
				k.pending = b[i+1:]
				return k.Next()
			}
		}
		// Bare ESC (no sequence follows in this chunk).
		k.pending = b[1:]
		return KeyEsc, nil
	}
	switch b[0] {
	case '\r', '\n':
		k.pending = b[1:]
		return KeyEnter, nil
	case '\t':
		k.pending = b[1:]
		return KeyTab, nil
	case 0x7f, 0x08:
		k.pending = b[1:]
		return KeyBackspace, nil
	case 0x03:
		k.pending = b[1:]
		return KeyCtrlC, nil
	case ' ':
		k.pending = b[1:]
		return KeySpace, nil
	}
	// A literal (possibly multibyte) rune.
	r, size := utf8.DecodeRune(b)
	if r == utf8.RuneError && size <= 1 {
		// Incomplete UTF-8 — pull more bytes.
		if err := k.fill(); err != nil {
			k.pending = b[1:]
			return Key(string(b[:1])), nil
		}
		return k.Next()
	}
	k.pending = b[size:]
	return Key(string(r)), nil
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// StripANSI removes SGR sequences (for width math and fuzzy matching).
func StripANSI(s string) string { return ansiRe.ReplaceAllString(s, "") }
