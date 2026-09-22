// SPDX-License-Identifier: 0BSD
package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Quad4-Software/quickchat/internal/config"
	"github.com/Quad4-Software/quickchat/internal/hub"
	"github.com/Quad4-Software/quickchat/internal/rooms"
	"github.com/Quad4-Software/quickchat/internal/store"
)

func testConfig() config.Config {
	return config.Config{MaxFileBytes: 1 << 20}
}

func newTestServer(t *testing.T, cfg config.Config) *httptest.Server {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	rm := rooms.NewManager(st, time.Hour)
	h := hub.New()
	srv := New(cfg, rm, h, st.Ping)
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
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.StatusCode)
	}
	var info struct {
		ID          string   `json:"id"`
		Peers       int      `json:"peers"`
		Livekit     bool     `json:"livekit"`
		ICEServers  []string `json:"iceServers"`
		MaxFileSize int64    `json:"maxFileSize"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.ID != id || info.MaxFileSize != 1<<20 {
		t.Fatalf("bad room info: %+v", info)
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

func TestRoomInfoICEServers(t *testing.T) {
	cfg := testConfig()
	cfg.ICEServers = []string{"stun:stun.example.com:3478"}
	ts := newTestServer(t, cfg)
	id := createRoom(t, ts)
	res, err := http.Get(ts.URL + "/api/rooms/" + id)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info struct {
		ICEServers []string `json:"iceServers"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if len(info.ICEServers) != 1 || info.ICEServers[0] != "stun:stun.example.com:3478" {
		t.Fatalf("ice servers not advertised: %+v", info)
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

func TestOpenAPISpec(t *testing.T) {
	ts := newTestServer(t, testConfig())
	res, err := http.Get(ts.URL + "/api/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "openapi: 3.1.0") {
		t.Fatal("spec not served")
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/yaml" {
		t.Fatalf("bad content type: %s", ct)
	}
}

func TestAttachmentEndpointsGone(t *testing.T) {
	ts := newTestServer(t, testConfig())
	id := createRoom(t, ts)
	res, err := http.Post(ts.URL+"/api/rooms/"+id+"/attachments?name=f.txt",
		"text/plain", strings.NewReader("x"))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	// the spa fallback serves index.html for unknown paths, which is fine:
	// the point is no upload is stored. Assert it is not a 201 json meta.
	if res.StatusCode == http.StatusCreated {
		t.Fatal("attachment upload endpoint should not exist")
	}
}
