// SPDX-License-Identifier: 0BSD

// Desktop shell for quickchat. The window loads a quickchat server,
// the quad4 instance by default, and the embedded server runs on
// loopback so the app can also host rooms locally. The web frontend
// reaches this process through window._wails.invoke raw messages:
// qc:server:<url> persists the backend choice, qc:notify:<base64>
// raises a native notification.
package main

import (
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/url"
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
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

// defaultServer is the hosted quad4 instance the app connects to.
// The livekit host lk.quad4.io is configured server side and never
// reaches the client.
const defaultServer = "https://qc.quad4.io"

const serverFile = "server.txt"

//go:embed icon.png
var iconPNG []byte

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
	localURL := "http://" + ln.Addr().String()
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
		slog.Warn("LIVEKIT_URL not set, voice and video disabled for local rooms")
	}

	ns := notifications.New()

	app := application.New(application.Options{
		Name:        "quickchat",
		Description: "ephemeral p2p chat rooms",
		Icon:        iconPNG,
		Services:    []application.Service{application.NewService(ns)},
		// prgname ties the window to the shipped quickchat.desktop file
		// so launchers can group it and resolve the icon
		Linux: application.LinuxOptions{ProgramName: "quickchat"},
		RawMessageHandler: func(window application.Window, message string, origin *application.OriginInfo) {
			slog.Debug("bridge message", "origin", originURL(origin), "msg", message)
			handleBridge(window, message, ns, cfg.DataDir, localURL)
		},
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

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "quickchat",
		Width:     1280,
		Height:    800,
		MinWidth:  380,
		MinHeight: 540,
		URL:       resolveServer(cfg.DataDir, localURL),
		Permissions: map[application.PermissionType]application.Permission{
			application.PermissionMicrophone:    application.PermissionAllow,
			application.PermissionCamera:        application.PermissionAllow,
			application.PermissionNotifications: application.PermissionAllow,
		},
	})

	// tapping a notification focuses the room window
	ns.OnNotificationResponse(func(notifications.NotificationResult) {
		win.Focus()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// resolveServer picks the backend the window loads: env override,
// the persisted choice, or the hosted quad4 instance.
func resolveServer(dataDir, localURL string) string {
	if v := os.Getenv("QUICKCHAT_SERVER"); v != "" {
		return normalizeServer(v, localURL)
	}
	// #nosec G304 -- dataDir is the app config dir, not user input
	if b, err := os.ReadFile(filepath.Join(dataDir, serverFile)); err == nil {
		if s := strings.TrimSpace(string(b)); s != "" {
			return normalizeServer(s, localURL)
		}
	}
	return defaultServer
}

// normalizeServer accepts a host, url or the local keyword and maps it
// to the url the window should load.
func normalizeServer(s, localURL string) string {
	s = strings.TrimSpace(s)
	if s == "local" || s == "localhost" {
		return localURL
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	if u, err := url.Parse(s); err == nil && u.Host != "" {
		return strings.TrimRight(u.String(), "/")
	}
	return defaultServer
}

// originURL renders the origin attached to a raw message, useful for
// confirming the invoke channel on remote servers
func originURL(o *application.OriginInfo) string {
	if o == nil {
		return ""
	}
	return o.Origin
}

// handleBridge parses raw window._wails.invoke messages from the web
// frontend. The channel is how the page persists its server choice and
// raises os notifications on platforms lacking the Notification api.
func handleBridge(
	window application.Window,
	message string,
	ns *notifications.NotificationService,
	dataDir, localURL string,
) {
	switch {
	case strings.HasPrefix(message, "qc:server:"):
		raw, err := url.PathUnescape(strings.TrimPrefix(message, "qc:server:"))
		if err != nil {
			return
		}
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return
		}
		// persist the origin or the local keyword as entered
		stored := raw
		if raw != "local" && raw != "localhost" {
			stored = normalizeServer(raw, localURL)
		}
		if err := os.WriteFile(
			filepath.Join(dataDir, serverFile), []byte(stored+"\n"), 0o600); err != nil {
			slog.Warn("persist server", "err", err)
		}
		// the local keyword cannot navigate itself, the shell does it
		if raw == "local" || raw == "localhost" {
			window.SetURL(localURL)
		}
	case strings.HasPrefix(message, "qc:notify:"):
		raw, err := base64.StdEncoding.DecodeString(
			strings.TrimPrefix(message, "qc:notify:"))
		if err != nil {
			return
		}
		var payload struct {
			Title string `json:"t"`
			Body  string `json:"b"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil || payload.Title == "" {
			return
		}
		if err := ns.SendNotification(notifications.NotificationOptions{
			Title: payload.Title,
			Body:  payload.Body,
		}); err != nil {
			slog.Warn("notification", "err", err)
		}
	case message == "qc:hello":
		slog.Info("bridge channel up")
	}
}
