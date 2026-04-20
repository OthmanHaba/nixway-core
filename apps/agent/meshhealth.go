package main

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// RunMeshHealthReporter periodically checks WireGuard peer status and reports to control plane.
func RunMeshHealthReporter(
	ctx context.Context,
	agentID, memberID string,
	stream agentv1.AgentService_ConnectClient,
	logger *slog.Logger,
) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("mesh health reporter stopped", "member_id", memberID)
			return
		case <-ticker.C:
			peers := collectPeerHealth(logger)
			if len(peers) == 0 {
				continue
			}
			if err := stream.Send(&agentv1.AgentMessage{
				Payload: &agentv1.AgentMessage_MeshHealthReport{
					MeshHealthReport: &agentv1.MeshHealthReport{
						AgentId:  agentID,
						MemberId: memberID,
						Peers:    peers,
					},
				},
			}); err != nil {
				logger.Debug("failed to send mesh health report", "error", err)
				return
			}
		}
	}
}

// collectPeerHealth runs `wg show wg0 dump` and parses peer info.
func collectPeerHealth(logger *slog.Logger) []*agentv1.PeerHealthInfo {
	out, err := exec.Command("wg", "show", "wg0", "dump").Output()
	if err != nil {
		return nil
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		return nil
	}

	var peers []*agentv1.PeerHealthInfo
	// Skip first line (interface info)
	for _, line := range lines[1:] {
		fields := strings.Split(line, "\t")
		if len(fields) < 8 {
			continue
		}

		// Fields: public_key, preshared_key, endpoint, allowed_ips, latest_handshake, transfer_rx, transfer_tx, persistent_keepalive
		peerIP := extractIP(fields[3]) // allowed_ips
		lastHandshake, _ := strconv.ParseInt(fields[4], 10, 64)

		handshakeAge := int32(0)
		reachable := false
		if lastHandshake > 0 {
			handshakeAge = int32(time.Now().Unix() - lastHandshake)
			reachable = handshakeAge < 300
		}

		// Ping the peer for RTT
		rttMs := int32(0)
		if peerIP != "" {
			if rtt, err := pingPeer(peerIP); err == nil {
				rttMs = int32(rtt)
				reachable = true
			}
		}

		peers = append(peers, &agentv1.PeerHealthInfo{
			PeerMemberId:         "", // we don't have this — control plane maps by IP
			PeerIp:               peerIP,
			Reachable:            reachable,
			RttMs:                rttMs,
			LastHandshakeSeconds: handshakeAge,
		})
	}

	return peers
}

// extractIP extracts the first IP from an allowed_ips field like "10.100.0.2/32"
func extractIP(allowedIPs string) string {
	parts := strings.Split(allowedIPs, "/")
	if len(parts) > 0 {
		return parts[0]
	}
	return allowedIPs
}

var rttRegex = regexp.MustCompile(`time=([0-9.]+)`)

// pingPeer sends a single ICMP ping and returns RTT in milliseconds.
func pingPeer(ip string) (float64, error) {
	out, err := exec.Command("ping", "-c", "1", "-W", "2", ip).CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("ping failed: %w", err)
	}

	matches := rttRegex.FindStringSubmatch(string(out))
	if len(matches) < 2 {
		return 0, fmt.Errorf("could not parse RTT")
	}

	rtt, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return 0, fmt.Errorf("parse RTT: %w", err)
	}
	return rtt, nil
}
