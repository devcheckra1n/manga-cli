// nyaa.si manga torrents → magnet downloads via aria2c (the one optional
// external tool), plus the best-effort VPN check via ip-api.
// We stay strictly inside nyaa's Literature category (3_x) — never Anime (1_x).

package dl

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type DumpType struct {
	ID    string
	Cat   string
	Label string
}

var DumpTypes = []DumpType{
	{"eng", "3_1", "English-translated"},
	{"raw", "3_3", "Raw (original language)"},
	{"non-eng", "3_2", "Non-English-translated"},
	{"all", "3_0", "All literature (manga + novels)"},
}

func DumpCat(id string) string {
	for _, d := range DumpTypes {
		if d.ID == id {
			return d.Cat
		}
	}
	return "3_1"
}

type NyaaItem struct {
	Title    string
	InfoHash string
	Magnet   string
	Seeders  int
	Leechers int
	Size     string
	Category string
}

// aria2c can't speak UDP trackers; lean on nyaa's HTTP tracker + DHT/PEX/LPD.
var trackers = []string{
	"http://nyaa.tracker.wf:7777/announce",
	"http://anidex.moe:6969/announce",
	"http://tracker.openbittorrent.com:80/announce",
}

func magnetFor(infoHash, title string) string {
	var tr strings.Builder
	for _, t := range trackers {
		tr.WriteString("&tr=" + url.QueryEscape(t))
	}
	return "magnet:?xt=urn:btih:" + infoHash + "&dn=" + url.QueryEscape(title) + tr.String()
}

var (
	nyaaItemRe  = regexp.MustCompile(`(?s)<item>(.*?)</item>`)
	nyaaCDataRe = regexp.MustCompile(`<!\[CDATA\[|\]\]>`)
)

func rssTag(block, tag string) string {
	re := regexp.MustCompile(`(?s)<` + tag + `>(.*?)</` + tag + `>`)
	m := re.FindStringSubmatch(block)
	if m == nil {
		return ""
	}
	s := nyaaCDataRe.ReplaceAllString(m[1], "")
	s = strings.NewReplacer("&amp;", "&", "&quot;", `"`, "&#39;", "'", "&apos;", "'",
		"&lt;", "<", "&gt;", ">").Replace(s)
	return strings.TrimSpace(s)
}

func SearchNyaa(query, dump string) ([]NyaaItem, error) {
	u := "https://nyaa.si/?page=rss&c=" + DumpCat(dump) + "&f=0&q=" + url.QueryEscape(query)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Get(u)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	buf := new(strings.Builder)
	if _, err := copyN(buf, res); err != nil {
		return nil, err
	}
	xml := buf.String()
	var items []NyaaItem
	for _, m := range nyaaItemRe.FindAllStringSubmatch(xml, -1) {
		block := m[1]
		infoHash := rssTag(block, "nyaa:infoHash")
		if infoHash == "" {
			continue
		}
		title := rssTag(block, "title")
		seeders, _ := strconv.Atoi(rssTag(block, "nyaa:seeders"))
		leechers, _ := strconv.Atoi(rssTag(block, "nyaa:leechers"))
		items = append(items, NyaaItem{
			Title: title, InfoHash: infoHash, Magnet: magnetFor(infoHash, title),
			Seeders: seeders, Leechers: leechers,
			Size: rssTag(block, "nyaa:size"), Category: rssTag(block, "nyaa:category"),
		})
	}
	sort.SliceStable(items, func(a, b int) bool { return items[a].Seeders > items[b].Seeders })
	return items, nil
}

func copyN(dst *strings.Builder, res *http.Response) (int64, error) {
	buf := make([]byte, 32*1024)
	var n int64
	for {
		k, err := res.Body.Read(buf)
		dst.Write(buf[:k])
		n += int64(k)
		if err != nil {
			if err.Error() == "EOF" {
				return n, nil
			}
			return n, nil
		}
		if n > 8<<20 {
			return n, nil
		}
	}
}

// DownloadMagnet hands a magnet to aria2c with live progress inherited.
func DownloadMagnet(magnet, dir string) (bool, error) {
	if _, err := exec.LookPath("aria2c"); err != nil {
		return false, fmt.Errorf("aria2c not found — install it (brew install aria2)")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false, err
	}
	cmd := exec.Command("aria2c",
		"--seed-time=0", "--bt-stop-timeout=600", "--summary-interval=1",
		"--console-log-level=warn", "--enable-dht=true", "--bt-enable-lpd=true",
		"--enable-peer-exchange=true", "--dir", dir, magnet)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run() == nil, nil
}

// ── VPN check ──────────────────────────────────────────────────────────────────

type VpnStatus struct {
	IP        string `json:"query"`
	ISP       string `json:"isp"`
	Org       string `json:"org"`
	Country   string `json:"country"`
	Hosting   bool   `json:"hosting"`
	Proxy     bool   `json:"proxy"`
	LikelyVpn bool   `json:"-"`
}

// CheckVpn reads the public IP's hosting/proxy flags. Datacenter/proxy IPs are
// very likely a VPN; a residential ISP almost certainly means it's off.
func CheckVpn() *VpnStatus {
	client := &http.Client{Timeout: 8 * time.Second}
	res, err := client.Get("http://ip-api.com/json/?fields=query,country,isp,org,hosting,proxy")
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	var v VpnStatus
	if json.NewDecoder(res.Body).Decode(&v) != nil {
		return nil
	}
	v.LikelyVpn = v.Hosting || v.Proxy
	return &v
}
