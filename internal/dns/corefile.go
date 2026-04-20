package dns

import "fmt"

// GenerateCorefile produces a CoreDNS Corefile for a cluster zone.
func GenerateCorefile(clusterSlug string) string {
	return fmt.Sprintf(`%s.internal {
    hosts /etc/coredns/hosts {
        fallthrough
    }
    log
    errors
}

. {
    forward . 8.8.8.8 1.1.1.1
    log
    errors
    cache 30
}
`, clusterSlug)
}
