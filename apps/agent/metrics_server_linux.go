//go:build linux

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func StartMetricsServer(ctx context.Context, agentID, listenAddr, metricsPath string, logger *slog.Logger) {
	if listenAddr == "" || metricsPath == "" {
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc(metricsPath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		_, _ = w.Write([]byte(renderPrometheusMetrics(agentID)))
	})

	srv := &http.Server{Addr: listenAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	go func() {
		logger.Info("metrics server starting", "addr", listenAddr, "path", metricsPath)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Warn("metrics server stopped", "error", err)
		}
	}()
}

func renderPrometheusMetrics(agentID string) string {
	var b strings.Builder
	labels := fmt.Sprintf(`agent_id="%s"`, promEscape(agentID))

	health := collectHealth()
	writeMetric(&b, "nixway_server_cpu_percent", labels, health.GetCpuPercent())
	writeMetric(&b, "nixway_server_memory_total_bytes", labels, float64(health.GetMemoryTotal()))
	writeMetric(&b, "nixway_server_memory_used_bytes", labels, float64(health.GetMemoryUsed()))
	if health.GetMemoryTotal() > 0 {
		writeMetric(&b, "nixway_server_memory_percent", labels, (float64(health.GetMemoryUsed())/float64(health.GetMemoryTotal()))*100)
	}
	for _, disk := range health.GetDisks() {
		diskLabels := labels + fmt.Sprintf(`,mount="%s"`, promEscape(disk.GetMountPoint()))
		writeMetric(&b, "nixway_server_disk_total_bytes", diskLabels, float64(disk.GetTotalBytes()))
		writeMetric(&b, "nixway_server_disk_used_bytes", diskLabels, float64(disk.GetUsedBytes()))
		if disk.GetTotalBytes() > 0 {
			writeMetric(&b, "nixway_server_disk_percent", diskLabels, (float64(disk.GetUsedBytes())/float64(disk.GetTotalBytes()))*100)
		}
	}

	mem := readMemInfoProm()
	writeMetric(&b, "nixway_server_memory_free_bytes", labels, float64(mem["MemFree"]))
	writeMetric(&b, "nixway_server_memory_cached_bytes", labels, float64(mem["Cached"]+mem["SReclaimable"]))

	for iface, counters := range readNetworkDev() {
		ifaceLabels := labels + fmt.Sprintf(`,interface="%s"`, promEscape(iface))
		writeMetric(&b, "nixway_server_network_rx_bytes", ifaceLabels, float64(counters.rx))
		writeMetric(&b, "nixway_server_network_tx_bytes", ifaceLabels, float64(counters.tx))
	}

	loads := readLoadAverage()
	writeMetric(&b, "nixway_server_load1", labels, loads[0])
	writeMetric(&b, "nixway_server_load5", labels, loads[1])
	writeMetric(&b, "nixway_server_load15", labels, loads[2])
	writeMetric(&b, "nixway_server_file_descriptors", labels, float64(countFileDescriptors()))

	for _, container := range collectContainerMetrics().GetContainers() {
		containerLabels := labels + fmt.Sprintf(`,container="%s"`, promEscape(container.GetContainerName()))
		for key, value := range container.GetLabels() {
			if strings.HasPrefix(key, "nixway.") && value != "" {
				containerLabels += fmt.Sprintf(`,%s="%s"`, promLabelName(key), promEscape(value))
			}
		}
		writeMetric(&b, "nixway_container_cpu_percent", containerLabels, container.GetCpuPercent())
		writeMetric(&b, "nixway_container_memory_percent", containerLabels, container.GetMemoryPercent())
		writeMetric(&b, "nixway_container_memory_used_bytes", containerLabels, float64(container.GetMemoryUsed()))
		writeMetric(&b, "nixway_container_memory_limit_bytes", containerLabels, float64(container.GetMemoryLimit()))
		writeMetric(&b, "nixway_container_network_rx_bytes", containerLabels, float64(container.GetNetworkRxBytes()))
		writeMetric(&b, "nixway_container_network_tx_bytes", containerLabels, float64(container.GetNetworkTxBytes()))
		writeMetric(&b, "nixway_container_block_read_bytes", containerLabels, float64(container.GetBlockReadBytes()))
		writeMetric(&b, "nixway_container_block_write_bytes", containerLabels, float64(container.GetBlockWriteBytes()))
		writeMetric(&b, "nixway_container_restart_count", containerLabels, float64(container.GetRestartCount()))
		writeMetric(&b, "nixway_container_uptime_seconds", containerLabels, float64(container.GetUptimeSeconds()))
	}

	return b.String()
}

type netCounters struct {
	rx uint64
	tx uint64
}

func readNetworkDev() map[string]netCounters {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}
	result := map[string]netCounters{}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		iface := strings.TrimSpace(parts[0])
		if iface == "" || iface == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		result[iface] = netCounters{rx: rx, tx: tx}
	}
	return result
}

func readMemInfoProm() map[string]uint64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return nil
	}
	result := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, _ := strconv.ParseUint(fields[1], 10, 64)
		result[strings.TrimSuffix(fields[0], ":")] = value * 1024
	}
	return result
}

func readLoadAverage() [3]float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return [3]float64{}
	}
	fields := strings.Fields(string(data))
	var loads [3]float64
	for i := 0; i < 3 && i < len(fields); i++ {
		loads[i], _ = strconv.ParseFloat(fields[i], 64)
	}
	return loads
}

func countFileDescriptors() int {
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return 0
	}
	return len(entries)
}

func writeMetric(b *strings.Builder, name, labels string, value float64) {
	_, _ = fmt.Fprintf(b, "%s{%s} %g\n", name, labels, value)
}

func promEscape(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	return value
}

func promLabelName(value string) string {
	value = strings.ReplaceAll(value, ".", "_")
	value = strings.ReplaceAll(value, "-", "_")
	return value
}
