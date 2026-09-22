// SPDX-License-Identifier: 0BSD
package rooms

import (
	"path/filepath"
	"testing"
	"time"

	"quad4/quickchat/internal/store"
)

func newManager(t *testing.T, ttl time.Duration) *Manager {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewManager(st, ttl)
}

func TestCreateAndExists(t *testing.T) {
	m := newManager(t, time.Hour)
	id, err := m.Create(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(id) != 10 {
		t.Fatalf("expected 10-char id, got %q", id)
	}
	for _, c := range id {
		if (c < 'a' || c > 'z') && (c < '2' || c > '7') {
			t.Fatalf("id %q has invalid char %c", id, c)
		}
	}
	if !m.Exists(t.Context(), id) {
		t.Fatal("created room should exist")
	}
	if m.Exists(t.Context(), "zzzzzzzzzz") {
		t.Fatal("unknown room should not exist")
	}
}

func TestCreateUnique(t *testing.T) {
	m := newManager(t, time.Hour)
	seen := map[string]bool{}
	for range 100 {
		id, err := m.Create(t.Context())
		if err != nil {
			t.Fatal(err)
		}
		if seen[id] {
			t.Fatalf("duplicate id %s", id)
		}
		seen[id] = true
	}
}

func TestSweep(t *testing.T) {
	m := newManager(t, time.Hour)
	id, _ := m.Create(t.Context())
	m.Sweep(t.Context())
	if !m.Exists(t.Context(), id) {
		t.Fatal("fresh room should survive sweep")
	}
	// ttl of zero expires anything created at or before now
	old := newManager(t, 0)
	oldID, _ := old.Create(t.Context())
	old.Sweep(t.Context())
	if old.Exists(t.Context(), oldID) {
		t.Fatal("expired room should be swept")
	}
}
