// SPDX-License-Identifier: 0BSD
package hub

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	maxMessageBytes = 32 << 10
	sendBuffer      = 64
	writeTimeout    = 10 * time.Second
)

type Peer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Attachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	Mime string `json:"mime"`
}

type Message struct {
	ID         string      `json:"id"`
	Peer       Peer        `json:"peer"`
	Body       string      `json:"body,omitempty"`
	Attachment *Attachment `json:"attachment,omitempty"`
	Ts         int64       `json:"ts"`
}

type envelope map[string]any

type inbound struct {
	Type       string `json:"type"`
	Body       string `json:"body"`
	Attachment string `json:"attachment"`
	Typing     bool   `json:"typing"`
}

// LookupAttachment resolves an attachment ID to its metadata for embedding
// in outbound chat messages.
type LookupAttachment func(room, id string) *Attachment

type Hub struct {
	lookupAttach LookupAttachment

	mu    sync.Mutex
	rooms map[string]map[*Client]struct{}
	ids   uint64
}

func New(lookup LookupAttachment) *Hub {
	return &Hub{lookupAttach: lookup, rooms: make(map[string]map[*Client]struct{})}
}

// PeerCount reports connected chat clients in a room.
func (h *Hub) PeerCount(room string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms[room])
}

// CloseAll disconnects every client. Call on shutdown.
func (h *Hub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, clients := range h.rooms {
		for c := range clients {
			_ = c.conn.Close(websocket.StatusGoingAway, "server shutdown")
		}
	}
}

type Client struct {
	Peer
	conn *websocket.Conn
	send chan []byte
	hub  *Hub
	room string
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, roomID, name string) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionContextTakeover,
	})
	if err != nil {
		return
	}

	h.mu.Lock()
	h.ids++
	c := &Client{
		Peer: Peer{ID: peerID(h.ids), Name: name},
		conn: conn,
		send: make(chan []byte, sendBuffer),
		hub:  h,
		room: roomID,
	}
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*Client]struct{})
	}
	h.rooms[roomID][c] = struct{}{}
	peers := make([]Peer, 0, len(h.rooms[roomID]))
	for other := range h.rooms[roomID] {
		if other != c {
			peers = append(peers, other.Peer)
		}
	}
	h.mu.Unlock()

	defer h.unregister(c)
	go c.writeLoop()

	h.broadcast(roomID, c, envelope{"type": "peer_joined", "peer": c.Peer})
	c.deliver(envelope{"type": "welcome", "self": c.Peer, "peers": peers})
	c.readLoop()
}

func peerID(n uint64) string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567"
	var b [10]byte
	for i := range b {
		b[i] = alphabet[n&31]
		n >>= 5
	}
	return string(b[:])
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	clients := h.rooms[c.room]
	delete(clients, c)
	empty := len(clients) == 0
	if empty {
		delete(h.rooms, c.room)
	}
	h.mu.Unlock()

	close(c.send)
	_ = c.conn.Close(websocket.StatusNormalClosure, "")
	if !empty {
		h.broadcast(c.room, nil, envelope{"type": "peer_left", "peer": c.Peer})
	}
}

func (c *Client) readLoop() {
	c.conn.SetReadLimit(maxMessageBytes)
	for {
		_, data, err := c.conn.Read(context.Background())
		if err != nil {
			return
		}
		var in inbound
		if json.Unmarshal(data, &in) != nil {
			continue
		}
		switch in.Type {
		case "chat":
			c.hub.chat(c, in)
		case "typing":
			c.hub.broadcast(c.room, c, envelope{
				"type": "typing", "peer": c.Peer, "typing": in.Typing})
		}
	}
}

func (h *Hub) chat(c *Client, in inbound) {
	msg := Message{Peer: c.Peer, Ts: time.Now().UnixMilli()}
	if in.Attachment != "" && h.lookupAttach != nil {
		msg.Attachment = h.lookupAttach(c.room, in.Attachment)
		if msg.Attachment == nil {
			return
		}
	}
	msg.Body = truncate(in.Body, 4096)
	if msg.Body == "" && msg.Attachment == nil {
		return
	}
	msg.ID = msgID(c.room, msg.Ts)
	h.broadcast(c.room, nil, envelope{"type": "chat", "message": msg})
}

func msgID(room string, ts int64) string {
	// #nosec G115 -- unix milliseconds are always positive
	return room + "-" + peerID(uint64(ts))
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func (h *Hub) broadcast(room string, except *Client, ev envelope) {
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.rooms[room] {
		if c == except {
			continue
		}
		select {
		case c.send <- data:
		default:
			// slow consumer: drop the client rather than block the room
			go c.conn.Close(websocket.StatusPolicyViolation, "slow consumer")
		}
	}
}

func (c *Client) deliver(ev envelope) {
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	c.send <- data
}

func (c *Client) writeLoop() {
	for data := range c.send {
		ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
		err := c.conn.Write(ctx, websocket.MessageText, data)
		cancel()
		if err != nil {
			return
		}
	}
}
