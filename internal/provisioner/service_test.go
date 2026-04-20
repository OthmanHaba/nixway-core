package provisioner

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStripScheme(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"https://example.com", "example.com"},
		{"http://example.com", "example.com"},
		{"example.com", "example.com"},
		{"https://foo.trycloudflare.com", "foo.trycloudflare.com"},
		{"http://localhost:8080", "localhost:8080"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, stripScheme(tt.input))
		})
	}
}
