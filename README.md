# quickchat

Ephemeral chat rooms with LiveKit voice and video. One Go binary serves
the React web client, realtime chat and attachments over WebSocket, and
mints LiveKit access tokens. Room metadata persists in SQLite, chat
messages live in memory only, attachments expire on disk.

## Run

    docker compose up -d          # traefik + app, needs .env (see below)

or from source:

    make build                    # vite build + go build to bin/quickchat
    LIVEKIT_URL=wss://livekit.example.com \
    LIVEKIT_API_KEY=devkey \
    LIVEKIT_API_SECRET=secret \
    ./bin/quickchat

Open http://localhost:8080.

## Configuration

Env only. Defaults shown:

    QUICKCHAT_ADDR=:8080            listen address
    QUICKCHAT_DATA=./data           sqlite + attachment storage
    QUICKCHAT_ROOM_TTL=168h         room expiry (7d)
    QUICKCHAT_ATTACHMENT_TTL=24h    attachment expiry
    QUICKCHAT_MAX_UPLOAD=67108864   upload limit (64 MiB)
    QUICKCHAT_PPROF=                pprof listen address, off when empty
    LIVEKIT_URL=                    wss:// endpoint for the client
    LIVEKIT_API_KEY=
    LIVEKIT_API_SECRET=

Without the LIVEKIT_* variables the app still runs, voice and video are
disabled and the room page falls back to chat only.

## Deploy

- `docker-compose.yml`: app plus Traefik with ACME. Set `QUICKCHAT_DOMAIN`
  and `ACME_EMAIL` in `.env` alongside the LiveKit variables.
- `docker-compose.coolify.yml`: single service for Coolify's docker
  compose build pack. Set the Domains field to `https://host:8080`.
- Published images land at `ghcr.io/quad4-software/quickchat`, signed
  keyless with cosign and attested with SBOM and provenance.

## Develop

    make dev          # backend on :8080
    pnpm -C web dev   # vite dev server, proxies /api and /ws
    make test         # go tests + vitest
    make check        # gofmt, vet, eslint, prettier, tsc
    pnpm -C web lhci  # lighthouse, gates at 100

License: 0BSD.
