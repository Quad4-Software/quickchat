// SPDX-License-Identifier: 0BSD
package attach

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var ErrNotFound = errors.New("attachment not found or expired")
var ErrTooLarge = errors.New("attachment exceeds size limit")

type Meta struct {
	ID        string    `json:"id"`
	Room      string    `json:"room"`
	Name      string    `json:"name"`
	Mime      string    `json:"mime"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

type Store struct {
	dir string
	ttl time.Duration
	max int64
}

func New(dir string, ttl time.Duration, max int64) (*Store, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	return &Store{dir: dir, ttl: ttl, max: max}, nil
}

func (s *Store) Save(room, name, mime string, r io.Reader) (*Meta, error) {
	if !validID(room) {
		return nil, ErrNotFound
	}
	id := newID()
	dir := filepath.Join(s.dir, room)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	blob := filepath.Join(dir, id+".blob")
	// #nosec G304 -- room is validated above and id is generated hex
	f, err := os.OpenFile(blob, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	n, err := io.Copy(f, io.LimitReader(r, s.max+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(blob)
		return nil, err
	}
	if n > s.max {
		_ = os.Remove(blob)
		return nil, ErrTooLarge
	}
	if mime == "" {
		mime = sniff(blob)
	}
	m := &Meta{
		ID: id, Room: room, Name: name, Mime: mime,
		Size: n, CreatedAt: time.Now(),
	}
	data, err := json.Marshal(m)
	if err != nil {
		_ = os.Remove(blob)
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, id+".json"), data, 0o600); err != nil {
		_ = os.Remove(blob)
		return nil, err
	}
	return m, nil
}

func (s *Store) Get(room, id string) (*Meta, error) {
	if !validID(room) || !validID(id) {
		return nil, ErrNotFound
	}
	// #nosec G304 -- room and id are validated lowercase alnum above
	data, err := os.ReadFile(filepath.Join(s.dir, room, id+".json"))
	if err != nil {
		return nil, ErrNotFound
	}
	var m Meta
	if json.Unmarshal(data, &m) != nil {
		return nil, ErrNotFound
	}
	if time.Since(m.CreatedAt) > s.ttl {
		s.remove(room, id)
		return nil, ErrNotFound
	}
	return &m, nil
}

// BlobPath returns the on-disk path for a meta entry.
func (s *Store) BlobPath(m *Meta) string {
	return filepath.Join(s.dir, m.Room, m.ID+".blob")
}

func (s *Store) PurgeRoom(room string) {
	if !validID(room) {
		return
	}
	// #nosec G304 -- room is validated lowercase alnum above
	_ = os.RemoveAll(filepath.Join(s.dir, room))
}

// Sweep removes expired attachments across all rooms.
func (s *Store) Sweep() {
	roomEntries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, re := range roomEntries {
		if !re.IsDir() {
			continue
		}
		roomDir := filepath.Join(s.dir, re.Name())
		entries, err := os.ReadDir(roomDir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if filepath.Ext(e.Name()) != ".json" {
				continue
			}
			// #nosec G304 -- names come from ReadDir, never from requests
			data, err := os.ReadFile(filepath.Join(roomDir, e.Name()))
			if err != nil {
				continue
			}
			var m Meta
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			if time.Since(m.CreatedAt) > s.ttl {
				s.remove(re.Name(), m.ID)
			}
		}
		// drop the room dir once empty
		if empty, _ := isEmpty(roomDir); empty {
			_ = os.Remove(roomDir)
		}
	}
}

func (s *Store) remove(room, id string) {
	_ = os.Remove(filepath.Join(s.dir, room, id+".blob"))
	_ = os.Remove(filepath.Join(s.dir, room, id+".json"))
}

func isEmpty(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	return len(entries) == 0, err
}

func validID(id string) bool {
	if len(id) == 0 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') {
			return false
		}
	}
	return true
}

func newID() string {
	var b [10]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func sniff(path string) string {
	// #nosec G304 -- path is a blob we just wrote under s.dir
	f, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer f.Close()
	var buf [512]byte
	n, _ := f.Read(buf[:])
	return http.DetectContentType(buf[:n])
}
