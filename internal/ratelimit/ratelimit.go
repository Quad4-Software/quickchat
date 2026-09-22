// SPDX-License-Identifier: 0BSD

// Package ratelimit provides a small per-key token bucket for abuse
// prevention on the public endpoints.
package ratelimit

import (
	"sync"
	"time"
)

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is a per-key token bucket. Keys are usually client IPs.
type Limiter struct {
	mu      sync.Mutex
	rate    float64 // tokens per second
	burst   float64
	buckets map[string]*bucket
	sweepAt time.Time
}

// New returns a Limiter allowing perMinute tokens per minute with the
// given burst capacity.
func New(perMinute, burst int) *Limiter {
	return &Limiter{
		rate:    float64(perMinute) / 60,
		burst:   float64(burst),
		buckets: make(map[string]*bucket),
	}
}

// Allow reports whether the key may proceed right now.
func (l *Limiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	// Bound memory: sweep idle buckets at most once a minute.
	if now.After(l.sweepAt) {
		l.sweepAt = now.Add(time.Minute)
		for k, b := range l.buckets {
			if now.Sub(b.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
	}

	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
