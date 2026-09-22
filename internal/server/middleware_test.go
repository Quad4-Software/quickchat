// SPDX-License-Identifier: 0BSD
package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	ts := newTestServer(t, testConfig())
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	for _, h := range []string{
		"Content-Security-Policy",
		"X-Content-Type-Options",
		"X-Frame-Options",
		"Referrer-Policy",
		"Cross-Origin-Opener-Policy",
	} {
		if res.Header.Get(h) == "" {
			t.Fatalf("missing header %s", h)
		}
	}
	if !strings.Contains(res.Header.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatalf("bad csp: %s", res.Header.Get("Content-Security-Policy"))
	}
}

func TestCSPIncludesLiveKitHost(t *testing.T) {
	cfg := testConfig()
	cfg.LiveKitURL = "wss://lk.example.com"
	ts := newTestServer(t, cfg)
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if !strings.Contains(res.Header.Get("Content-Security-Policy"), "wss://lk.example.com") {
		t.Fatalf("csp should allow livekit host: %s",
			res.Header.Get("Content-Security-Policy"))
	}
}

func TestCacheControl(t *testing.T) {
	ts := newTestServer(t, testConfig())

	res, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("index should be no-cache, got %s", res.Header.Get("Cache-Control"))
	}

	// exercise the middleware directly: served assets are immutable
	stub := cacheControl(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	stub.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil))
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("assets should be immutable, got %s", rec.Header().Get("Cache-Control"))
	}
}

func TestGzip(t *testing.T) {
	ts := newTestServer(t, testConfig())
	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, got %s", res.Header.Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "<html") {
		t.Fatalf("decompressed body wrong: %.80s", body)
	}
}

func TestRateLimit(t *testing.T) {
	ts := newTestServer(t, testConfig())
	var last int
	// create limiter is 12/min burst 6; 7 posts should trip it
	for range 7 {
		res, err := http.Post(ts.URL+"/api/rooms", "", nil)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		last = res.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after burst, got %d", last)
	}
}
