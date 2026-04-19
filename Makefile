.PHONY: up down migrate generate build-agent

up:
	docker compose up -d

down:
	docker compose down

migrate:
	cd internal && go run github.com/pressly/goose/v3/cmd/goose@latest -dir ../sql/migrations postgres "$(DATABASE_URL)" up

generate:
	pnpm turbo generate

build-agent:
	cd apps/agent && \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o bin/agent-linux-amd64 . && \
		CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o bin/agent-linux-arm64 .
