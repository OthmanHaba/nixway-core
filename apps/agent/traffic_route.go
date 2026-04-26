package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

var safeTraefikName = regexp.MustCompile(`[^a-zA-Z0-9-]`)

func HandleTrafficRouteCommand(ctx context.Context, cmd *agentv1.TrafficRouteCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	success := true
	errMsg := ""
	if err := writeWeightedTraefikConfig(cmd); err != nil {
		success = false
		errMsg = err.Error()
		logger.Warn("traffic route sync failed", "app", cmd.AppSlug, "error", err)
	}

	stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_TrafficRouteResult{
			TrafficRouteResult: &agentv1.TrafficRouteResult{
				RequestId: cmd.RequestId,
				AppSlug:   cmd.AppSlug,
				Success:   success,
				Error:     errMsg,
			},
		},
	})

	_ = ctx
}

func writeWeightedTraefikConfig(cmd *agentv1.TrafficRouteCommand) error {
	if cmd.AppSlug == "" {
		return fmt.Errorf("app slug is required")
	}
	if len(cmd.Domains) == 0 {
		return fmt.Errorf("at least one domain is required")
	}
	if len(cmd.Groups) == 0 {
		return fmt.Errorf("at least one backend group is required")
	}
	if err := os.MkdirAll(traefikDynamicDir, 0755); err != nil {
		return err
	}

	var rules []string
	for _, domain := range cmd.Domains {
		if domain != "" {
			rules = append(rules, fmt.Sprintf("Host(`%s`)", domain))
		}
	}
	if len(rules) == 0 {
		return fmt.Errorf("at least one non-empty domain is required")
	}

	entryPoints := "web"
	tlsConfig := ""
	if cmd.Tls {
		entryPoints = "websecure"
		tlsConfig = `      tls:
        certResolver: letsencrypt`
	}

	weightedService := safeName(cmd.AppSlug + "-weighted")
	var b strings.Builder
	fmt.Fprintf(&b, "http:\n")
	fmt.Fprintf(&b, "  routers:\n")
	fmt.Fprintf(&b, "    %s:\n", safeName(cmd.AppSlug))
	fmt.Fprintf(&b, "      rule: \"%s\"\n", strings.Join(rules, " || "))
	fmt.Fprintf(&b, "      entryPoints:\n")
	fmt.Fprintf(&b, "        - %s\n", entryPoints)
	if tlsConfig != "" {
		fmt.Fprintf(&b, "%s\n", tlsConfig)
	}
	fmt.Fprintf(&b, "      service: %s\n", weightedService)
	fmt.Fprintf(&b, "  services:\n")
	fmt.Fprintf(&b, "    %s:\n", weightedService)
	fmt.Fprintf(&b, "      weighted:\n")
	fmt.Fprintf(&b, "        services:\n")
	for _, group := range cmd.Groups {
		if group.Weight <= 0 || len(group.Urls) == 0 {
			continue
		}
		fmt.Fprintf(&b, "          - name: %s\n", safeName(group.Name))
		fmt.Fprintf(&b, "            weight: %d\n", group.Weight)
	}
	for _, group := range cmd.Groups {
		if group.Weight <= 0 || len(group.Urls) == 0 {
			continue
		}
		fmt.Fprintf(&b, "    %s:\n", safeName(group.Name))
		fmt.Fprintf(&b, "      loadBalancer:\n")
		fmt.Fprintf(&b, "        servers:\n")
		for _, url := range group.Urls {
			fmt.Fprintf(&b, "          - url: \"%s\"\n", url)
		}
	}

	return os.WriteFile(filepath.Join(traefikDynamicDir, cmd.AppSlug+".yml"), []byte(b.String()), 0644)
}

func safeName(value string) string {
	cleaned := safeTraefikName.ReplaceAllString(value, "-")
	cleaned = strings.Trim(cleaned, "-")
	if cleaned == "" {
		return "backend"
	}
	return cleaned
}
