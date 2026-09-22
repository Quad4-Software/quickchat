all: build

build: web
	go build -o bin/quickchat ./cmd/quickchat

web:
	pnpm -C web install
	pnpm -C web build

dev:
	go run ./cmd/quickchat

test:
	go test ./...
	pnpm -C web test

check:
	test -z "$$(gofmt -l .)"
	go vet ./...
	pnpm -C web lint
	pnpm -C web format:check
	pnpm -C web typecheck

lint:
	pnpm -C web lint

format:
	gofmt -w .
	pnpm -C web format

docker:
	docker build -t quickchat:local .

up:
	docker compose up -d

down:
	docker compose down

clean:
	rm -rf bin web/dist web/.lighthouseci

.PHONY: all build web dev test check lint format docker up down clean
