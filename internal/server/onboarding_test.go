package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsSupportedOS(t *testing.T) {
	tests := []struct {
		os      string
		version string
		want    bool
	}{
		{"ubuntu", "22.04", true},
		{"ubuntu", "24.04", true},
		{"Ubuntu", "24.04", true},
		{"debian", "12", true},
		{"Debian", "12", true},
		{"ubuntu", "20.04", false},
		{"centos", "7", false},
		{"fedora", "39", false},
		{"", "", false},
		{"ubuntu", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.os+"-"+tt.version, func(t *testing.T) {
			assert.Equal(t, tt.want, isSupportedOS(tt.os, tt.version))
		})
	}
}
