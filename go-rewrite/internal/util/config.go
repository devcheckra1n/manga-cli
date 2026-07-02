// User configuration — reads/writes the same ~/.config/manga-cli/config.json
// as the TypeScript implementation (field names must stay in sync).

package util

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	Source          string   `json:"source"`
	Fallback        []string `json:"fallback"`
	ReaderMode      string   `json:"readerMode"` // auto | kitty | iterm2 | chafa(=cells)
	Direction       string   `json:"direction"`  // rtl | ltr
	DualPage        bool     `json:"dualPage"`
	Fit             string   `json:"fit"` // page | width
	Zoom            float64  `json:"zoom"`
	HudReserve      int      `json:"hudReserve"`
	DownloadFormat  string   `json:"downloadFormat"` // cbz | zip | pdf | images
	ChafaSize       string   `json:"chafaSize"`
	PrefetchPages   int      `json:"prefetchPages"`
	ShowBanner      bool     `json:"showBanner"`
	Adult           bool     `json:"adult"`
	FzfArgs         string   `json:"fzfArgs"`
	DownloadDir     string   `json:"downloadDir"`
	MalClientID     string   `json:"malClientId"`
	MalClientSecret string   `json:"malClientSecret"`
}

func DefaultConfig() Config {
	home, _ := os.UserHomeDir()
	return Config{
		Source:         "atsumaru",
		Fallback:       []string{"weebcentral", "mangakatana", "mangadex"},
		ReaderMode:     "auto",
		Direction:      "rtl",
		DualPage:       false,
		Fit:            "page",
		Zoom:           1.0,
		HudReserve:     2,
		DownloadFormat: "cbz",
		ChafaSize:      "auto",
		PrefetchPages:  2,
		ShowBanner:     true,
		Adult:          false,
		DownloadDir:    filepath.Join(home, "Downloads", "manga-cli"),
	}
}

func clampZoom(z float64) float64 {
	if z < 0.4 || z > 1.0 {
		if z > 1.0 {
			return 1.0
		}
		if z >= 0 {
			return 0.4
		}
		return 1.0
	}
	return z
}

// LoadConfig merges config.json over the defaults. A malformed file warns
// loudly instead of silently dropping every setting.
func LoadConfig() Config {
	cfg := DefaultConfig()
	raw, err := os.ReadFile(ConfigFile)
	if err == nil {
		if jsonErr := json.Unmarshal(raw, &cfg); jsonErr != nil {
			fmt.Fprintf(os.Stderr,
				"⚠  %s is not valid JSON — using defaults and ignoring ALL your settings.\n   (%v) — it must be a single { … } object with no comments.\n",
				ConfigFile, jsonErr)
			cfg = DefaultConfig()
		}
	}
	cfg.DownloadDir = ExpandTilde(cfg.DownloadDir)
	cfg.Zoom = clampZoom(cfg.Zoom)
	if cfg.HudReserve < 1 {
		cfg.HudReserve = 1
	}
	if cfg.HudReserve > 6 {
		cfg.HudReserve = 6
	}
	return cfg
}

// SaveConfig writes the config back with the same 2-space indenting as TS.
func SaveConfig(cfg Config) error {
	if err := os.MkdirAll(ConfigDir, 0o755); err != nil {
		return err
	}
	blob, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigFile, blob, 0o644)
}
