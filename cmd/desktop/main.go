// SPDX-License-Identifier: 0BSD

// Desktop shell for quickchat. The full chat server runs in-process on
// a loopback port and a wails window loads it, so the app is a portable
// room host with the same ui, signaling, and livekit wiring as the web
// deployment. Set LIVEKIT_* to enable media and QUICKCHAT_ADDR to
// expose the hosted rooms to the lan.
package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Quad4-Software/quickchat/internal/config"
	"github.com/Quad4-Software/quickchat/internal/hub"
	"github.com/Quad4-Software/quickchat/internal/rooms"
	"github.com/Quad4-Software/quickchat/internal/server"
	"github.com/Quad4-Software/quickchat/internal/store"
	"github.com/Quad4-Software/quickchat/internal/version"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func main() {
	cfg := config.Load()
	if os.Getenv("QUICKCHAT_ADDR") == "" {
		// loopback ephemeral port: the webview is the only client
		cfg.Addr = "127.0.0.1:0"
	}
	if os.Getenv("QUICKCHAT_DATA") == "" {
		// rooms belong in a per-user writable dir, not next to the
		// executable
		base, err := os.UserConfigDir()
		if err != nil {
			base = os.TempDir()
		}
		cfg.DataDir = filepath.Join(base, "quickchat")
	}
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		log.Fatal(err)
	}

	st, err := store.Open(filepath.Join(cfg.DataDir, "quickchat.db"))
	if err != nil {
		log.Fatal(err)
	}
	rm := rooms.NewManager(st, cfg.RoomTTL)
	h := hub.New()
	srv := server.New(cfg, rm, h, st.Ping)

	ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", cfg.Addr)
	if err != nil {
		log.Fatal(err)
	}
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http server", "err", err)
		}
	}()
	if cfg.LiveKitURL == "" {
		slog.Warn("LIVEKIT_URL not set, voice and video disabled")
	}

	app := application.New(application.Options{
		Name:        "quickchat",
		Description: "ephemeral p2p chat rooms",
		OnShutdown: func() {
			h.CloseAll()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := httpSrv.Shutdown(ctx); err != nil {
				slog.Warn("shutdown", "err", err)
			}
			if err := st.Close(); err != nil {
				slog.Warn("store close", "err", err)
			}
		},
	})

	// in-app updates pull platform assets from the repo's github
	// releases; skipped for local dev builds and when explicitly
	// disabled
	if version.Version != "dev" && os.Getenv("QUICKCHAT_NO_UPDATER") == "" {
		gh, err := github.New(github.Config{
			Repository:    "Quad4-Software/quickchat",
			ChecksumAsset: "checksums.txt",
			// the release also ships server binaries whose platform
			// tags would match the default matcher, so only the
			// desktop archives are in scope
			AssetMatcher: func(req updater.CheckRequest, assets []github.ReleaseAsset) int {
				for i, a := range assets {
					if strings.Contains(strings.ToLower(a.Name), "desktop") &&
						github.DefaultAssetMatcher(req, []github.ReleaseAsset{a}) == 0 {
						return i
					}
				}
				return -1
			},
		})
		if err != nil {
			slog.Warn("updater disabled", "err", err)
		} else if err := app.Updater.Init(updater.Config{
			CurrentVersion: strings.TrimPrefix(version.Version, "v"),
			Providers:      []updater.Provider{gh},
			CheckInterval:  6 * time.Hour,
		}); err != nil {
			slog.Warn("updater init", "err", err)
		}
	}

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "quickchat",
		Width:     1280,
		Height:    800,
		MinWidth:  380,
		MinHeight: 540,
		URL:       "http://" + ln.Addr().String(),
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
