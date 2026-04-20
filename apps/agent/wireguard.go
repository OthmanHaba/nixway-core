package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

var (
	healthReporterMu     sync.Mutex
	healthReporterCancel context.CancelFunc
)

const (
	wgConfPath     = "/etc/wireguard/wg0.conf"
	wgPrivKeyPath  = "/etc/wireguard/private.key"
	wgPubKeyPath   = "/etc/wireguard/public.key"
	wgInterface    = "wg0"
)

// HandleWireGuardKeyGen generates a WireGuard keypair on the node.
func HandleWireGuardKeyGen(
	_ context.Context,
	cmd *agentv1.WireGuardKeyGenCommand,
	stream agentv1.AgentService_ConnectClient,
	logger *slog.Logger,
) {
	logger.Info("generating WireGuard keypair", "member_id", cmd.MemberId)

	// Ensure WireGuard tools are installed
	if err := ensureWireGuardInstalled(logger); err != nil {
		sendKeyGenResult(stream, cmd.MemberId, "", false, err.Error())
		return
	}

	// Create directory
	os.MkdirAll("/etc/wireguard", 0700)

	// If keys already exist, return the existing public key instead of regenerating
	if existingPub, err := os.ReadFile(wgPubKeyPath); err == nil {
		pub := strings.TrimSpace(string(existingPub))
		if pub != "" {
			logger.Info("reusing existing WireGuard keypair", "member_id", cmd.MemberId)
			sendKeyGenResult(stream, cmd.MemberId, pub, true, "")
			return
		}
	}

	// Generate private key
	privKey, err := execCommand("wg", "genkey")
	if err != nil {
		sendKeyGenResult(stream, cmd.MemberId, "", false, fmt.Sprintf("genkey: %v", err))
		return
	}
	privKey = strings.TrimSpace(privKey)

	// Save private key
	if err := os.WriteFile(wgPrivKeyPath, []byte(privKey), 0600); err != nil {
		sendKeyGenResult(stream, cmd.MemberId, "", false, fmt.Sprintf("save privkey: %v", err))
		return
	}

	// Derive public key
	pubKey, err := execCommandWithInput("wg", "pubkey", privKey)
	if err != nil {
		sendKeyGenResult(stream, cmd.MemberId, "", false, fmt.Sprintf("pubkey: %v", err))
		return
	}
	pubKey = strings.TrimSpace(pubKey)

	// Save public key
	os.WriteFile(wgPubKeyPath, []byte(pubKey), 0644)

	logger.Info("WireGuard keypair generated", "member_id", cmd.MemberId, "pubkey", pubKey)
	sendKeyGenResult(stream, cmd.MemberId, pubKey, true, "")
}

// HandleWireGuardApply applies a WireGuard configuration.
func HandleWireGuardApply(
	_ context.Context,
	cmd *agentv1.WireGuardApplyCommand,
	stream agentv1.AgentService_ConnectClient,
	agentID string,
	logger *slog.Logger,
) {
	logger.Info("applying WireGuard config", "member_id", cmd.MemberId, "ip", cmd.WireguardIp)

	// Read the private key from disk
	privKeyBytes, err := os.ReadFile(wgPrivKeyPath)
	if err != nil {
		sendApplyResult(stream, cmd.MemberId, false, fmt.Sprintf("read privkey: %v", err))
		return
	}
	privKey := strings.TrimSpace(string(privKeyBytes))

	// Replace placeholder in config with actual private key
	config := strings.ReplaceAll(cmd.Config, "PRIVATE_KEY_PLACEHOLDER", privKey)

	// Write config
	os.MkdirAll("/etc/wireguard", 0700)
	if err := os.WriteFile(wgConfPath, []byte(config), 0600); err != nil {
		sendApplyResult(stream, cmd.MemberId, false, fmt.Sprintf("write config: %v", err))
		return
	}

	// Bring down existing interface if it exists
	exec.Command("wg-quick", "down", wgInterface).Run()

	// Bring up the interface
	if out, err := execCommand("wg-quick", "up", wgInterface); err != nil {
		sendApplyResult(stream, cmd.MemberId, false, fmt.Sprintf("wg-quick up: %v (output: %s)", err, out))
		return
	}

	logger.Info("WireGuard interface up", "member_id", cmd.MemberId, "interface", wgInterface)
	sendApplyResult(stream, cmd.MemberId, true, "")

	// Cancel any previous health reporter and start a fresh one with the current stream
	healthReporterMu.Lock()
	if healthReporterCancel != nil {
		healthReporterCancel()
	}
	hctx, hcancel := context.WithCancel(context.Background())
	healthReporterCancel = hcancel
	healthReporterMu.Unlock()
	logger.Info("starting mesh health reporter", "member_id", cmd.MemberId)
	go RunMeshHealthReporter(hctx, agentID, cmd.MemberId, stream, logger)
}

// HandleWireGuardTeardown tears down the WireGuard interface.
func HandleWireGuardTeardown(
	_ context.Context,
	cmd *agentv1.WireGuardTeardownCommand,
	stream agentv1.AgentService_ConnectClient,
	logger *slog.Logger,
) {
	logger.Info("tearing down WireGuard", "member_id", cmd.MemberId)

	if _, err := execCommand("wg-quick", "down", wgInterface); err != nil {
		logger.Warn("wg-quick down failed (may not be up)", "error", err)
	}

	// Clean up files
	os.Remove(wgConfPath)

	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_WireguardTeardownResult{
			WireguardTeardownResult: &agentv1.WireGuardTeardownResult{
				MemberId: cmd.MemberId,
				Success:  true,
			},
		},
	})
}

// HandleDNSUpdate writes DNS config files and optionally deploys CoreDNS.
func HandleDNSUpdate(
	_ context.Context,
	cmd *agentv1.DNSUpdateHostsCommand,
	stream agentv1.AgentService_ConnectClient,
	logger *slog.Logger,
) {
	logger.Info("updating DNS", "cluster_slug", cmd.ClusterSlug, "deploy_coredns", cmd.DeployCoredns)

	os.MkdirAll("/etc/coredns", 0755)

	if err := os.WriteFile("/etc/coredns/hosts", []byte(cmd.HostsContent), 0644); err != nil {
		sendDNSResult(stream, false, fmt.Sprintf("write hosts: %v", err))
		return
	}

	if err := os.WriteFile("/etc/coredns/Corefile", []byte(cmd.CorefileContent), 0644); err != nil {
		sendDNSResult(stream, false, fmt.Sprintf("write Corefile: %v", err))
		return
	}

	if cmd.DeployCoredns {
		// Check if CoreDNS container exists, restart it if so, otherwise deploy
		if out, err := execCommand("docker", "inspect", "nixway-coredns"); err != nil {
			// Deploy CoreDNS
			logger.Info("deploying CoreDNS container")
			_, err := execCommand("docker", "run", "-d",
				"--name", "nixway-coredns",
				"--restart=always",
				"--network", "host",
				"-v", "/etc/coredns:/etc/coredns:ro",
				"coredns/coredns:1.11",
				"-conf", "/etc/coredns/Corefile",
			)
			if err != nil {
				sendDNSResult(stream, false, fmt.Sprintf("deploy CoreDNS: %v", err))
				return
			}
		} else {
			_ = out
			// Restart to pick up new config
			execCommand("docker", "restart", "nixway-coredns")
		}
	}

	logger.Info("DNS updated successfully")
	sendDNSResult(stream, true, "")
}

func ensureWireGuardInstalled(logger *slog.Logger) error {
	if _, err := exec.LookPath("wg"); err != nil {
		logger.Info("installing WireGuard tools")
		if _, err := execCommand("apt-get", "update"); err != nil {
			return fmt.Errorf("apt-get update: %w", err)
		}
		if _, err := execCommand("apt-get", "install", "-y", "wireguard-tools"); err != nil {
			return fmt.Errorf("install wireguard-tools: %w", err)
		}
	}
	return nil
}

func execCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func execCommandWithInput(name, arg, input string) (string, error) {
	cmd := exec.Command(name, arg)
	cmd.Stdin = strings.NewReader(input)
	out, err := cmd.Output()
	return string(out), err
}

func sendKeyGenResult(stream agentv1.AgentService_ConnectClient, memberID, pubKey string, success bool, errMsg string) {
	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_WireguardKeygenResult{
			WireguardKeygenResult: &agentv1.WireGuardKeyGenResult{
				MemberId:  memberID,
				PublicKey: pubKey,
				Success:   success,
				Error:     errMsg,
			},
		},
	})
}

func sendApplyResult(stream agentv1.AgentService_ConnectClient, memberID string, success bool, errMsg string) {
	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_WireguardApplyResult{
			WireguardApplyResult: &agentv1.WireGuardApplyResult{
				MemberId: memberID,
				Success:  success,
				Error:    errMsg,
			},
		},
	})
}

func sendDNSResult(stream agentv1.AgentService_ConnectClient, success bool, errMsg string) {
	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_DnsUpdateResult{
			DnsUpdateResult: &agentv1.DNSUpdateResult{
				Success: success,
				Error:   errMsg,
			},
		},
	})
}
