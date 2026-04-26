//go:build !linux

package main

import (
	"context"
	"log/slog"
)

func StartMetricsServer(_ context.Context, _, _, _ string, _ *slog.Logger) {}
