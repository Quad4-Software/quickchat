// SPDX-License-Identifier: 0BSD
package config

import (
	"os"
	"strconv"
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

func int64Env(key string, fallback int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(key), 10, 64); err == nil && v > 0 {
		return v
	}
	return fallback
}
