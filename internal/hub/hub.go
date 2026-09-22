// SPDX-License-Identifier: 0BSD

// Package hub relays room presence and WebRTC signaling over websocket.
// Chat messages and file transfers never touch the server: they flow
// peer to peer over RTCDataChannel once signaling completes.
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
	maxRoomPeers    = 64
)

type Peer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type envelope map[string]any

type inbound struct {
	Type string          `json:"type"`
	To   string          `json:"to"`
	Data json.RawMessage `json:"data"`
}

type Hub struct {
	mu    sync.Mutex
	rooms map[string]map[*Client]struct{}
	ids   uint64
}

func New() *Hub {
	return &Hub{rooms: make(map[string]map[*Client]struct{})}
}

// PeerCount reports connected clients in a room.
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
	if len(h.rooms[roomID]) >= maxRoomPeers {
		h.mu.Unlock()
		_ = conn.Close(websocket.StatusPolicyViolation, "room full")
		return
	}
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
		if !parseInbound(data, &in) {
			continue
		}
		if in.Type == "signal" && in.To != "" && validPayload(in.Data) {
			c.hub.relay(c, in.To, envelope{
				"type": "signal", "from": c.Peer, "data": in.Data})
		}
	}
}

// parseInbound decodes a client frame. Separated for fuzzing.
func parseInbound(data []byte, in *inbound) bool {
	return json.Unmarshal(data, in) == nil
}

// validPayload rejects absent and json null payloads so peers always
// receive a real object to parse.
func validPayload(d json.RawMessage) bool {
	return len(d) > 0 && string(d) != "null"
}

// relay forwards a signaling payload to one peer in the sender's room.
func (h *Hub) relay(from *Client, to string, ev envelope) {
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.rooms[from.room] {
		if c.ID == to {
			select {
			case c.send <- data:
			default:
				go func() {
					_ = c.conn.Close(websocket.StatusPolicyViolation, "slow consumer")
				}()
			}
			return
		}
	}
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
			go func() { _ = c.conn.Close(websocket.StatusPolicyViolation, "slow consumer") }()
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
