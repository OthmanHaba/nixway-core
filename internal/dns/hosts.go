package dns

import (
	"fmt"
	"strings"
)

// Record represents a DNS A record.
type Record struct {
	Hostname string
	IP       string
}

// MemberDNSInfo holds minimal info needed for DNS record generation.
type MemberDNSInfo struct {
	ServerName  string
	WireGuardIP string
}

// GenerateHostsFile produces a CoreDNS-compatible hosts file.
func GenerateHostsFile(records []Record) string {
	var lines []string
	for _, r := range records {
		lines = append(lines, fmt.Sprintf("%s\t%s", r.IP, r.Hostname))
	}
	return strings.Join(lines, "\n") + "\n"
}

// BuildRecords creates DNS records for all cluster members.
func BuildRecords(clusterSlug string, members []MemberDNSInfo) []Record {
	var records []Record
	for _, m := range members {
		hostname := fmt.Sprintf("%s.%s.internal", m.ServerName, clusterSlug)
		records = append(records, Record{Hostname: hostname, IP: m.WireGuardIP})
	}
	return records
}
