// SPDX-License-Identifier: 0BSD
package server

import (
	"bufio"
	"compress/gzip"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// securityHeaders sets privacy and hardening headers on every response.
// The CSP connect-src includes the configured LiveKit host so clients can
// reach signaling without opening ws/wss to arbitrary origins.
func securityHeaders(livekitURL string) func(http.Handler) http.Handler {
	connect := "'self'"
	if u, err := url.Parse(livekitURL); err == nil && u.Host != "" {
		scheme := "wss://"
		if u.Scheme == "ws" || u.Scheme == "http" {
			scheme = "ws://"
		}
		connect += " " + scheme + u.Host
	}
	csp := strings.Join([]string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src " + connect,
		"media-src 'self' blob: mediastream:",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; ")
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", csp)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Resource-Policy", "same-origin")
			next.ServeHTTP(w, r)
		})
	}
}

// cacheControl marks hashed vite assets immutable and everything else
// no-cache so index.html and api responses are never stale.
func cacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

var gzPool = sync.Pool{New: func() any { return gzip.NewWriter(nil) }}

func compressible(ct string) bool {
	switch {
	case strings.HasPrefix(ct, "text/"),
		strings.Contains(ct, "json"),
		strings.Contains(ct, "javascript"),
		strings.Contains(ct, "svg"),
		strings.Contains(ct, "wasm"):
		return true
	}
	return false
}

// gzipped compresses responses when the client accepts gzip and the
// content type benefits. Websocket upgrade requests are passed through.
func gzipped(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accept := r.Header.Get("Accept-Encoding")
		if strings.HasPrefix(r.URL.Path, "/ws/") ||
			!strings.Contains(accept, "gzip") ||
			r.Header.Get("Range") != "" {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipWriter{ResponseWriter: w}
		defer gw.Close()
		next.ServeHTTP(gw, r)
	})
}

type gzipWriter struct {
	http.ResponseWriter
	gz       *gzip.Writer
	decided  bool
	compress bool
}

func (w *gzipWriter) decide() {
	if w.decided {
		return
	}
	w.decided = true
	w.compress = compressible(w.Header().Get("Content-Type"))
	if !w.compress {
		return
	}
	w.Header().Del("Content-Length")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.gz = gzPool.Get().(*gzip.Writer)
	w.gz.Reset(w.ResponseWriter)
}

func (w *gzipWriter) WriteHeader(code int) {
	w.decide()
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipWriter) Write(b []byte) (int, error) {
	w.decide()
	if w.compress {
		return w.gz.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

func (w *gzipWriter) Close() {
	if w.gz != nil {
		_ = w.gz.Close()
		gzPool.Put(w.gz)
	}
}

// Unwrap exposes the underlying writer for http.ResponseController.
func (w *gzipWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *gzipWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hj.Hijack()
}

func (w *gzipWriter) Flush() {
	if w.gz != nil {
		_ = w.gz.Flush()
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
