// SPDX-License-Identifier: 0BSD
package main

import (
	"context"
	"errors"
	"log"
	"log/slog"
	"net"
	"net/http"
	_ "net/http/pprof" // #nosec G108 -- only reachable on the opt-in pprof listener
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"quad4/quickchat/internal/config"
	"quad4/quickchat/internal/hub"
	"quad4/quickchat/internal/rooms"
	"quad4/quickchat/internal/server"
	"quad4/quickchat/internal/store"
	"quad4/quickchat/internal/version"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		log.Fatal(err)
	}

	st, err := store.Open(filepath.Join(cfg.DataDir, "quickchat.db"))
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if cerr := st.Close(); cerr != nil {
			slog.Warn("store close", "err", cerr)
		}
	}()

	rm := rooms.NewManager(st, cfg.RoomTTL)
	h := hub.New()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		tick := time.NewTicker(15 * time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				rm.Sweep(ctx)
			}
		}
	}()

	if cfg.PprofAddr != "" {
		go func() {
			slog.Info("pprof listening", "addr", cfg.PprofAddr)
			s := &http.Server{
				Addr:              cfg.PprofAddr,
				Handler:           http.DefaultServeMux,
				ReadHeaderTimeout: 10 * time.Second,
			}
			log.Print(s.ListenAndServe())
		}()
	}

	srv := server.New(cfg, rm, h, st.Ping)
	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		slog.Info("listening", "version", version.Version,
			"commit", version.Commit, "addr", cfg.Addr)
		if cfg.LiveKitURL == "" {
			slog.Warn("LIVEKIT_URL not set, voice and video disabled")
		}
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down")
	h.CloseAll()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Fatal(err)
	}
}

// healthcheck probes the running server. Used as the container HEALTHCHECK
// so no shell or curl is needed in the image.
func healthcheck() int {
	cfg := config.Load()
	_, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		port = strings.TrimPrefix(cfg.Addr, ":")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"http://127.0.0.1:"+port+"/healthz", nil)
	if err != nil {
		return 1
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 1
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
