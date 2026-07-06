package main

import (
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"time"
	"github.com/devcheckra1n/manga-cli/go-rewrite/internal/api"
)

func main() {
	rc, _ := api.Get("atsumaru").Pages("BI6nT", "KGQQdsKz") // Ch.120, cold
	fmt.Println("pages:", len(rc.Pages))
	// default (h2) client
	h2 := &http.Client{Timeout: 10 * time.Second}
	// forced HTTP/1.1 client
	h1 := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{
		TLSNextProto: map[string]func(string, *tls.Conn) http.RoundTripper{},
		MaxIdleConnsPerHost: 8,
	}}
	for name, c := range map[string]*http.Client{"h2-default": h2, "h1-forced": h1} {
		errs := map[string]int{}
		ok := 0
		for _, p := range rc.Pages {
			req, _ := http.NewRequest("GET", p.URL, nil)
			req.Header.Set("User-Agent", "Mozilla/5.0")
			req.Header.Set("Referer", "https://atsu.moe/")
			res, err := c.Do(req)
			if err != nil {
				msg := err.Error()
				if len(msg) > 70 { msg = msg[len(msg)-70:] }
				errs[msg]++
				continue
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			if res.StatusCode == 200 { ok++ }
		}
		fmt.Printf("%s: ok=%d/%d\n", name, ok, len(rc.Pages))
		for k, v := range errs { fmt.Printf("   %d x …%s\n", v, k) }
	}
}
