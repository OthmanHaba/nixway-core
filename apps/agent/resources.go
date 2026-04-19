//go:build linux

package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

func collectResources() *agentv1.ResourceReport {
	report := &agentv1.ResourceReport{}

	// CPU
	report.CpuCores = int32(runtime.NumCPU())
	if model, err := readCPUModel(); err == nil {
		report.CpuModel = model
	}

	// Memory
	if total, avail, err := readMemInfo(); err == nil {
		report.MemoryTotal = total
		report.MemoryAvailable = avail
	}

	// Kernel
	if out, err := exec.Command("uname", "-r").Output(); err == nil {
		report.KernelVersion = strings.TrimSpace(string(out))
	}

	// Docker
	if out, err := exec.Command("docker", "version", "--format", "{{.Server.Version}}").Output(); err == nil {
		report.DockerVersion = strings.TrimSpace(string(out))
	}

	// Disks
	report.Disks = collectDisks()

	// Network
	report.NetworkInterfaces = collectNetworkInterfaces()

	return report
}

func readCPUModel() (string, error) {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return "", err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1]), nil
			}
		}
	}
	return "unknown", nil
}

func readMemInfo() (total, available uint64, err error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fmt.Sscanf(line, "MemTotal: %d kB", &total)
			total *= 1024
		}
		if strings.HasPrefix(line, "MemAvailable:") {
			fmt.Sscanf(line, "MemAvailable: %d kB", &available)
			available *= 1024
		}
	}
	return total, available, nil
}

func collectDisks() []*agentv1.DiskInfo {
	var disks []*agentv1.DiskInfo
	mounts := []string{"/", "/home", "/var", "/tmp"}
	seen := make(map[uint64]bool)

	for _, mount := range mounts {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(mount, &stat); err != nil {
			continue
		}
		devID := uint64(stat.Fsid.X__val[0])
		if seen[devID] {
			continue
		}
		seen[devID] = true

		total := stat.Blocks * uint64(stat.Bsize)
		used := (stat.Blocks - stat.Bfree) * uint64(stat.Bsize)
		disks = append(disks, &agentv1.DiskInfo{
			MountPoint: mount,
			TotalBytes: total,
			UsedBytes:  used,
		})
	}
	return disks
}

func collectNetworkInterfaces() []*agentv1.NetworkInterface {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var result []*agentv1.NetworkInterface
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil || len(addrs) == 0 {
			continue
		}
		ni := &agentv1.NetworkInterface{Name: iface.Name}
		for _, addr := range addrs {
			ni.Ips = append(ni.Ips, addr.String())
		}
		result = append(result, ni)
	}
	return result
}
