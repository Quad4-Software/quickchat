// SPDX-License-Identifier: 0BSD

// Package store persists minimal room metadata in sqlite. Chat messages
// and attachments are deliberately not stored here.
package store

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	_, err = db.ExecContext(context.Background(), `CREATE TABLE IF NOT EXISTS rooms (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL
	)`)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) PutRoom(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO rooms (id, created_at) VALUES (?, ?)`,
		id, time.Now().Unix())
	return err
}

func (s *Store) HasRoom(ctx context.Context, id string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM rooms WHERE id = ?`, id).Scan(&n)
	return n > 0, err
}

func (s *Store) DeleteRoom(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM rooms WHERE id = ?`, id)
	return err
}

// ExpiredRooms returns room IDs created before cutoff.
func (s *Store) ExpiredRooms(ctx context.Context, cutoff time.Time) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM rooms WHERE created_at <= ?`, cutoff.Unix())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
