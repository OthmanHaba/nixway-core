//go:build !linux

package main

import (
	"runtime"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

func collectResources() *agentv1.ResourceReport {
	return &agentv1.ResourceReport{
		CpuCores: int32(runtime.NumCPU()),
	}
}
