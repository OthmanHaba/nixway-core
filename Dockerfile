# syntax=docker/dockerfile:1.7

FROM golang:1.25-alpine AS go-base
RUN apk add --no-cache ca-certificates git
WORKDIR /src
COPY go.work go.work.sum ./
COPY internal/go.mod internal/go.sum internal/
COPY apps/api/go.mod apps/api/go.sum apps/api/
COPY apps/worker/go.mod apps/worker/go.sum apps/worker/
COPY apps/agent/go.mod apps/agent/go.sum apps/agent/
COPY apps/cli/go.mod apps/cli/go.sum apps/cli/
COPY tests/go.mod tests/go.sum tests/
RUN --mount=type=cache,target=/go/pkg/mod \
    for module in internal apps/api apps/worker apps/agent apps/cli tests; do \
      (cd "$module" && go mod download); \
    done

FROM go-base AS go-source
COPY . .
ARG TARGETOS=linux
ARG TARGETARCH=amd64

FROM go-source AS api-builder
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags='-s -w' -o /out/api ./apps/api

FROM go-source AS worker-builder
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags='-s -w' -o /out/worker ./apps/worker

FROM go-source AS agent-builder
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o /out/agent/agent-linux-amd64 ./apps/agent
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o /out/agent/agent-linux-arm64 ./apps/agent

FROM go-base AS goose-builder
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go install github.com/pressly/goose/v3/cmd/goose@latest

FROM alpine:3.22 AS api
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=api-builder /out/api /app/api
COPY --from=agent-builder /out/agent /app/agent/bin
ENV NIXWAY_ROOT=/app \
    NIXWAY_SERVER_AGENT_BINARY_DIR=/app/agent/bin
EXPOSE 8080 9090
ENTRYPOINT ["/app/api"]

FROM alpine:3.22 AS worker
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=worker-builder /out/worker /app/worker
ENV NIXWAY_ROOT=/app
ENTRYPOINT ["/app/worker"]

FROM alpine:3.22 AS migrate
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=goose-builder /go/bin/goose /usr/local/bin/goose
COPY sql/migrations /migrations
ENTRYPOINT ["sh", "-c", "goose -dir /migrations postgres \"$NIXWAY_DATABASE_URL\" up"]
