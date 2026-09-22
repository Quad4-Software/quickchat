# AGENTS.md

quickchat is an ephemeral chat app: disposable rooms with LiveKit voice
and video, plus chat and file transfer that go peer to peer over WebRTC
data channels. The server handles room metadata, presence and signaling
only. One Go binary serves everything. License: 0BSD. Copyright Quad4
Software.

## Stack

- Go 1.27 backend: chi router, coder/websocket for presence+signaling,
  livekit server-sdk-go for token minting, modernc.org/sqlite for room
  metadata, openapi.yaml embedded and served at /api/openapi.yaml
- React 19 + Vite 8 + TypeScript 6 (strict, exactOptionalPropertyTypes)
- Tailwind CSS 4 via @tailwindcss/vite, void theme tokens in web/src/app.css
- @livekit/components-react primitives (no components-styles, tiles are
  hand-styled), wouter for routing, lucide-react icons
- @scalar/api-reference-react for /docs, vite-plugin-pwa + workbox for
  the service worker and manifest
- pnpm 12, pinned by packageManager. Install is hardened in
  web/pnpm-workspace.yaml: minimumReleaseAge 7 days, strictDepBuilds,
  blockExoticSubdeps

## Commands

    make build        # pnpm install + vite build + go build to bin/quickchat
    make dev          # go run the backend on :8080
    make test         # go tests incl race + vitest
    make test-e2e     # playwright + axe, builds web then runs the go binary
    make check        # gofmt, vet, golangci-lint, eslint, prettier, tsc
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
- Releases: .goreleaser.yaml builds the six platform archives on v* tags.
  Its before hooks run the web build so dist/ is embedded. The release
  workflow adds SLSA3 provenance via the generic generator, cosign
  sign-blob on checksums.txt, and actions/attest-build-provenance.

## Layout

    cmd/quickchat/       thin main
    internal/config/     env-only configuration
    internal/store/      sqlite room metadata
    internal/rooms/      room id generation and TTL sweep
    internal/hub/        websocket presence + webrtc signaling relay
    internal/lktoken/    livekit access token minting
    internal/server/     chi routes, embedded SPA, openapi.yaml
    web/                 React app, embed.go exports web.Dist (embeds dist/)
    web/src/pages/       HomePage, RoomPage, DemoPage, DocsPage (scalar, lazy)
    web/src/room/        Stage (livekit av), DemoStage, ChatPane, MessageRow,
                         DebugPanel (rtc stats overlay)
    web/src/lib/signal.ts   ws client: presence + signal relay only
    web/src/lib/mesh.ts     webrtc datachannel mesh: chat, typing, files
    web/src/lib/stats.ts    debug panel collector registry + hooks
    web/src/lib/StatsProvider.tsx  stats registry provider component
    web/src/lib/pwa.ts      service worker registration + update flow
    web/src/lib/e2ee.ts  url-fragment media keys + e2ee support check
    web/e2e/             playwright + axe specs against the real binary,
                         live.test.ts needs LIVEKIT_* env to run

## Wire protocol

- ws frames (server): welcome {self, peers}, peer_joined, peer_left,
  signal {from, data}
- ws frames (client): signal {to, data} where data is sdp or ice
- 'chat' datachannel (json): {t:chat, id, body?, file?, ts},
  {t:typing, on}
- 'file-<id>' datachannel: first frame json header {id,msgId,name,size,
  mime}, then binary chunks, sender closes for eof
- Glare is resolved by perfect negotiation: the peer with the
  lexicographically larger id is polite

## Rules

- Ephemeral by default. Chat and files are peer to peer and in-memory
  only, never persisted or relayed by the server. Room rows expire with
  QUICKCHAT_ROOM_TTL (default 7d). The websocket carries presence and
  signaling only, never message content.
- Style with the void theme tokens (bg-background, text-foreground,
  bg-card, border-border, text-muted-foreground). Never raw colors in
  components. Space Grotesk for UI, Space Mono for ids and timestamps.
- The Quad4 mark ships as web/public/quad4-mark.svg and renders through
  a css mask in web/src/components/Mark.tsx. Do not inline svg markup.
  UI icons come from lucide-react.
- New dependencies must be at least 7 days old (enforced by
  minimumReleaseAge). Pin exact versions.
- Plain ASCII prose: no em dashes, no emojis, no semicolons in prose,
  no curly quotes, no unicode arrows.
- Code comments are plain text, no backticks around identifiers.
- All GitHub Actions pinned to full SHAs with version comments. Every
  job starts with step-security/harden-runner, top-level permissions {}.
- index.html carries a static landing skeleton for instant FCP. Keep it
  in sync with web/src/pages/HomePage.tsx hero markup.
- pnpm build runs scripts/clean-dist.mjs first (keeps dist/.gitkeep for
  go:embed), then vite build, then scripts/inline-css.mjs which inlines
  the css bundle into index.html to kill the render-blocking request.
- The vite test config excludes web/e2e so vitest never picks up
  playwright specs. e2e raises QUICKCHAT_RATE_* limits and lowers
  QUICKCHAT_MAX_FILE via env so the suite exercises limits without
  throttling.
- The scalar docs chunk is split out as docs-*.js and excluded from the
  service worker precache since it needs the live spec anyway.
- The demo build (VITE_DEMO=1, VITE_BASE) is the gh pages bundle: hash
  routing, no service worker, a copy of openapi.yaml written into dist
  for /docs, and DemoMesh + DemoStage scripted peers instead of a server.
- Asset urls that ship in runtime js (css masks, the docs spec url) must
  use import.meta.env.BASE_URL so they resolve under a pages subpath.
- #root is locked to 100dvh with document overflow hidden; every region
  scrolls internally, never the page. Keep room panels min-h-0.
- Playwright runs four projects: chromium desktop+mobile, firefox,
  webkit. live.test.ts activates only when LIVEKIT_URL is set. WebKit
  headless cannot resolve its own mdns ice candidates, so p2p mesh specs
  skip there; media e2ee is unsupported in webkit and must degrade to
  dtls-srtp with a visible warning.
- Remote participant volume lives in Stage via webAudioMix gain nodes
  (boost above 100 percent) and persists in localStorage qc-volumes.
- DebugPanel polls registered stats collectors every 2s while open; do
  not run getStats or other polling when the panel is closed.
