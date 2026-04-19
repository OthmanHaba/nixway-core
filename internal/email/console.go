package email

import (
	"context"
	"log/slog"
)

// ConsoleSender logs emails via slog instead of sending them.
type ConsoleSender struct {
	logger *slog.Logger
}

// NewConsoleSender creates a ConsoleSender using the provided logger.
// If logger is nil, slog.Default() is used.
func NewConsoleSender(logger *slog.Logger) *ConsoleSender {
	if logger == nil {
		logger = slog.Default()
	}
	return &ConsoleSender{logger: logger}
}

func (s *ConsoleSender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	s.logger.InfoContext(ctx, "console email",
		"to", to,
		"subject", subject,
		"html_body", htmlBody,
		"text_body", textBody,
	)
	return nil
}
