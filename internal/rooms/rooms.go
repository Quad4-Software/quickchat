// SPDX-License-Identifier: 0BSD
package rooms

import (
	"crypto/rand"
	"encoding/base32"
	"log"
	"strings"
	"time"

	"quad4/quickchat/internal/store"
)

type Manager struct {
	st  *store.Store
	ttl time.Duration
}

func NewManager(st *store.Store, ttl time.Duration) *Manager {
	return &Manager{st: st, ttl: ttl}
}

func (m *Manager) Create() (string, error) {
	id := newID()
	if err := m.st.PutRoom(id); err != nil {
		return "", err
	}
	return id, nil
}

func (m *Manager) Exists(id string) bool {
	ok, err := m.st.HasRoom(id)
	return err == nil && ok
}

// Sweep deletes rooms older than the configured TTL. Call periodically.
func (m *Manager) Sweep() {
	ids, err := m.st.ExpiredRooms(time.Now().Add(-m.ttl))
	if err != nil {
		log.Printf("rooms: sweep query: %v", err)
		return
	}
	for _, id := range ids {
		if err := m.st.DeleteRoom(id); err != nil {
			log.Printf("rooms: delete %s: %v", id, err)
		}
	}
}

func newID() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return strings.ToLower(
		base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}
