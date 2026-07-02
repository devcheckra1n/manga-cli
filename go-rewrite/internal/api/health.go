// Source health cache — persisted (same health.json as the TS version) so it
// survives across CLI invocations. A failure only counts against a source if
// the user's own internet is up, so a flaky connection never flags every
// source as "down".

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/util"
)

const cooldown = 5 * time.Minute

func healthFile() string { return filepath.Join(util.CacheDir, "health.json") }

type healthMap map[string]int64 // sourceId -> "failed until" epoch ms

func loadHealth() healthMap {
	raw, err := os.ReadFile(healthFile())
	if err != nil {
		return healthMap{}
	}
	var m healthMap
	if json.Unmarshal(raw, &m) != nil {
		return healthMap{}
	}
	return m
}

func saveHealth(m healthMap) {
	blob, err := json.Marshal(m)
	if err != nil {
		return
	}
	if os.MkdirAll(util.CacheDir, 0o755) != nil {
		return
	}
	_ = os.WriteFile(healthFile(), blob, 0o644)
}

// DownSources returns the source ids currently inside their failure cooldown.
func DownSources() map[SourceID]bool {
	m := loadHealth()
	now := time.Now().UnixMilli()
	down := map[SourceID]bool{}
	for id, until := range m {
		if until > now {
			down[SourceID(id)] = true
		}
	}
	return down
}

// MarkDown records a source failure — unless the internet itself is down.
// Returns true if the source was actually marked.
func MarkDown(id SourceID) bool {
	if !HasInternet() {
		return false // bad connection — don't blame the source
	}
	m := loadHealth()
	m[string(id)] = time.Now().Add(cooldown).UnixMilli()
	saveHealth(m)
	return true
}

func MarkUp(id SourceID) {
	m := loadHealth()
	if _, ok := m[string(id)]; ok {
		delete(m, string(id))
		saveHealth(m)
	}
}

// ClearHealth forgets all recorded failures (manga-cli sources reset).
func ClearHealth() { saveHealth(healthMap{}) }

// ── connectivity probe ─────────────────────────────────────────────────────────
// Tiny, highly-available endpoints (the same ones OSes use for captive-portal
// detection). If none answer quickly, the problem is the connection.

var probeURLs = []string{
	"https://www.gstatic.com/generate_204",
	"https://1.1.1.1/cdn-cgi/trace",
	"http://captive.apple.com/hotspot-detect.html",
}

const (
	probeTimeout = 3 * time.Second
	probeTTL     = 15 * time.Second // one verdict per command run
)

var (
	probeMu   sync.Mutex
	probeAt   time.Time
	probeUp   bool
	probeInit bool
)

// HasInternet reports whether the user's own connection is reachable. Memoized.
func HasInternet() bool {
	probeMu.Lock()
	defer probeMu.Unlock()
	if probeInit && time.Since(probeAt) < probeTTL {
		return probeUp
	}

	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	ok := make(chan bool, len(probeURLs))
	client := &http.Client{
		Timeout: probeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse // don't follow captive-portal redirects
		},
	}
	for _, u := range probeURLs {
		go func(u string) {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if err != nil {
				ok <- false
				return
			}
			res, err := client.Do(req)
			if err != nil {
				ok <- false
				return
			}
			res.Body.Close()
			ok <- res.StatusCode < 500
		}(u)
	}
	up := false
	for range probeURLs {
		if <-ok {
			up = true
			break
		}
	}
	probeAt, probeUp, probeInit = time.Now(), up, true
	return up
}
