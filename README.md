# quickchat

Disposable chat rooms with LiveKit voice and video. Chat and files go
peer to peer over WebRTC data channels. The server only keeps room ids,
presence and signaling.

## Run

    docker compose up -d

Needs a `.env`:

    QUICKCHAT_DOMAIN=chat.example.com
    ACME_EMAIL=you@example.com
    LIVEKIT_API_KEY=devkey
    LIVEKIT_API_SECRET=at-least-32-characters-long-secret

Open 7881/tcp and 7882/udp for LiveKit media, plus 80/443 for the proxy.

From source:

    make build
    LIVEKIT_URL=wss://livekit.example.com \
    LIVEKIT_API_KEY=devkey \
    LIVEKIT_API_SECRET=secret \
    ./bin/quickchat

Open http://localhost:8080. API docs are at /docs. Without the LIVEKIT_*
variables the app runs as chat only.

For Coolify use `docker-compose.coolify.yml` and assign a domain to the
app service only; LiveKit signaling shares it through the built-in
proxy.

## Desktop

Prebuilt desktop apps for Windows and Linux are on the releases page.
They open https://qc.quad4.io by default. On Linux they need GTK4 and
WebKitGTK 6.0.

## Configuration

Environment variables, defaults shown:

    QUICKCHAT_ADDR=:8080            listen address
    QUICKCHAT_DATA=./data           sqlite room metadata
    QUICKCHAT_ROOM_TTL=168h         room expiry
    QUICKCHAT_MAX_FILE=67108864     file transfer limit in bytes
    QUICKCHAT_ICE_SERVERS=          comma separated stun/turn urls
    QUICKCHAT_RATE_CREATE=12        room creates per minute per ip
    QUICKCHAT_RATE_ACTION=60        token mints per minute per ip
    QUICKCHAT_RATE_SOCKET=30        ws connects per minute per ip
    QUICKCHAT_PPROF=                pprof listen address, off when empty
    QUICKCHAT_TRUSTED_PROXY=        trust X-Forwarded-For
    LIVEKIT_URL=                    wss:// endpoint for the client
    LIVEKIT_INTERNAL_URL=           proxy livekit signaling at /rtc to
                                    this upstream instead, and advertise
                                    this server's own origin to clients
    LIVEKIT_API_KEY=
    LIVEKIT_API_SECRET=

Public STUN servers are used by default. Setting QUICKCHAT_ICE_SERVERS
replaces them, so list STUN and any TURN server for strict NATs.

## Develop

    make dev          # backend on :8080
    pnpm -C web dev   # vite dev server
    make test
    make test-e2e
    make check

License: 0BSD.
