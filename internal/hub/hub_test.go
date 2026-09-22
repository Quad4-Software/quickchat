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
	"go.uber.org/goleak"
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

func TestNoncePassthrough(t *testing.T) {
	ts := newTestServer(t)
	c := ts.dial(t, "room", "alice")
	readEvent(t, c)
	send(t, c, map[string]any{"type": "chat", "body": "hi", "nonce": "n42"})
	e := readEvent(t, c)
	if e["message"].(map[string]any)["nonce"] != "n42" {
		t.Fatalf("nonce not echoed: %v", e["message"])
	}
}

func TestMalformedFramesIgnored(t *testing.T) {
	ts := newTestServer(t)
	c := ts.dial(t, "room", "alice")
	readEvent(t, c)

	// garbage bytes, wrong types, empty messages: none should kill the conn
	for _, junk := range []any{
		"not json at all",
		map[string]any{"type": "chat", "body": 12345},
		map[string]any{"type": "bogus"},
		map[string]any{"type": "chat"},
		map[string]any{"type": "chat", "body": "   "},
	} {
		if s, ok := junk.(string); ok {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			err := c.Write(ctx, websocket.MessageText, []byte(s))
			cancel()
			if err != nil {
				t.Fatal(err)
			}
		} else {
			send(t, c, junk)
		}
	}
	send(t, c, map[string]any{"type": "chat", "body": "still here"})
	e := readEvent(t, c)
	if e["message"].(map[string]any)["body"] != "still here" {
		t.Fatal("connection should survive malformed frames")
	}
}

func TestOversizeFrameDisconnects(t *testing.T) {
	ts := newTestServer(t)
	c := ts.dial(t, "room", "alice")
	readEvent(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err := c.Write(ctx, websocket.MessageText,
		[]byte(`{"type":"chat","body":"`+strings.Repeat("x", 40<<10)+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = c.Read(ctx)
	if err == nil {
		t.Fatal("oversize frame should close the connection")
	}
}

func TestRoomFull(t *testing.T) {
	ts := newTestServer(t)
	var conns []*websocket.Conn
	for i := range maxRoomPeers {
		conns = append(conns, ts.dial(t, "room", "p"))
		readEvent(t, conns[i])
	}
	url := "ws" + strings.TrimPrefix(ts.srv.URL, "http") + "/room?name=late"
	c, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		// server may refuse the upgrade outright
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _, err = c.Read(ctx)
	if err == nil {
		t.Fatal("full room should disconnect the late client")
	}
}

func TestNoGoroutineLeak(t *testing.T) {
	ts := newTestServer(t)
	c := ts.dial(t, "room", "alice")
	readEvent(t, c)
	send(t, c, map[string]any{"type": "chat", "body": "x"})
	readEvent(t, c)
	c.Close(websocket.StatusNormalClosure, "")
	// let the server observe the close and unwind
	for range 50 {
		if ts.h.PeerCount("room") == 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if ts.h.PeerCount("room") != 0 {
		t.Fatal("peer was not unregistered")
	}
	// close now rather than in cleanup so the accept loop is gone before
	// the leak check runs
	ts.srv.Close()
	goleak.VerifyNone(t)
}

func FuzzInbound(f *testing.F) {
	f.Add([]byte(`{"type":"chat","body":"hi"}`))
	f.Add([]byte(`{"type":"typing","typing":true}`))
	f.Add([]byte(`{}`))
	f.Add([]byte(`[1,2,3]`))
	f.Add([]byte(``))
	f.Fuzz(func(t *testing.T, data []byte) {
		var in inbound
		_ = parseInbound(data, &in) // must never panic
	})
}

func FuzzPeerID(f *testing.F) {
	f.Add(uint64(0))
	f.Add(uint64(1 << 62))
	f.Fuzz(func(t *testing.T, n uint64) {
		id := peerID(n)
		if len(id) != 10 {
			t.Fatalf("peerID(%d) len %d", n, len(id))
		}
		for _, c := range id {
			if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz234567", c) {
				t.Fatalf("peerID(%d) has bad char %q", n, c)
			}
		}
	})
}
