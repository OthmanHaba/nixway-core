package email

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// We don't hit the Resend API in unit tests; that's an integration concern.
// This just guards the constructor wiring.
func TestNewResendSender(t *testing.T) {
	s := NewResendSender("re_test_key", "Nixway <noreply@nixway.dev>")
	assert.NotNil(t, s)
	assert.Equal(t, "Nixway <noreply@nixway.dev>", s.from)
	assert.NotNil(t, s.client)
}
