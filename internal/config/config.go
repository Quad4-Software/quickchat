// SPDX-License-Identifier: 0BSD
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr           string
	DataDir        string
	LiveKitURL     string
	LiveKitAPIKey  string
	LiveKitSecret  string
	PprofAddr      string
	RoomTTL        time.Duration
	AttachmentTTL  time.Duration
	MaxUploadBytes int64
	TrustedProxy   bool

	// per-ip token buckets, requests per minute. Burst is half the rate.
	RateCreatePerMin int
	RateActionPerMin int
	RateSocketPerMin int
}

func Load() Config {
	return Config{
		Addr:           env("QUICKCHAT_ADDR", ":8080"),
		DataDir:        env("QUICKCHAT_DATA", "./data"),
		LiveKitURL:     os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey:  os.Getenv("LIVEKIT_API_KEY"),
		LiveKitSecret:  os.Getenv("LIVEKIT_API_SECRET"),
		PprofAddr:      os.Getenv("QUICKCHAT_PPROF"),
		RoomTTL:        durEnv("QUICKCHAT_ROOM_TTL", 7*24*time.Hour),
		AttachmentTTL:  durEnv("QUICKCHAT_ATTACHMENT_TTL", 24*time.Hour),
		MaxUploadBytes: int64Env("QUICKCHAT_MAX_UPLOAD", 64<<20),
		TrustedProxy:   boolEnv("QUICKCHAT_TRUSTED_PROXY"),

		RateCreatePerMin: intEnv("QUICKCHAT_RATE_CREATE", 12),
		RateActionPerMin: intEnv("QUICKCHAT_RATE_ACTION", 60),
		RateSocketPerMin: intEnv("QUICKCHAT_RATE_SOCKET", 30),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func durEnv(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return fallback
}

func int64Env(key string, fallback int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(key), 10, 64); err == nil && v > 0 {
		return v
	}
	return fallback
}

func boolEnv(key string) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
