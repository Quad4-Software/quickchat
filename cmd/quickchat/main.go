// SPDX-License-Identifier: 0BSD
package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"quad4/quickchat/internal/attach"
	"quad4/quickchat/internal/config"
	"quad4/quickchat/internal/hub"
	"quad4/quickchat/internal/rooms"
	"quad4/quickchat/internal/server"
	"quad4/quickchat/internal/store"
)

func main() {
	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		log.Fatal(err)
	}

	st, err := store.Open(filepath.Join(cfg.DataDir, "quickchat.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer st.Close()

	atts, err := attach.New(filepath.Join(cfg.DataDir, "attachments"),
		cfg.AttachmentTTL, cfg.MaxUploadBytes)
	if err != nil {
		log.Fatal(err)
	}

	rm := rooms.NewManager(st, cfg.RoomTTL)
	h := hub.New(func(room, id string) *hub.Attachment {
		m, err := atts.Get(room, id)
		if err != nil {
			return nil
		}
		return &hub.Attachment{ID: m.ID, Name: m.Name, Size: m.Size, Mime: m.Mime}
	})

	go func() {
		for range time.Tick(15 * time.Minute) {
			rm.Sweep()
			atts.Sweep()
		}
	}()

	srv := server.New(cfg, rm, h, atts)
	log.Printf("quickchat listening on %s", cfg.Addr)
	if cfg.LiveKitURL == "" {
		log.Printf("warning: LIVEKIT_URL not set, voice and video disabled")
	}
	log.Fatal(http.ListenAndServe(cfg.Addr, srv.Handler()))
}
