package cluster

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGenerateSlug(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"My Cluster", "my-cluster"},
		{"Production US-East", "production-us-east"},
		{"  spaces  ", "spaces"},
		{"UPPER", "upper"},
		{"special!@#chars", "special-chars"},
		{"", "cluster"},
		{"a--b--c", "a-b-c"},
		{"-leading-trailing-", "leading-trailing"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, GenerateSlug(tt.input))
		})
	}
}

func TestValidateSlug(t *testing.T) {
	valid := []string{"my-cluster", "prod", "us-east-1", "a", "cluster-123"}
	for _, s := range valid {
		assert.True(t, ValidateSlug(s), "%q should be valid", s)
	}

	invalid := []string{"", "-starts-dash", "ends-dash-", "has spaces", "UPPER", "has.dot"}
	for _, s := range invalid {
		assert.False(t, ValidateSlug(s), "%q should be invalid", s)
	}
}
