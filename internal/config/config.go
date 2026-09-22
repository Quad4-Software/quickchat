// SPDX-License-Identifier: 0BSD
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr          string
	DataDir       string
	LiveKitURL    string
	LiveKitAPIKey string
	LiveKitSecret string
	PprofAddr     string
	RoomTTL       time.Duration
	TrustedProxy  bool

	// ICEServers are advertised to clients for the p2p mesh. Empty means
	// host candidates only, which covers lan and overlay networks. Add
	// stun: or turn: urls for nat traversal across the open internet.
	ICEServers []string
	// MaxFileBytes caps peer-to-peer file transfers. Files live in memory
	// at both ends so this also bounds memory per transfer.
	MaxFileBytes int64

	// per-ip token buckets, requests per minute. Burst is half the rate.
	RateCreatePerMin int
	RateActionPerMin int
	RateSocketPerMin int
}

func Load() Config {
	return Config{
		Addr:          env("QUICKCHAT_ADDR", ":8080"),
		DataDir:       env("QUICKCHAT_DATA", "./data"),
		LiveKitURL:    os.Getenv("LIVEKIT_URL"),
		LiveKitAPIKey: os.Getenv("LIVEKIT_API_KEY"),
		LiveKitSecret: os.Getenv("LIVEKIT_API_SECRET"),
		PprofAddr:     os.Getenv("QUICKCHAT_PPROF"),
		RoomTTL:       durEnv("QUICKCHAT_ROOM_TTL", 7*24*time.Hour),
		TrustedProxy:  boolEnv("QUICKCHAT_TRUSTED_PROXY"),

		ICEServers:   listEnv("QUICKCHAT_ICE_SERVERS"),
		MaxFileBytes: int64Env("QUICKCHAT_MAX_FILE", 64<<20),

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

func listEnv(key string) []string {
	out := []string{}
	for _, v := range strings.Split(os.Getenv(key), ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
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
