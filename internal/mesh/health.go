package mesh

// DerivePeerStatus determines a peer link's status from health check data.
func DerivePeerStatus(reachable bool, rttMs int, handshakeAgeSec int) string {
	if !reachable {
		return "failed"
	}
	if handshakeAgeSec > 300 || rttMs > 500 {
		return "degraded"
	}
	return "active"
}

// DeriveClusterStatus determines overall cluster status from peer link statuses.
func DeriveClusterStatus(peerStatuses []string) string {
	if len(peerStatuses) == 0 {
		return "active"
	}

	failedCount := 0
	degradedCount := 0
	for _, s := range peerStatuses {
		switch s {
		case "failed":
			failedCount++
		case "degraded":
			degradedCount++
		}
	}

	total := len(peerStatuses)
	if failedCount > total/2 {
		return "error"
	}
	if failedCount > 0 || degradedCount > 0 {
		return "degraded"
	}
	return "active"
}
