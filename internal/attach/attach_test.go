// SPDX-License-Identifier: 0BSD
package attach

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTmp(t *testing.T, ttl time.Duration, max int64) *Store {
	t.Helper()
	s, err := New(filepath.Join(t.TempDir(), "atts"), ttl, max)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSaveGetRoundtrip(t *testing.T) {
	s := newTmp(t, time.Hour, 1<<20)
	m, err := s.Save("room1", "f.txt", "text/plain", bytes.NewReader([]byte("hello")))
	if err != nil {
		t.Fatal(err)
	}
	if m.Size != 5 || m.Name != "f.txt" || m.Mime != "text/plain" {
		t.Fatalf("bad meta: %+v", m)
	}
	got, err := s.Get("room1", m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != m.ID {
		t.Fatal("id mismatch")
	}
	data, err := os.ReadFile(s.BlobPath(got))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("bad blob: %q", data)
	}
}

func TestMimeSniffedWhenEmpty(t *testing.T) {
	s := newTmp(t, time.Hour, 1<<20)
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, bytes.Repeat([]byte{0}, 100)...)
	m, err := s.Save("room1", "img", "", bytes.NewReader(png))
	if err != nil {
		t.Fatal(err)
	}
	if m.Mime != "image/png" {
		t.Fatalf("expected image/png, got %s", m.Mime)
	}
}

func TestTooLarge(t *testing.T) {
	s := newTmp(t, time.Hour, 10)
	_, err := s.Save("room1", "big", "", bytes.NewReader(bytes.Repeat([]byte{1}, 100)))
	if err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}

func TestExpiredGet(t *testing.T) {
	s := newTmp(t, time.Millisecond, 1<<20)
	m, _ := s.Save("room1", "f", "", bytes.NewReader([]byte("x")))
	time.Sleep(5 * time.Millisecond)
	if _, err := s.Get("room1", m.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	if _, err := os.Stat(s.BlobPath(m)); !os.IsNotExist(err) {
		t.Fatal("expired blob should be removed")
	}
}

func TestInvalidID(t *testing.T) {
	s := newTmp(t, time.Hour, 1<<20)
	for _, id := range []string{"../etc", "A B", "", string(bytes.Repeat([]byte{'a'}, 100))} {
		if _, err := s.Get("room1", id); err != ErrNotFound {
			t.Fatalf("id %q should not resolve", id)
		}
	}
}

func TestSweepRemovesExpired(t *testing.T) {
	s := newTmp(t, time.Millisecond, 1<<20)
	m1, _ := s.Save("room1", "old", "", bytes.NewReader([]byte("x")))
	time.Sleep(5 * time.Millisecond)
	m2, _ := s.Save("room1", "new", "", bytes.NewReader([]byte("y")))
	_ = m1
	s.Sweep()
	if _, err := s.Get("room1", m1.ID); err != ErrNotFound {
		t.Fatal("old attachment should be swept")
	}
	if _, err := s.Get("room1", m2.ID); err != nil {
		t.Fatal("new attachment should survive sweep")
	}
}

func TestPurgeRoom(t *testing.T) {
	s := newTmp(t, time.Hour, 1<<20)
	m, _ := s.Save("room1", "f", "", bytes.NewReader([]byte("x")))
	s.PurgeRoom("room1")
	if _, err := s.Get("room1", m.ID); err != ErrNotFound {
		t.Fatal("purged room attachment should be gone")
	}
	if _, err := os.Stat(filepath.Join(s.dir, "room1")); !os.IsNotExist(err) {
		t.Fatal("room dir should be removed")
	}
}

func TestStreamNotBuffered(t *testing.T) {
	s := newTmp(t, time.Hour, 1<<20)
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		_, err := s.Save("room1", "s", "", pr)
		done <- err
	}()
	if _, err := pw.Write([]byte("chunk")); err != nil {
		t.Fatal(err)
	}
	pw.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
