package cluster

import (
	"fmt"
	"net"
)

// CIDRAllocator manages IP allocation for clusters and servers.
type CIDRAllocator struct {
	pool    *net.IPNet
	startIP net.IP // the original IP before masking (e.g. 10.100.0.0)
}

// NewCIDRAllocator creates a new allocator from a pool CIDR string.
// The pool defines the range of /16 blocks available for clusters.
// Example: "10.100.0.0/10" — starts allocating from 10.100.0.0/16.
func NewCIDRAllocator(poolCIDR string) *CIDRAllocator {
	ip, pool, err := net.ParseCIDR(poolCIDR)
	if err != nil {
		panic(fmt.Sprintf("invalid pool CIDR: %s", poolCIDR))
	}
	return &CIDRAllocator{pool: pool, startIP: ip.To4()}
}

// AllocateClusterCIDR returns the next available /16 from the pool.
// usedCIDRs is the list of already-allocated cluster CIDRs from the DB.
func (a *CIDRAllocator) AllocateClusterCIDR(usedCIDRs []string) (net.IPNet, error) {
	used := make(map[string]bool)
	for _, c := range usedCIDRs {
		used[c] = true
	}

	ip := make(net.IP, 4)
	copy(ip, a.startIP)

	for a.pool.Contains(ip) {
		candidate := net.IPNet{
			IP:   make(net.IP, 4),
			Mask: net.CIDRMask(16, 32),
		}
		copy(candidate.IP, ip)

		if !used[candidate.String()] {
			return candidate, nil
		}

		// Move to next /16 block
		ip[1]++
		if ip[1] == 0 {
			break
		}
	}

	return net.IPNet{}, fmt.Errorf("no available /16 CIDRs in pool %s", a.pool.String())
}

// AllocateServerIP returns the next available IP within a cluster's CIDR.
// usedIPs is the list of already-assigned WireGuard IPs from the DB.
func (a *CIDRAllocator) AllocateServerIP(clusterCIDR string, usedIPs []string) (net.IP, error) {
	_, cidr, err := net.ParseCIDR(clusterCIDR)
	if err != nil {
		return nil, fmt.Errorf("invalid cluster CIDR: %w", err)
	}

	used := make(map[string]bool)
	for _, ip := range usedIPs {
		used[ip] = true
	}

	ip := make(net.IP, 4)
	copy(ip, cidr.IP.To4())

	// Start at .1 (skip .0 network address)
	ip[3] = 1

	for cidr.Contains(ip) {
		if !used[ip.String()] {
			result := make(net.IP, 4)
			copy(result, ip)
			return result, nil
		}

		incrementIP(ip)
	}

	return nil, fmt.Errorf("no available IPs in CIDR %s", clusterCIDR)
}

func incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			break
		}
	}
}
