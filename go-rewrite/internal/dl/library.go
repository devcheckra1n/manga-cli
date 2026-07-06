// Offline library: browse and read downloads (CBZ / ZIP / folders) with no
// network. Archives extract in-process (archive/zip — no unzip binary) into a
// cached dir, and chapters flow back through the reader as file:// pages.

package dl

import (
	"archive/zip"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

var imageRe = regexp.MustCompile(`(?i)\.(webp|jpe?g|png|gif|avif|bmp)$`)

type LibraryChapter struct {
	Label   string
	Path    string
	Archive bool
}

type LibrarySeries struct {
	Title    string
	Dir      string
	Chapters []LibraryChapter
}

// ScanLibrary discovers downloaded series under downloadDir.
func ScanLibrary(downloadDir string) []LibrarySeries {
	entries, err := os.ReadDir(downloadDir)
	if err != nil {
		return nil
	}
	var series []LibrarySeries
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(downloadDir, e.Name())
		items, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		var chapters []LibraryChapter
		for _, it := range items {
			name := it.Name()
			switch {
			case !it.IsDir() && (strings.HasSuffix(strings.ToLower(name), ".cbz") || strings.HasSuffix(strings.ToLower(name), ".zip")):
				chapters = append(chapters, LibraryChapter{
					Label:   name[:len(name)-4],
					Path:    filepath.Join(dir, name),
					Archive: true,
				})
			case it.IsDir():
				chapters = append(chapters, LibraryChapter{Label: name, Path: filepath.Join(dir, name)})
			}
		}
		if len(chapters) == 0 {
			continue
		}
		sort.SliceStable(chapters, func(a, b int) bool { return naturalLess(chapters[a].Label, chapters[b].Label) })
		series = append(series, LibrarySeries{Title: e.Name(), Dir: dir, Chapters: chapters})
	}
	sort.SliceStable(series, func(a, b int) bool { return naturalLess(series[a].Title, series[b].Title) })
	return series
}

func collectImages(dir string) []string {
	var out []string
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && imageRe.MatchString(d.Name()) {
			out = append(out, path)
		}
		return nil
	})
	sortNatural(out)
	return out
}

// archivePages extracts a CBZ/ZIP once into the cache and returns its images.
func archivePages(archivePath string) ([]string, error) {
	sum := md5.Sum([]byte(archivePath))
	dest := filepath.Join(util.CacheDir, "extract", hex.EncodeToString(sum[:]))
	marker := filepath.Join(dest, ".done")
	if _, err := os.Stat(marker); err != nil {
		if err := os.MkdirAll(dest, 0o755); err != nil {
			return nil, err
		}
		zr, err := zip.OpenReader(archivePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open archive: %w", err)
		}
		defer zr.Close()
		for _, f := range zr.File {
			if f.FileInfo().IsDir() || !imageRe.MatchString(f.Name) {
				continue
			}
			// Flatten and sanitize the entry name (zip-slip safe).
			name := filepath.Base(filepath.Clean(f.Name))
			rc, err := f.Open()
			if err != nil {
				continue
			}
			data, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}
			_ = os.WriteFile(filepath.Join(dest, name), data, 0o644)
		}
		_ = os.WriteFile(marker, []byte("1"), 0o644)
	}
	return collectImages(dest), nil
}

// ToReaderSource builds a reader-ready MangaInfo + local page loader.
func ToReaderSource(series LibrarySeries) (*api.MangaInfo, func(int) (*api.ReadChapter, error)) {
	info := &api.MangaInfo{
		ID:    "local:" + series.Title,
		Title: series.Title,
		Type:  "Manga",
	}
	for i, ch := range series.Chapters {
		info.Chapters = append(info.Chapters, api.Chapter{
			ID: ch.Path, Title: ch.Label, Number: float64(i + 1), Index: i,
		})
	}
	load := func(index int) (*api.ReadChapter, error) {
		if index < 0 || index >= len(series.Chapters) {
			return nil, fmt.Errorf("invalid chapter")
		}
		ch := series.Chapters[index]
		var files []string
		var err error
		if ch.Archive {
			files, err = archivePages(ch.Path)
			if err != nil {
				return nil, err
			}
		} else {
			files = collectImages(ch.Path)
		}
		if len(files) == 0 {
			return nil, fmt.Errorf("no images in this chapter")
		}
		rc := &api.ReadChapter{ID: ch.Path, Title: ch.Label}
		for i, f := range files {
			rc.Pages = append(rc.Pages, api.Page{
				ID: fmt.Sprintf("local-%d", i), URL: "file://" + f, Number: i + 1, AspectRatio: 1,
			})
		}
		return rc, nil
	}
	return info, load
}
