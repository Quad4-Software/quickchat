// SPDX-License-Identifier: 0BSD
package lktoken

import (
	"time"

	"github.com/livekit/protocol/auth"
)

func Mint(apiKey, secret, room, identity, name string, ttl time.Duration) (string, error) {
	at := auth.NewAccessToken(apiKey, secret)
	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         room,
		CanPublish:   boolp(true),
		CanSubscribe: boolp(true),
	}
	at.SetVideoGrant(grant).
		SetIdentity(identity).
		SetName(name).
		SetValidFor(ttl)
	return at.ToJWT()
}

func boolp(b bool) *bool { return &b }
