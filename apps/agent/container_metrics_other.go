//go:build !linux

package main

import agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"

func collectContainerMetrics() *agentv1.MetricReport {
	return &agentv1.MetricReport{}
}
