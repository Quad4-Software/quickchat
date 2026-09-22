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
	pnpm -C web typecheck

clean:
	rm -rf bin web/dist

.PHONY: all build web dev test clean
