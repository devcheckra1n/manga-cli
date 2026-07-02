// Package util: XDG-aware filesystem locations, config, and the tiny disk cache.
// File formats and paths are byte-compatible with the TypeScript implementation,
// so both binaries share config, history, follows, and caches.
package util

import (
	"os"
	"path/filepath"
	"strings"
)

const app = "manga-cli"

func baseDir(xdgVar, fallback string) string {
	if xdg := os.Getenv(xdgVar); strings.HasPrefix(xdg, "/") {
		return xdg
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, fallback)
}

var (
	CacheDir  = filepath.Join(baseDir("XDG_CACHE_HOME", ".cache"), app)
	ConfigDir = filepath.Join(baseDir("XDG_CONFIG_HOME", ".config"), app)

	ConfigFile  = filepath.Join(ConfigDir, "config.json")
	HistoryFile = filepath.Join(ConfigDir, "history.json")
	FollowsFile = filepath.Join(ConfigDir, "follows.json")

	CoversDir     = filepath.Join(CacheDir, "covers")
	PagesDir      = filepath.Join(CacheDir, "pages")
	SearchCache   = filepath.Join(CacheDir, "search")
	MangaCache    = filepath.Join(CacheDir, "manga")
	ChaptersCache = filepath.Join(CacheDir, "chapters")
)

// ExpandTilde expands a leading ~ to the user's home directory.
func ExpandTilde(p string) string {
	home, _ := os.UserHomeDir()
	if p == "~" {
		return home
	}
	if strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[2:])
	}
	return p
}
