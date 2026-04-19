package handler

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func parseIP(r *http.Request) netip.Addr {
	// Check X-Forwarded-For first
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		if addr, err := netip.ParseAddr(strings.TrimSpace(parts[0])); err == nil {
			return addr
		}
	}
	// Fall back to RemoteAddr
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr
	}
	return netip.Addr{}
}
