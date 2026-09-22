# syntax=docker/dockerfile:1

# Web build: pnpm is pinned by the packageManager field via corepack.
FROM docker.io/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS web
ENV CI=true
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./web/
RUN pnpm -C web fetch
COPY web/ ./web/
RUN pnpm -C web install --prefer-offline --frozen-lockfile \
  && pnpm -C web build \
  && rm -rf web/node_modules

# Go build: pure Go (modernc sqlite), static binary, no cgo.
FROM docker.io/library/golang:1.27-alpine@sha256:8a5910f31396cd4d89662f56c68b3ae31d374308270a1c3bd96672ee5ed43414 AS build
ENV GOTOOLCHAIN=local GOFLAGS=-buildvcs=false CGO_ENABLED=0
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /app/web/dist ./web/dist
ARG VERSION=dev
ARG REVISION=unknown
RUN go build -trimpath \
    -ldflags="-s -w \
      -X quad4/quickchat/internal/version.Version=${VERSION} \
      -X quad4/quickchat/internal/version.Commit=${REVISION}" \
    -o /out/quickchat ./cmd/quickchat \
  && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
ARG SOURCE=https://github.com/Quad4-Software/quickchat
LABEL org.opencontainers.image.title="quickchat" \
      org.opencontainers.image.description="Ephemeral chat rooms with LiveKit voice and video" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.url="${SOURCE}" \
      org.opencontainers.image.documentation="${SOURCE}" \
      org.opencontainers.image.vendor="Quad4 Software" \
      org.opencontainers.image.licenses="0BSD" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.base.name="gcr.io/distroless/static-debian12:nonroot"
COPY --from=build /out/quickchat /quickchat
# /data must be owned by the runtime uid so the named volume inherits it
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV QUICKCHAT_ADDR=:8080 \
    QUICKCHAT_DATA=/data
EXPOSE 8080
ENTRYPOINT ["/quickchat"]
