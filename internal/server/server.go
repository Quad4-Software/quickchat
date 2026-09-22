// SPDX-License-Identifier: 0BSD
package server

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"quad4/quickchat/internal/attach"
	"quad4/quickchat/internal/config"
	"quad4/quickchat/internal/hub"
	"quad4/quickchat/internal/lktoken"
	"quad4/quickchat/internal/ratelimit"
	"quad4/quickchat/internal/rooms"
	"quad4/quickchat/web"
)

type Server struct {
	cfg    config.Config
	rooms  *rooms.Manager
	hub    *hub.Hub
	atts   *attach.Store
	ping   func(ctx context.Context) error
	create *ratelimit.Limiter
	action *ratelimit.Limiter
	socket *ratelimit.Limiter
}

func New(cfg config.Config, rm *rooms.Manager, h *hub.Hub, atts *attach.Store, ping func(ctx context.Context) error) *Server {
	return &Server{
		cfg:    cfg,
		rooms:  rm,
		hub:    h,
		atts:   atts,
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

	r.Route("/api", func(r chi.Router) {
		r.Post("/rooms", s.createRoom)
		r.Route("/rooms/{room}", func(r chi.Router) {
			r.Use(s.requireRoom)
			r.Get("/", s.getRoom)
			r.With(s.limited(s.action)).Get("/token", s.livekitToken)
			r.With(s.limited(s.action)).Post("/attachments", s.upload)
			r.Get("/attachments/{att}", s.download)
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
		"id":      id,
		"peers":   s.hub.PeerCount(id),
		"livekit": s.cfg.LiveKitURL != "",
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

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	room := chi.URLParam(r, "room")
	name := sanitizeName(r.URL.Query().Get("name"))
	mime := r.Header.Get("Content-Type")
	if mime == "application/octet-stream" {
		mime = ""
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+1)
	m, err := s.atts.Save(room, name, mime, r.Body)
	if errors.Is(err, attach.ErrTooLarge) {
		writeErr(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}
	if errors.Is(err, attach.ErrInvalid) {
		writeErr(w, http.StatusBadRequest, "invalid room")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "upload failed")
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	m, err := s.atts.Get(chi.URLParam(r, "room"), chi.URLParam(r, "att"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "attachment not found")
		return
	}
	w.Header().Set("Content-Type", m.Mime)
	// attachment disposition prevents uploaded html/svg from executing
	// on the app origin. img previews still work since disposition is
	// ignored for subresource loads.
	w.Header().Set("Content-Disposition",
		`attachment; filename="`+strings.NewReplacer(`"`, "", "\r", "", "\n", "").Replace(m.Name)+`"`)
	w.Header().Set("Content-Security-Policy", "sandbox")
	// #nosec G703 -- room and id were validated in Get before meta loads
	http.ServeFile(w, r, s.atts.BlobPath(m))
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
