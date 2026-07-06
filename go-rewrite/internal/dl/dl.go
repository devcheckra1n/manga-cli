// Package dl: chapter downloading + packaging (CBZ / ZIP / images / PDF) and
// the offline library. Unlike the TS version, everything is in-process:
// archive/zip instead of the `zip` binary, and stdlib JPEG encoding instead
// of sips/ImageMagick for PDFs.
package dl

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/img"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

type Options struct {
	Format      string // cbz | zip | pdf | images
	DownloadDir string
	Concurrency int
	OnProgress  func(done, total int)
	LoadPages   func(chapterID string) (*api.ReadChapter, error)
}

type Result struct {
	Output  string
	Skipped bool
	Pages   int
	Failed  int
}

// ── filename helpers ───────────────────────────────────────────────────────────

var unsafeRe = regexp.MustCompile(`[/\\:*?"<>| -]+`)

func Sanitize(s string) string {
	out := strings.TrimSpace(unsafeRe.ReplaceAllString(s, " "))
	out = strings.Join(strings.Fields(out), " ")
	if len(out) > 120 {
		out = out[:120]
	}
	if out == "" {
		return "untitled"
	}
	return out
}

// ChapterStem is a stable, sortable, unique per-chapter filename stem — keyed
// by list position because chapter numbers repeat on some titles (Berserk's
// prologue arc), which would otherwise collide on disk.
func ChapterStem(manga api.MangaRef, ch api.Chapter) string {
	seq := fmt.Sprintf("%04d", ch.Index+1)
	tail := ""
	if ch.Title != "" && ch.Title != fmt.Sprintf("Chapter %s", trimNum(ch.Number)) {
		tail = " (" + Sanitize(ch.Title) + ")"
	}
	return fmt.Sprintf("%s - %s Ch.%s%s", Sanitize(manga.Title), seq, trimNum(ch.Number), tail)
}

func extFor(format string) string {
	switch format {
	case "images":
		return ""
	case "zip":
		return ".zip"
	case "pdf":
		return ".pdf"
	}
	return ".cbz"
}

func OutputPath(manga api.MangaRef, ch api.Chapter, format, downloadDir string) string {
	return filepath.Join(downloadDir, Sanitize(manga.Title), ChapterStem(manga, ch)+extFor(format))
}

// ExistingStems returns stems already on disk (to mark downloaded chapters ✓).
func ExistingStems(manga api.MangaRef, downloadDir string) map[string]bool {
	out := map[string]bool{}
	entries, err := os.ReadDir(filepath.Join(downloadDir, Sanitize(manga.Title)))
	if err != nil {
		return out
	}
	stripRe := regexp.MustCompile(`(?i)\.(cbz|zip|pdf)$`)
	for _, e := range entries {
		out[stripRe.ReplaceAllString(e.Name(), "")] = true
	}
	return out
}

// ── chapter selection spec ("1-10", "1,3,5", "all", "latest") ─────────────────

func SelectChapters(spec string, chapters []api.Chapter) []api.Chapter {
	s := strings.ToLower(strings.TrimSpace(spec))
	switch s {
	case "", "all", "*":
		return chapters
	case "latest", "last":
		if len(chapters) == 0 {
			return nil
		}
		return chapters[len(chapters)-1:]
	case "first":
		if len(chapters) == 0 {
			return nil
		}
		return chapters[:1]
	}
	exact := map[float64]bool{}
	type rng struct{ a, b float64 }
	var ranges []rng
	rangeRe := regexp.MustCompile(`^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$`)
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if m := rangeRe.FindStringSubmatch(part); m != nil {
			a, _ := strconv.ParseFloat(m[1], 64)
			b, _ := strconv.ParseFloat(m[2], 64)
			ranges = append(ranges, rng{min(a, b), max(a, b)})
		} else if n, err := strconv.ParseFloat(part, 64); err == nil {
			exact[n] = true
		}
	}
	seen := map[float64]bool{}
	var out []api.Chapter
	for _, ch := range chapters {
		hit := exact[ch.Number]
		for _, r := range ranges {
			if ch.Number >= r.a && ch.Number <= r.b {
				hit = true
			}
		}
		// One release per number so "1-3" yields 3 chapters, not 6.
		if hit && !seen[ch.Number] {
			seen[ch.Number] = true
			out = append(out, ch)
		}
	}
	return out
}

// ── the download itself ────────────────────────────────────────────────────────

func DownloadChapter(manga api.MangaRef, ch api.Chapter, opts Options) (*Result, error) {
	output := OutputPath(manga, ch, opts.Format, opts.DownloadDir)
	if _, err := os.Stat(output); err == nil {
		return &Result{Output: output, Skipped: true}, nil
	}

	var rc *api.ReadChapter
	var err error
	if opts.LoadPages != nil {
		rc, err = opts.LoadPages(ch.ID)
	} else {
		rc, err = api.Get(manga.Source).Pages(manga.ID, ch.ID)
	}
	if err != nil {
		return nil, err
	}
	if len(rc.Pages) == 0 {
		return nil, fmt.Errorf("chapter has no pages")
	}

	// Fetch every page into the shared image cache (reused by the reader).
	local := make([]string, len(rc.Pages))
	conc := opts.Concurrency
	if conc <= 0 {
		conc = 4 // atsu's CDN dislikes bigger bursts
	}
	var done int
	var mu sync.Mutex
	sem := make(chan struct{}, conc)
	var wg sync.WaitGroup
	for i, p := range rc.Pages {
		wg.Add(1)
		go func(i int, url string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			// Cold CDNs flake under concurrency — de-synchronize the burst and
			// retry before declaring a page lost (a rescue pass runs after).
			time.Sleep(time.Duration(30+i%7*40) * time.Millisecond)
			for attempt := 0; attempt < 3; attempt++ {
				if attempt > 0 {
					time.Sleep(time.Duration(attempt) * 2 * time.Second)
				}
				if path, err := api.CacheImage(util.PagesDir, url); err == nil {
					local[i] = path
					break
				}
			}
			mu.Lock()
			done++
			if opts.OnProgress != nil {
				opts.OnProgress(done, len(rc.Pages))
			}
			mu.Unlock()
		}(i, p.URL)
	}
	wg.Wait()

	// Rescue pass: bad CDN windows outlive quick retries, so sweep any missing
	// pages sequentially and patiently before giving up on them.
	for round := 0; round < 2; round++ {
		missing := 0
		for i := range local {
			if local[i] == "" {
				missing++
			}
		}
		if missing == 0 {
			break
		}
		time.Sleep(time.Duration(round+1) * 5 * time.Second)
		for i, p := range rc.Pages {
			if local[i] != "" {
				continue
			}
			if path, err := api.CacheImage(util.PagesDir, p.URL); err == nil {
				local[i] = path
			}
		}
	}

	var ordered []string
	for _, p := range local {
		if p != "" {
			ordered = append(ordered, p)
		}
	}
	if len(ordered) == 0 {
		return nil, fmt.Errorf("all pages failed to download")
	}
	failed := len(rc.Pages) - len(ordered)

	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return nil, err
	}
	res := &Result{Output: output, Pages: len(ordered), Failed: failed}
	pad := len(strconv.Itoa(len(rc.Pages)))

	switch opts.Format {
	case "images":
		if err := os.MkdirAll(output, 0o755); err != nil {
			return nil, err
		}
		for n, src := range ordered {
			data, err := os.ReadFile(src)
			if err != nil {
				continue
			}
			name := fmt.Sprintf("%0*d%s", pad, n+1, filepath.Ext(src))
			if err := os.WriteFile(filepath.Join(output, name), data, 0o644); err != nil {
				return nil, err
			}
		}
	case "pdf":
		if err := writePDF(output, ordered); err != nil {
			return nil, err
		}
	default: // cbz / zip
		if err := writeZip(output, ordered, pad); err != nil {
			return nil, err
		}
	}
	return res, nil
}

// writeZip packs pages into a CBZ/ZIP with sequential, sortable names.
func writeZip(output string, files []string, pad int) error {
	f, err := os.Create(output)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for n, src := range files {
		data, err := os.ReadFile(src)
		if err != nil {
			continue
		}
		name := fmt.Sprintf("%0*d%s", pad, n+1, filepath.Ext(src))
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			return err
		}
		if _, err := w.Write(data); err != nil {
			return err
		}
	}
	return zw.Close()
}

// ── PDF (in-process transcode → JPEG, embedded via DCTDecode) ──────────────────

func writePDF(output string, files []string) error {
	var jpegs [][]byte
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		// Already JPEG? Embed as-is. Otherwise decode + re-encode in-process.
		if bytes.HasPrefix(data, []byte{0xff, 0xd8}) {
			jpegs = append(jpegs, data)
			continue
		}
		im, err := img.Decode(data)
		if err != nil {
			continue
		}
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, im, &jpeg.Options{Quality: 88}); err != nil {
			continue
		}
		jpegs = append(jpegs, buf.Bytes())
	}
	if len(jpegs) == 0 {
		return fmt.Errorf("no pages could be converted for the PDF")
	}
	return os.WriteFile(output, buildPDF(jpegs), 0o644)
}

func parseJpegDims(b []byte) (w, h, comps int) {
	sof := map[byte]bool{0xc0: true, 0xc1: true, 0xc2: true, 0xc3: true, 0xc5: true,
		0xc6: true, 0xc7: true, 0xc9: true, 0xca: true, 0xcb: true, 0xcd: true, 0xce: true, 0xcf: true}
	i := 2
	for i+1 < len(b) {
		if b[i] != 0xff {
			i++
			continue
		}
		marker := b[i+1]
		i += 2
		if marker == 0xd8 || marker == 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker == 0x01 {
			continue
		}
		if marker == 0xff {
			i--
			continue
		}
		if i+1 >= len(b) {
			break
		}
		length := int(b[i])<<8 | int(b[i+1])
		if sof[marker] && i+7 < len(b) {
			return int(b[i+5])<<8 | int(b[i+6]), int(b[i+3])<<8 | int(b[i+4]), int(b[i+7])
		}
		i += length
	}
	return 800, 1200, 3
}

// buildPDF writes a minimal PDF embedding each JPEG as a full page.
func buildPDF(images [][]byte) []byte {
	var out bytes.Buffer
	offsets := map[int]int{}
	str := func(s string) { out.WriteString(s) }
	mark := func(n int) { offsets[n] = out.Len() }

	str("%PDF-1.7\n")
	out.Write([]byte{0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a})

	n := len(images)
	mark(1)
	str("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	var kids []string
	for i := 0; i < n; i++ {
		kids = append(kids, fmt.Sprintf("%d 0 R", 3+i*3))
	}
	mark(2)
	str(fmt.Sprintf("2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n", strings.Join(kids, " "), n))

	for i, im := range images {
		w, h, comps := parseJpegDims(im)
		cs := "/DeviceRGB"
		if comps == 1 {
			cs = "/DeviceGray"
		} else if comps == 4 {
			cs = "/DeviceCMYK"
		}
		pageN, imgN, contN := 3+i*3, 4+i*3, 5+i*3
		mark(pageN)
		str(fmt.Sprintf("%d 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>\nendobj\n",
			pageN, w, h, imgN, contN))
		mark(imgN)
		str(fmt.Sprintf("%d 0 obj\n<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n",
			imgN, w, h, cs, len(im)))
		out.Write(im)
		str("\nendstream\nendobj\n")
		content := fmt.Sprintf("q\n%d 0 0 %d 0 0 cm\n/Im0 Do\nQ\n", w, h)
		mark(contN)
		str(fmt.Sprintf("%d 0 obj\n<< /Length %d >>\nstream\n%sendstream\nendobj\n", contN, len(content), content))
	}

	lastObj := 2 + n*3
	xrefOffset := out.Len()
	str(fmt.Sprintf("xref\n0 %d\n0000000000 65535 f \n", lastObj+1))
	for o := 1; o <= lastObj; o++ {
		str(fmt.Sprintf("%010d 00000 n \n", offsets[o]))
	}
	str(fmt.Sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", lastObj+1, xrefOffset))
	return out.Bytes()
}

func trimNum(f float64) string {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// naturalLess compares strings with embedded numbers numerically ("Ch.2" < "Ch.10").
func naturalLess(a, b string) bool {
	ar, br := []rune(strings.ToLower(a)), []rune(strings.ToLower(b))
	i, j := 0, 0
	for i < len(ar) && j < len(br) {
		if isDigit(ar[i]) && isDigit(br[j]) {
			i0, j0 := i, j
			for i < len(ar) && isDigit(ar[i]) {
				i++
			}
			for j < len(br) && isDigit(br[j]) {
				j++
			}
			na, _ := strconv.Atoi(string(ar[i0:i]))
			nb, _ := strconv.Atoi(string(br[j0:j]))
			if na != nb {
				return na < nb
			}
			continue
		}
		if ar[i] != br[j] {
			return ar[i] < br[j]
		}
		i++
		j++
	}
	return len(ar)-i < len(br)-j
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

func sortNatural(ss []string) { sort.SliceStable(ss, func(a, b int) bool { return naturalLess(ss[a], ss[b]) }) }
