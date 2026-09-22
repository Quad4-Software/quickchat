// SPDX-License-Identifier: 0BSD
package rooms

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"log/slog"
	"strings"
	"time"

	"github.com/Quad4-Software/quickchat/internal/store"
)

type Manager struct {
	st  *store.Store
	ttl time.Duration
}

func NewManager(st *store.Store, ttl time.Duration) *Manager {
	return &Manager{st: st, ttl: ttl}
}

func (m *Manager) Create(ctx context.Context) (string, error) {
	id := newID()
	if err := m.st.PutRoom(ctx, id); err != nil {
		return "", err
	}
	return id, nil
}

func (m *Manager) Exists(ctx context.Context, id string) bool {
	ok, err := m.st.HasRoom(ctx, id)
	return err == nil && ok
}

// Sweep deletes rooms older than the configured TTL. Call periodically.
func (m *Manager) Sweep(ctx context.Context) {
	ids, err := m.st.ExpiredRooms(ctx, time.Now().Add(-m.ttl))
	if err != nil {
		slog.Warn("rooms sweep query failed", "err", err)
		return
	}
	for _, id := range ids {
		if err := m.st.DeleteRoom(ctx, id); err != nil {
			slog.Warn("rooms delete failed", "id", id, "err", err)
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
