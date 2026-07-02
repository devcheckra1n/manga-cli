// Page/cover image disk cache — same layout as the TS version (md5 of the
// URL, original extension) so both binaries share downloaded pages.

package api

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CacheImage downloads url into dir (if not already there) and returns the path.
func CacheImage(dir, url string) (string, error) {
	ext := ".img"
	if i := strings.LastIndexByte(url, '.'); i > 0 {
		e := url[i:]
		if j := strings.IndexAny(e, "?&#"); j > 0 {
			e = e[:j]
		}
		if len(e) <= 6 {
			ext = e
		}
	}
	sum := md5.Sum([]byte(url))
	path := filepath.Join(dir, hex.EncodeToString(sum[:])+ext)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	data := FetchBinary(url)
	if data == nil {
		return "", fmt.Errorf("download failed: %s", url)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}
