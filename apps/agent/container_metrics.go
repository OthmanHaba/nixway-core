//go:build linux

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"time"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

type dockerStatsLine struct {
	Name     string `json:"Name"`
	CPUPerc  string `json:"CPUPerc"`
	MemPerc  string `json:"MemPerc"`
	MemUsage string `json:"MemUsage"`
	NetIO    string `json:"NetIO"`
	BlockIO  string `json:"BlockIO"`
}

type dockerInspectState struct {
	StartedAt string `json:"StartedAt"`
}

type dockerInspectLine struct {
	RestartCount int64              `json:"RestartCount"`
	State        dockerInspectState `json:"State"`
	Config       struct {
		Labels map[string]string `json:"Labels"`
	} `json:"Config"`
}

func collectContainerMetrics() *agentv1.MetricReport {
	report := &agentv1.MetricReport{}
	out, err := exec.Command("docker", "stats", "--no-stream", "--format", "{{json .}}").Output()
	if err != nil {
		return report
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		var stat dockerStatsLine
		if err := json.Unmarshal(scanner.Bytes(), &stat); err != nil || stat.Name == "" {
			continue
		}
		if !strings.HasPrefix(stat.Name, "nixway-") {
			continue
		}
		memUsed, memLimit := parseUsagePair(stat.MemUsage)
		netRx, netTx := parseUsagePair(stat.NetIO)
		blockRead, blockWrite := parseUsagePair(stat.BlockIO)
		metric := &agentv1.ContainerMetric{
			ContainerName:   stat.Name,
			CpuPercent:      parsePercent(stat.CPUPerc),
			MemoryPercent:   parsePercent(stat.MemPerc),
			MemoryUsed:      memUsed,
			MemoryLimit:     memLimit,
			NetworkRxBytes:  netRx,
			NetworkTxBytes:  netTx,
			BlockReadBytes:  blockRead,
			BlockWriteBytes: blockWrite,
		}
		fillInspectMetrics(metric)
		report.Containers = append(report.Containers, metric)
	}
	return report
}

func fillInspectMetrics(metric *agentv1.ContainerMetric) {
	out, err := exec.Command("docker", "inspect", "--format", "{{json .}}", metric.ContainerName).Output()
	if err != nil {
		return
	}
	var inspect dockerInspectLine
	if err := json.Unmarshal(bytes.TrimSpace(out), &inspect); err != nil {
		return
	}
	metric.RestartCount = inspect.RestartCount
	metric.Labels = inspect.Config.Labels
	if started, err := time.Parse(time.RFC3339Nano, inspect.State.StartedAt); err == nil && !started.IsZero() {
		metric.UptimeSeconds = int64(time.Since(started).Seconds())
	}
}

func parsePercent(raw string) float64 {
	raw = strings.TrimSpace(strings.TrimSuffix(raw, "%"))
	value, _ := strconv.ParseFloat(raw, 64)
	return value
}

func parseUsagePair(raw string) (uint64, uint64) {
	parts := strings.Split(raw, "/")
	if len(parts) != 2 {
		return 0, 0
	}
	return parseByteSize(parts[0]), parseByteSize(parts[1])
}

func parseByteSize(raw string) uint64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0
	}
	valuePart := fields[0]
	unit := ""
	for i, r := range valuePart {
		if (r < '0' || r > '9') && r != '.' {
			unit = valuePart[i:]
			valuePart = valuePart[:i]
			break
		}
	}
	if len(fields) > 1 && unit == "" {
		unit = fields[1]
	}
	value, err := strconv.ParseFloat(valuePart, 64)
	if err != nil {
		return 0
	}
	switch strings.ToLower(unit) {
	case "b", "":
		return uint64(value)
	case "kb":
		return uint64(value * 1000)
	case "kib":
		return uint64(value * 1024)
	case "mb":
		return uint64(value * 1000 * 1000)
	case "mib":
		return uint64(value * 1024 * 1024)
	case "gb":
		return uint64(value * 1000 * 1000 * 1000)
	case "gib":
		return uint64(value * 1024 * 1024 * 1024)
	case "tb":
		return uint64(value * 1000 * 1000 * 1000 * 1000)
	case "tib":
		return uint64(value * 1024 * 1024 * 1024 * 1024)
	default:
		return uint64(value)
	}
}
