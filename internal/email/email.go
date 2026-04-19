package email

import "context"

// Sender is the interface for sending emails.
type Sender interface {
	Send(ctx context.Context, to, subject, htmlBody, textBody string) error
}
