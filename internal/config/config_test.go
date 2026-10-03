// SPDX-License-Identifier: 0BSD

package config

import "testing"

func TestDefaultICEServersCarryStun(t *testing.T) {
	cfg := Load()
	if len(cfg.ICEServers) == 0 {
		t.Fatal("default ice servers empty, p2p cannot cross nats")
	}
	for _, u := range cfg.ICEServers {
		if u[:5] != "stun:" && u[:5] != "turn:" {
			t.Fatalf("unexpected ice url %q", u)
		}
	}
}

func TestICEServersEnvOverride(t *testing.T) {
	t.Setenv("QUICKCHAT_ICE_SERVERS", "turn:turn.example.com:3478")
	cfg := Load()
	if len(cfg.ICEServers) != 1 || cfg.ICEServers[0] != "turn:turn.example.com:3478" {
		t.Fatalf("env override ignored: %v", cfg.ICEServers)
	}
}
