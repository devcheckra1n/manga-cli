// MyAnimeList tracking — same ~/.config/manga-cli/mal.json and two-step paste
// login as the TS version (PKCE "plain": challenge == verifier).

package util

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	malOAuth       = "https://myanimelist.net/v1/oauth2"
	malAPI         = "https://api.myanimelist.net/v2"
	MalRedirectURI = "http://localhost:8723/callback"
)

func malFile() string { return filepath.Join(ConfigDir, "mal.json") }

type malToken struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}
type malPending struct {
	Verifier string `json:"verifier"`
	State    string `json:"state"`
}
type malStore struct {
	Token    *malToken       `json:"token,omitempty"`
	MangaIDs map[string]*int `json:"mangaIds,omitempty"`
	Pending  *malPending     `json:"pending,omitempty"`
}

func malLoad() malStore {
	var s malStore
	if raw, err := os.ReadFile(malFile()); err == nil {
		_ = json.Unmarshal(raw, &s)
	}
	return s
}

func malSave(s malStore) {
	blob, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	if os.MkdirAll(ConfigDir, 0o755) != nil {
		return
	}
	_ = os.WriteFile(malFile(), blob, 0o600)
}

func MalLoggedIn() bool { return malLoad().Token != nil }

func MalLogout() {
	s := malLoad()
	s.Token = nil
	malSave(s)
}

func randomString(n int) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}

// MalBeginLogin builds the authorize URL and stashes the PKCE state.
func MalBeginLogin(clientID string) string {
	verifier := randomString(96)
	state := randomString(16)
	s := malLoad()
	s.Pending = &malPending{Verifier: verifier, State: state}
	malSave(s)
	return malOAuth + "/authorize?response_type=code&client_id=" + clientID +
		"&code_challenge=" + verifier + "&code_challenge_method=plain&state=" + state +
		"&redirect_uri=" + url.QueryEscape(MalRedirectURI)
}

// MalCompleteFromInput finishes login from a pasted redirect URL (or bare code).
func MalCompleteFromInput(clientID, clientSecret, input string) error {
	s := malLoad()
	if s.Pending == nil {
		return fmt.Errorf("no login in progress — run `manga-cli mal login` first")
	}
	code := extractCode(input, s.Pending.State)
	if code == "" {
		return fmt.Errorf("couldn't read a valid code (state didn't match?) — re-run `mal login` and use THAT run's URL")
	}
	if err := malExchange(clientID, clientSecret, url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"code_verifier": {s.Pending.Verifier},
		"redirect_uri":  {MalRedirectURI},
	}); err != nil {
		return err
	}
	s = malLoad()
	s.Pending = nil
	malSave(s)
	return nil
}

func extractCode(pasted, expectedState string) string {
	in := strings.TrimSpace(pasted)
	if in == "" {
		return ""
	}
	if strings.Contains(in, "code=") {
		raw := in
		if !strings.Contains(raw, "://") {
			raw = "http://x/?" + strings.TrimPrefix(raw, "?")
		}
		if u, err := url.Parse(raw); err == nil {
			q := u.Query()
			if st := q.Get("state"); expectedState != "" && st != "" && st != expectedState {
				return ""
			}
			if c := q.Get("code"); c != "" {
				return c
			}
		}
		return ""
	}
	return in // assume a bare code
}

func malExchange(clientID, clientSecret string, params url.Values) error {
	if clientSecret != "" {
		params.Set("client_secret", clientSecret)
	}
	res, err := http.PostForm(malOAuth+"/token", params)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 160))
		return fmt.Errorf("token exchange failed (HTTP %d): %s", res.StatusCode, string(body))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil {
		return err
	}
	s := malLoad()
	s.Token = &malToken{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ExpiresAt:    time.Now().UnixMilli() + tok.ExpiresIn*1000,
	}
	malSave(s)
	return nil
}

func malValidToken(clientID, clientSecret string) string {
	s := malLoad()
	if s.Token == nil {
		return ""
	}
	if s.Token.ExpiresAt > time.Now().UnixMilli()+60_000 {
		return s.Token.AccessToken
	}
	if err := malExchange(clientID, clientSecret, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {clientID},
		"refresh_token": {s.Token.RefreshToken},
	}); err != nil {
		return ""
	}
	return malLoad().Token.AccessToken
}

func malGet(token, path string, out any) error {
	req, _ := http.NewRequest(http.MethodGet, malAPI+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// MalWhoAmI returns the linked account's username, or "".
func MalWhoAmI(clientID, clientSecret string) string {
	token := malValidToken(clientID, clientSecret)
	if token == "" {
		return ""
	}
	var res struct {
		Name string `json:"name"`
	}
	if malGet(token, "/users/@me?fields=name", &res) != nil {
		return ""
	}
	if res.Name == "" {
		return "user"
	}
	return res.Name
}

func malFindMangaID(token, title string) int {
	s := malLoad()
	if s.MangaIDs == nil {
		s.MangaIDs = map[string]*int{}
	}
	if id, ok := s.MangaIDs[title]; ok {
		if id == nil {
			return 0
		}
		return *id
	}
	q := title
	if len(q) > 64 {
		q = q[:64]
	}
	var res struct {
		Data []struct {
			Node struct {
				ID    int    `json:"id"`
				Title string `json:"title"`
			} `json:"node"`
		} `json:"data"`
	}
	var id *int
	if malGet(token, "/manga?q="+url.QueryEscape(q)+"&limit=5&fields=id,title", &res) == nil {
		for _, d := range res.Data {
			if strings.EqualFold(d.Node.Title, title) {
				v := d.Node.ID
				id = &v
				break
			}
		}
		if id == nil && len(res.Data) > 0 {
			v := res.Data[0].Node.ID
			id = &v
		}
	}
	s.MangaIDs[title] = id
	malSave(s)
	if id == nil {
		return 0
	}
	return *id
}

// MalUpdateProgress bumps reading progress for a title. Best-effort.
func MalUpdateProgress(clientID, clientSecret, title string, chaptersRead float64) bool {
	token := malValidToken(clientID, clientSecret)
	if token == "" {
		return false
	}
	id := malFindMangaID(token, title)
	if id == 0 {
		return false
	}
	body := url.Values{
		"num_chapters_read": {strconv.Itoa(max(0, int(chaptersRead)))},
		"status":            {"reading"},
	}
	req, _ := http.NewRequest(http.MethodPatch, fmt.Sprintf("%s/manga/%d/my_list_status", malAPI, id),
		strings.NewReader(body.Encode()))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == 200
}
