// SPDX-License-Identifier: 0BSD
package server

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/json"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/Quad4-Software/quickchat/internal/config"
	"github.com/Quad4-Software/quickchat/internal/hub"
	"github.com/Quad4-Software/quickchat/internal/lktoken"
	"github.com/Quad4-Software/quickchat/internal/ratelimit"
	"github.com/Quad4-Software/quickchat/internal/rooms"
	"github.com/Quad4-Software/quickchat/web"
)

//go:embed openapi.yaml
var openapiSpec string

type Server struct {
	cfg    config.Config
	rooms  *rooms.Manager
	hub    *hub.Hub
	ping   func(ctx context.Context) error
	create *ratelimit.Limiter
	action *ratelimit.Limiter
	socket *ratelimit.Limiter
}

func New(cfg config.Config, rm *rooms.Manager, h *hub.Hub, ping func(ctx context.Context) error) *Server {
	return &Server{
		cfg:    cfg,
		rooms:  rm,
		hub:    h,
		ping:   ping,
		create: ratelimit.New(rate(cfg.RateCreatePerMin, 12), burst(rate(cfg.RateCreatePerMin, 12))),
		action: ratelimit.New(rate(cfg.RateActionPerMin, 60), burst(rate(cfg.RateActionPerMin, 60))),
		socket: ratelimit.New(rate(cfg.RateSocketPerMin, 30), burst(rate(cfg.RateSocketPerMin, 30))),
	}
}

// rate falls back to the default when unset or non-positive.
func rate(v, fallback int) int {
	if v <= 0 {
		return fallback
	}
	return v
}

// burst allows short spikes at half the per-minute rate.
func burst(perMin int) int {
	if perMin < 4 {
		return perMin
	}
	return perMin / 2
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(securityHeaders(s.cfg.LiveKitURL))
	r.Use(gzipped)
	r.Use(cacheControl)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/readyz", s.readyz)
	r.Get("/api/openapi.yaml", s.openapi)

	r.Route("/api", func(r chi.Router) {
		r.Post("/rooms", s.createRoom)
		r.Route("/rooms/{room}", func(r chi.Router) {
			r.Use(s.requireRoom)
			r.Get("/", s.getRoom)
			r.With(s.limited(s.action)).Get("/token", s.livekitToken)
		})
	})
	r.With(s.limited(s.socket)).Get("/ws/rooms/{room}", s.chatWS)

	r.Handle("/*", spaHandler())
	return r
}

// clientIP resolves the caller ip, honoring X-Forwarded-For only when the
// deployment is explicitly configured behind a trusted proxy.
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustedProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limited rejects requests that exceed the per-ip token bucket.
func (s *Server) limited(l *ratelimit.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow(s.clientIP(r)) {
				writeErr(w, http.StatusTooManyRequests, "rate limited")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func sanitizeName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "anon"
	}
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	if err := s.ping(r.Context()); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "store unavailable")
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Server) openapi(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeContent(w, r, "openapi.yaml", time.Time{},
		strings.NewReader(openapiSpec))
}

func (s *Server) requireRoom(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.rooms.Exists(r.Context(), chi.URLParam(r, "room")) {
			writeErr(w, http.StatusNotFound, "room not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	if !s.create.Allow(s.clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "rate limited")
		return
	}
	id, err := s.rooms.Create(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create room")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) getRoom(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "room")
	writeJSON(w, http.StatusOK, map[string]any{
		"id":          id,
		"peers":       s.hub.PeerCount(id),
		"livekit":     s.cfg.LiveKitURL != "",
		"iceServers":  s.cfg.ICEServers,
		"maxFileSize": s.cfg.MaxFileBytes,
	})
}

func (s *Server) livekitToken(w http.ResponseWriter, r *http.Request) {
	if s.cfg.LiveKitAPIKey == "" || s.cfg.LiveKitSecret == "" {
		writeErr(w, http.StatusServiceUnavailable, "livekit not configured")
		return
	}
	room := chi.URLParam(r, "room")
	name := sanitizeName(r.URL.Query().Get("name"))
	identity := name + "-" + randSuffix()
	tok, err := lktoken.Mint(s.cfg.LiveKitAPIKey, s.cfg.LiveKitSecret,
		room, identity, name, 2*time.Hour)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token mint failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"url":      s.cfg.LiveKitURL,
		"token":    tok,
		"identity": identity,
	})
}

func randSuffix() string {
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "x"
	}
	const a = "abcdefghijklmnopqrstuvwxyz234567"
	out := make([]byte, 5)
	for i := range out {
		out[i] = a[b[i%3]&31]
	}
	return string(out)
}

func (s *Server) chatWS(w http.ResponseWriter, r *http.Request) {
	room := chi.URLParam(r, "room")
	if !s.rooms.Exists(r.Context(), room) {
		writeErr(w, http.StatusNotFound, "room not found")
		return
	}
	name := sanitizeName(r.URL.Query().Get("name"))
	s.hub.ServeWS(w, r, room, name)
}

// spaHandler serves the embedded web build with a fallback to index.html
// for client-side routes.
func spaHandler() http.Handler {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(err)
	}
	// a checkout without a web build only contains .gitkeep; fail cleanly
	// instead of letting the file server render a directory listing
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, http.StatusServiceUnavailable, "frontend not built")
		})
	}
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if _, err := fs.Stat(dist, p); err != nil &&
			!strings.Contains(path.Base(p), ".") {
			r.URL.Path = "/"
		}
		files.ServeHTTP(w, r)
	})
}
