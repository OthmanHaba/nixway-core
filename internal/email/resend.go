package email

import (
	"context"
	"fmt"

	"github.com/resend/resend-go/v3"
)

// ResendSender sends email via the Resend HTTP API (resend.com).
type ResendSender struct {
	client *resend.Client
	from   string
}

// NewResendSender constructs a sender backed by the Resend SDK. The API key
// is read from NIXWAY_EMAIL_API_KEY at the boot site; from is the verified
// sender address (e.g. "Nixway <noreply@nixway.dev>").
func NewResendSender(apiKey, from string) *ResendSender {
	return &ResendSender{
		client: resend.NewClient(apiKey),
		from:   from,
	}
}

func (s *ResendSender) Send(ctx context.Context, to, subject, htmlBody, textBody string) error {
	if _, err := s.client.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: subject,
		Html:    htmlBody,
		Text:    textBody,
	}); err != nil {
		return fmt.Errorf("resend send: %w", err)
	}
	return nil
}
