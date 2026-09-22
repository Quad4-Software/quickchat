# AGENTS.md

quickchat is an ephemeral chat app: disposable rooms with LiveKit voice
and video, realtime chat and attachments over WebSocket. One Go binary
serves everything. License: 0BSD. Copyright Quad4 Software.

## Stack

- Go 1.27 backend: chi router, coder/websocket, livekit server-sdk-go
  for token minting, modernc.org/sqlite for room metadata
- React 19 + Vite 8 + TypeScript 6 (strict, exactOptionalPropertyTypes)
- Tailwind CSS 4 via @tailwindcss/vite, void theme tokens in web/src/app.css
- @livekit/components-react primitives (no components-styles, tiles are
  hand-styled), wouter for routing, lucide-react icons
- pnpm 11, pinned by packageManager. Install is hardened in
  web/pnpm-workspace.yaml: minimumReleaseAge 7 days, strictDepBuilds,
  blockExoticSubdeps

## Commands

    make build        # pnpm install + vite build + go build to bin/quickchat
    make dev          # go run the backend on :8080
    make test         # go tests + vitest
    make check        # gofmt, vet, eslint, prettier check, tsc
    pnpm -C web dev   # vite dev server, proxies /api and /ws to :8080
    pnpm -C web lhci  # lighthouse, needs CHROME_PATH on some systems
    docker build -t quickchat:local .
    docker compose up -d   # needs QUICKCHAT_DOMAIN, ACME_EMAIL, LIVEKIT_*

## Deploy

- Dockerfile: 3-stage (node pnpm web build, go build, distroless nonroot
  uid 65532). All base images pinned by digest. Healthcheck is the
  `quickchat healthcheck` subcommand, no shell needed.
- docker-compose.yml: app + traefik, read-only, cap_drop ALL, tmpfs /tmp.
- docker-compose.coolify.yml: single service, Coolify injects proxy
  labels. Set Domains to https://host:8080.
- Publishing lives in .github/workflows/docker.yml: ghcr push, zstd
  compression, cosign keyless sign, SBOM and OpenVEX attestations.

## Layout

    cmd/quickchat/       thin main
    internal/config/     env-only configuration
    internal/store/      sqlite room metadata
    internal/rooms/      room id generation and TTL sweep
    internal/hub/        websocket chat hub, JSON envelope protocol
    internal/attach/     TTL'd attachment blobs + json meta on disk
    internal/lktoken/    livekit access token minting
    internal/server/     chi routes, embedded SPA with fallback
    web/                 React app, embed.go exports web.Dist (embeds dist/)
    web/src/pages/       HomePage, RoomPage
    web/src/room/        Stage (livekit av), ChatPane (ws chat)

## Rules

- Ephemeral by default. Chat messages are in-memory only, never stored.
  Attachments expire with QUICKCHAT_ATTACHMENT_TTL (default 24h).
  Room rows expire with QUICKCHAT_ROOM_TTL (default 7d).
- Style with the void theme tokens (bg-background, text-foreground,
  bg-card, border-border, text-muted-foreground). Never raw colors in
  components. Space Grotesk for UI, Space Mono for ids and timestamps.
- The Quad4 mark lives in web/src/components/Mark.tsx and
  web/public/quad4-mark.svg. Use it, do not inline copies.
- New dependencies must be at least 7 days old (enforced by
  minimumReleaseAge). Pin exact versions.
- Plain ASCII prose: no em dashes, no emojis, no semicolons in prose,
  no curly quotes, no unicode arrows.
- Code comments are plain text, no backticks around identifiers.
- All GitHub Actions pinned to full SHAs with version comments. Every
  job starts with step-security/harden-runner, top-level permissions {}.
- index.html carries a static landing skeleton for instant FCP. Keep it
  in sync with web/src/pages/HomePage.tsx hero markup.
- pnpm build runs scripts/inline-css.mjs which inlines the css bundle
  into index.html to kill the render-blocking request.
