// SPDX-License-Identifier: 0BSD
package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type testServer struct {
	h   *Hub
	srv *httptest.Server
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	h := New(nil)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeWS(w, r, strings.TrimPrefix(r.URL.Path, "/"), r.URL.Query().Get("name"))
	}))
	t.Cleanup(srv.Close)
	return &testServer{h: h, srv: srv}
}

func (ts *testServer) dial(t *testing.T, room, name string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(ts.srv.URL, "http") + "/" + room + "?name=" + name
	c, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(websocket.StatusNormalClosure, "") })
	return c
}

func readEvent(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var e map[string]any
	if err := json.Unmarshal(data, &e); err != nil {
		t.Fatal(err)
	}
	return e
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	data, _ := json.Marshal(v)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}

func TestWelcomeAndRoster(t *testing.T) {
	ts := newTestServer(t)
	alice := ts.dial(t, "room", "alice")
	e := readEvent(t, alice)
	if e["type"] != "welcome" {
		t.Fatalf("expected welcome, got %v", e)
	}
	if e["self"].(map[string]any)["name"] != "alice" {
		t.Fatal("welcome should carry self")
	}

	bob := ts.dial(t, "room", "bob")
	e = readEvent(t, bob)
	if len(e["peers"].([]any)) != 1 {
		t.Fatal("bob should see alice in roster")
	}

	e = readEvent(t, alice)
	if e["type"] != "peer_joined" || e["peer"].(map[string]any)["name"] != "bob" {
		t.Fatalf("alice should see peer_joined for bob, got %v", e)
	}
	if n := ts.h.PeerCount("room"); n != 2 {
		t.Fatalf("expected 2 peers, got %d", n)
	}
}

func TestChatBroadcast(t *testing.T) {
	ts := newTestServer(t)
	alice := ts.dial(t, "room", "alice")
	readEvent(t, alice)
	bob := ts.dial(t, "room", "bob")
	readEvent(t, bob)
	readEvent(t, alice) // peer_joined

	send(t, bob, map[string]any{"type": "chat", "body": "hello"})

	for _, c := range []*websocket.Conn{alice, bob} {
		e := readEvent(t, c)
		if e["type"] != "chat" {
			t.Fatalf("expected chat, got %v", e)
		}
		msg := e["message"].(map[string]any)
		if msg["body"] != "hello" || msg["peer"].(map[string]any)["name"] != "bob" {
			t.Fatalf("bad message: %v", msg)
		}
	}
}

func TestPeerLeft(t *testing.T) {
	ts := newTestServer(t)
	alice := ts.dial(t, "room", "alice")
	readEvent(t, alice)
	bob := ts.dial(t, "room", "bob")
	readEvent(t, bob)
	readEvent(t, alice) // peer_joined

	bob.Close(websocket.StatusNormalClosure, "")

	e := readEvent(t, alice)
	if e["type"] != "peer_left" || e["peer"].(map[string]any)["name"] != "bob" {
		t.Fatalf("expected peer_left, got %v", e)
	}
}

func TestAttachmentResolution(t *testing.T) {
	att := &Attachment{ID: "a1", Name: "f.txt", Size: 3, Mime: "text/plain"}
	h := New(func(room, id string) *Attachment {
		if id == "a1" {
			return att
		}
		return nil
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeWS(w, r, "room", "alice")
	}))
	defer srv.Close()

	c, _, err := websocket.Dial(context.Background(),
		"ws"+strings.TrimPrefix(srv.URL, "http")+"/?name=alice", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	readEvent(t, c)

	send(t, c, map[string]any{"type": "chat", "attachment": "a1"})
	e := readEvent(t, c)
	msg := e["message"].(map[string]any)
	if msg["attachment"].(map[string]any)["name"] != "f.txt" {
		t.Fatalf("attachment not embedded: %v", msg)
	}

	// unknown attachment id must be dropped
	send(t, c, map[string]any{"type": "chat", "attachment": "nope"})
	send(t, c, map[string]any{"type": "chat", "body": "still alive"})
	e = readEvent(t, c)
	if e["type"] != "chat" || e["message"].(map[string]any)["body"] != "still alive" {
		t.Fatal("chat should continue after dropped attachment message")
	}
}
