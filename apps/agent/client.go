package main

import (
	"context"
	"log/slog"
	"math"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	minBackoff = 1 * time.Second
	maxBackoff = 30 * time.Second
)

type Client struct {
	serverAddr string
	agentID    string
	logger     *slog.Logger
	conn       *grpc.ClientConn
	svc        agentv1.AgentServiceClient
}

func NewClient(serverAddr, agentID string, logger *slog.Logger) *Client {
	return &Client{serverAddr: serverAddr, agentID: agentID, logger: logger}
}

// connect establishes the gRPC connection (no retry — caller handles retry).
func (c *Client) connect() error {
	conn, err := grpc.NewClient(c.serverAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	c.conn = conn
	c.svc = agentv1.NewAgentServiceClient(conn)
	return nil
}

// Close tears down the underlying gRPC connection.
func (c *Client) Close() {
	if c.conn != nil {
		c.conn.Close()
	}
}

// ConnectWithRetry dials the server and opens the bidirectional Connect stream,
// retrying with exponential backoff (1s → 2s → … → 30s) on any failure.
// It returns the stream once established, or a context error if ctx is cancelled.
func (c *Client) ConnectWithRetry(ctx context.Context) (agentv1.AgentService_ConnectClient, error) {
	attempt := 0
	for {
		if err := c.connect(); err != nil {
			c.logger.Warn("grpc dial failed", "err", err, "attempt", attempt)
		} else {
			stream, err := c.svc.Connect(ctx)
			if err == nil {
				c.logger.Info("connected to control plane", "server", c.serverAddr)
				return stream, nil
			}
			c.logger.Warn("connect stream failed", "err", err, "attempt", attempt)
			c.conn.Close()
		}

		backoff := backoffDuration(attempt)
		attempt++
		c.logger.Info("retrying", "in", backoff)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
	}
}

// backoffDuration returns exponential backoff capped at maxBackoff.
func backoffDuration(attempt int) time.Duration {
	d := time.Duration(math.Pow(2, float64(attempt))) * minBackoff
	if d > maxBackoff {
		d = maxBackoff
	}
	return d
}
