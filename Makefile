.PHONY: up down deploy migrate generate build-agent lab-up lab-bootstrap lab-info lab-status lab-registry lab-down lab-destroy

up:
	docker compose up -d

down:
	docker compose down

deploy:
	scripts/deploy

migrate:
	cd internal && go run github.com/pressly/goose/v3/cmd/goose@latest -dir ../sql/migrations postgres "$(DATABASE_URL)" up

generate:
	pnpm turbo generate

build-agent:
	cd apps/agent && \
		CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o bin/agent-linux-amd64 . && \
		CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o bin/agent-linux-arm64 .

lab-up:
	scripts/lab up

lab-bootstrap:
	scripts/lab bootstrap

lab-info:
	scripts/lab info

lab-status:
	scripts/lab status

lab-registry:
	scripts/lab registry

lab-down:
	scripts/lab down

lab-destroy:
	scripts/lab destroy
