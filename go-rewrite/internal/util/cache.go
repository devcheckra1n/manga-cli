// Tiny disk cache: TTL-bound JSON entries, content-addressed by an md5 of the
// key. Same envelope ({at: epoch-ms, data: …}) and filenames as the TS version,
// so both implementations share one cache.

package util

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

func hashKey(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

type cacheEntry struct {
	At   int64           `json:"at"`
	Data json.RawMessage `json:"data"`
}

// ReadCache reads a cached value into out if present and within ttl.
// Returns false on any miss or error.
func ReadCache(dir, key string, ttl time.Duration, out any) bool {
	raw, err := os.ReadFile(filepath.Join(dir, hashKey(key)+".json"))
	if err != nil {
		return false
	}
	var e cacheEntry
	if json.Unmarshal(raw, &e) != nil {
		return false
	}
	if time.Since(time.UnixMilli(e.At)) > ttl {
		return false
	}
	return json.Unmarshal(e.Data, out) == nil
}

// WriteCache stores a value. Best-effort — never fails the caller.
func WriteCache(dir, key string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	e := cacheEntry{At: time.Now().UnixMilli(), Data: raw}
	blob, err := json.Marshal(e)
	if err != nil {
		return
	}
	if os.MkdirAll(dir, 0o755) != nil {
		return
	}
	_ = os.WriteFile(filepath.Join(dir, hashKey(key)+".json"), blob, 0o644)
}
