// SPDX-License-Identifier: 0BSD
package store

import (
	"path/filepath"
	"testing"
	"time"
)

func openTmp(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestRoomLifecycle(t *testing.T) {
	st := openTmp(t)

	ok, err := st.HasRoom(t.Context(), "nope")
	if err != nil || ok {
		t.Fatalf("expected missing room, got ok=%v err=%v", ok, err)
	}
	if err := st.PutRoom(t.Context(), "abc123"); err != nil {
		t.Fatal(err)
	}
	if err := st.PutRoom(t.Context(), "abc123"); err != nil {
		t.Fatal("re-put must not error")
	}
	ok, err = st.HasRoom(t.Context(), "abc123")
	if err != nil || !ok {
		t.Fatal("room should exist")
	}
	if err := st.DeleteRoom(t.Context(), "abc123"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := st.HasRoom(t.Context(), "abc123"); ok {
		t.Fatal("room should be deleted")
	}
}

func TestExpiredRooms(t *testing.T) {
	st := openTmp(t)
	if err := st.PutRoom(t.Context(), "fresh"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.db.Exec(
		`INSERT INTO rooms (id, created_at) VALUES ('old', ?)`,
		time.Now().Add(-48*time.Hour).Unix(),
	); err != nil {
		t.Fatal(err)
	}
	ids, err := st.ExpiredRooms(t.Context(), time.Now().Add(-24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "old" {
		t.Fatalf("expected [old], got %v", ids)
	}
}

func TestPing(t *testing.T) {
	st := openTmp(t)
	if err := st.Ping(t.Context()); err != nil {
		t.Fatal(err)
	}
}
