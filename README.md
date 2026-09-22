# quickchat

Ephemeral chat rooms with LiveKit voice and video. One Go binary serves
the web client, realtime chat and attachments over WebSocket, and mints
LiveKit access tokens. Room metadata persists in SQLite, messages and
attachments do not.

## Install

    make all        # pnpm install + vite build + go build to bin/quickchat

## Usage

    LIVEKIT_URL=wss://livekit.example.com \
    LIVEKIT_API_KEY=devkey \
    LIVEKIT_API_SECRET=secret \
    ./bin/quickchat

Configuration is env only. See internal/config/config.go for the full
list: QUICKCHAT_ADDR (default :8080), QUICKCHAT_DATA (default ./data).

In development, run the Go server and `pnpm -C web dev` for the Vite
dev server with API and WebSocket proxying.

License: 0BSD.
