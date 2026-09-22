// SPDX-License-Identifier: 0BSD
package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"quad4/quickchat/internal/attach"
	"quad4/quickchat/internal/config"
	"quad4/quickchat/internal/hub"
	"quad4/quickchat/internal/rooms"
	"quad4/quickchat/internal/store"
)

func testConfig() config.Config {
	return config.Config{MaxUploadBytes: 1 << 20}
}

func newTestServer(t *testing.T, cfg config.Config) *httptest.Server {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	atts, err := attach.New(filepath.Join(dir, "atts"), time.Hour, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	rm := rooms.NewManager(st, time.Hour)
	h := hub.New(nil)
	srv := New(cfg, rm, h, atts, st.Ping)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func createRoom(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	res, err := http.Post(ts.URL+"/api/rooms", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", res.StatusCode)
	}
	var v struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if v.ID == "" {
		t.Fatal("empty room id")
	}
	return v.ID
}

func TestHealthEndpoints(t *testing.T) {
	ts := newTestServer(t, testConfig())
	for _, p := range []string{"/healthz", "/readyz"} {
		res, err := http.Get(ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", p, res.StatusCode)
		}
	}
}

func TestRoomEndpoints(t *testing.T) {
	ts := newTestServer(t, testConfig())
	id := createRoom(t, ts)

	res, err := http.Get(ts.URL + "/api/rooms/" + id)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}

	res, err = http.Get(ts.URL + "/api/rooms/doesnotexist")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.StatusCode)
	}
}

func TestTokenWithoutLiveKit(t *testing.T) {
	ts := newTestServer(t, testConfig())
	id := createRoom(t, ts)
	res, err := http.Get(ts.URL + "/api/rooms/" + id + "/token?name=bob")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", res.StatusCode)
	}
}

func TestTokenWithLiveKit(t *testing.T) {
	cfg := config.Config{
		LiveKitURL:    "wss://lk.example.com",
		LiveKitAPIKey: "key",
		LiveKitSecret: "secretsecretsecretsecretsecret",
	}
	ts := newTestServer(t, cfg)
	id := createRoom(t, ts)
	res, err := http.Get(ts.URL + "/api/rooms/" + id + "/token?name=bob")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var v struct {
		URL      string `json:"url"`
		Token    string `json:"token"`
		Identity string `json:"identity"`
	}
	if err := json.NewDecoder(res.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if v.URL != cfg.LiveKitURL || v.Token == "" || v.Identity == "" {
		t.Fatalf("bad grant: %+v", v)
	}
}

func TestAttachmentRoundtrip(t *testing.T) {
	ts := newTestServer(t, testConfig())
	id := createRoom(t, ts)

	res, err := http.Post(
		ts.URL+"/api/rooms/"+id+"/attachments?name=f.txt",
		"text/plain",
		bytes.NewReader([]byte("payload")),
	)
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		ID string `json:"id"`
	}
	json.NewDecoder(res.Body).Decode(&m)
	res.Body.Close()
	if m.ID == "" {
		t.Fatal("no attachment id")
	}

	res, err = http.Get(ts.URL + "/api/rooms/" + id + "/attachments/" + m.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if string(body) != "payload" {
		t.Fatalf("bad body: %q", body)
	}
	if res.Header.Get("Content-Type") != "text/plain" {
		t.Fatalf("bad content type: %s", res.Header.Get("Content-Type"))
	}

	// unknown attachment 404s
	res, err = http.Get(ts.URL + "/api/rooms/" + id + "/attachments/zzz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.StatusCode)
	}
}
