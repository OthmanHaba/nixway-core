package email

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConsoleSender_Send(t *testing.T) {
	var buf bytes.Buffer
	handler := slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(handler)

	sender := NewConsoleSender(logger)
	ctx := context.Background()

	err := sender.Send(ctx, "alice@example.com", "Hello", "<p>Hi</p>", "Hi")
	require.NoError(t, err)

	output := buf.String()
	assert.True(t, strings.Contains(output, "console email"), "log should contain 'console email'")
	assert.True(t, strings.Contains(output, "alice@example.com"), "log should contain recipient")
	assert.True(t, strings.Contains(output, "Hello"), "log should contain subject")
}

func TestConsoleSender_NilLogger(t *testing.T) {
	// Should not panic when logger is nil; uses slog.Default()
	sender := NewConsoleSender(nil)
	assert.NotNil(t, sender)
	err := sender.Send(context.Background(), "b@example.com", "Test", "<b>hi</b>", "hi")
	assert.NoError(t, err)
}
