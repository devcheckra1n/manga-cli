// Low-level HTTP: shared headers, timeout, jitter, error mapping.

package api

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	Origin    = "https://atsu.moe"
	browserUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

var httpClient = &http.Client{Timeout: 10 * time.Second}

// Image fetches get a much longer leash: a slow CDN window (atsu has them)
// should mean a slow page, not a lost one.
var binaryClient = &http.Client{Timeout: 45 * time.Second}

func debugEnabled() bool { return os.Getenv("MANGA_CLI_DEBUG") == "1" }

// APIError carries an optional HTTP status alongside the message.
type APIError struct {
	Msg    string
	Status int
}

func (e *APIError) Error() string { return e.Msg }

func apiErrf(status int, format string, args ...any) *APIError {
	return &APIError{Msg: fmt.Sprintf(format, args...), Status: status}
}

// jitter keeps us from hammering an origin in a tight loop.
func jitter() { time.Sleep(time.Duration(40+rand.Intn(120)) * time.Millisecond) }

func originOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return Origin + "/"
	}
	return u.Scheme + "://" + u.Host + "/"
}

func doGet(rawURL string, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return httpClient.Do(req)
}

// httpText GETs a URL and returns the body as text (HTML/RSS sources).
func httpText(rawURL string, headers map[string]string) (string, error) {
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[api] GET %s\n", rawURL)
	}
	jitter()
	res, err := doGet(rawURL, headers)
	if err != nil {
		return "", apiErrf(0, "Could not reach %s (%v)", originOf(rawURL), err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", apiErrf(res.StatusCode, "Request failed (HTTP %d)", res.StatusCode)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return "", apiErrf(0, "read failed: %v", err)
	}
	return string(body), nil
}

// httpJSON GETs a URL and decodes the JSON body into out.
func httpJSON(rawURL string, headers map[string]string, out any) error {
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[api] GET %s\n", rawURL)
	}
	jitter()
	res, err := doGet(rawURL, headers)
	if err != nil {
		return apiErrf(0, "Could not reach %s (%v)", originOf(rawURL), err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 160))
		msg := strings.TrimSpace(string(body))
		if msg != "" {
			return apiErrf(res.StatusCode, "Request failed (HTTP %d): %s", res.StatusCode, msg)
		}
		return apiErrf(res.StatusCode, "Request failed (HTTP %d)", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

const networkHint = "Could not reach atsu.moe. Check your connection — the site blocks some ISPs; " +
	"try 1.1.1.1 DNS or a VPN."

// apiGet GETs an atsu.moe JSON endpoint (path may be absolute or origin-relative).
func apiGet(path string, params url.Values, out any) error {
	full := path
	if !strings.HasPrefix(path, "http") {
		full = Origin + path
	}
	if len(params) > 0 {
		full += "?" + params.Encode()
	}
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[api] GET %s\n", full)
	}
	jitter()
	res, err := doGet(full, map[string]string{"Referer": Origin + "/"})
	if err != nil {
		return apiErrf(0, "%s (%v)", networkHint, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 180))
		msg := strings.TrimSpace(string(body))
		if msg != "" {
			return apiErrf(res.StatusCode, "Request to %s failed (HTTP %d): %s", path, res.StatusCode, msg)
		}
		return apiErrf(res.StatusCode, "Request to %s failed (HTTP %d)", path, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// FetchBinary downloads an image; returns nil on any failure (caller shows a placeholder).
func FetchBinary(rawURL string) []byte {
	abs := ResolveAssetURL(rawURL)
	if debugEnabled() {
		fmt.Fprintf(os.Stderr, "[api] IMG %s\n", abs)
	}
	req, err := http.NewRequest(http.MethodGet, abs, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Referer", originOf(abs))
	res, err := binaryClient.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil
	}
	return body
}

// ResolveAssetURL resolves a relative asset path from the atsu API into an
// absolute URL on the origin (which 302s to the CDN for page images).
func ResolveAssetURL(p string) string {
	if strings.HasPrefix(p, "http") {
		return p
	}
	path := p
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if !strings.HasPrefix(path, "/static/") {
		path = "/static" + path
	}
	return Origin + path
}
