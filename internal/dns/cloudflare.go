// Package dns manages public DNS records for platform app domains.
//
// When a deploy generates a platform domain under a real base domain
// (e.g. myapp-proj-team.apps.nixway.dev) the name must resolve to the
// node that actually serves the traffic — the server's public IP, or the
// edge load-balancer IP in edge-mode clusters. Unlike the magic *.nip.io
// fallback (which encodes the IP in the hostname), a real domain needs an
// actual A record. This package creates/updates those records via the
// Cloudflare API and removes them when an app is deleted.
package dns

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Provider creates and removes public DNS records for platform domains.
type Provider interface {
	// EnsureRecord upserts an A record `name -> ip`. proxied controls whether
	// the record is served through Cloudflare's proxy (orange-cloud, TLS
	// terminated at the edge) or DNS-only (grey-cloud). Idempotent.
	EnsureRecord(ctx context.Context, name, ip string, proxied bool) error
	// DeleteRecord removes the A record for name. Missing records are a no-op.
	DeleteRecord(ctx context.Context, name string) error
	// Enabled reports whether the provider is configured to do real work.
	Enabled() bool
}

// Noop is a Provider that does nothing — used when Cloudflare is not
// configured (e.g. local dev relying on the *.nip.io fallback).
type Noop struct{}

func (Noop) EnsureRecord(context.Context, string, string, bool) error { return nil }
func (Noop) DeleteRecord(context.Context, string) error               { return nil }
func (Noop) Enabled() bool                                            { return false }

const cloudflareAPIBase = "https://api.cloudflare.com/client/v4"

// Cloudflare implements Provider against the Cloudflare API v4.
type Cloudflare struct {
	token  string
	zoneID string
	// zoneName is the registrable domain used to resolve zoneID lazily when
	// it isn't configured explicitly (e.g. "nixway.dev").
	zoneName string
	client   *http.Client

	mu          sync.Mutex
	resolvedZID string
}

// NewCloudflare builds a Cloudflare provider. token is an API token with
// DNS edit permission on the zone. zoneID may be empty, in which case it is
// resolved from zoneName (the registrable part of the base domain) on first
// use.
func NewCloudflare(token, zoneID, zoneName string) *Cloudflare {
	return &Cloudflare{
		token:    strings.TrimSpace(token),
		zoneID:   strings.TrimSpace(zoneID),
		zoneName: strings.TrimSpace(zoneName),
		client:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Cloudflare) Enabled() bool { return c.token != "" }

// RegistrableDomain returns the last two labels of a domain, a good-enough
// heuristic for resolving the Cloudflare zone from a base domain
// (apps.nixway.dev -> nixway.dev). Multi-part TLDs (e.g. example.co.uk)
// should configure the zone ID explicitly.
func RegistrableDomain(domain string) string {
	labels := strings.Split(strings.Trim(domain, "."), ".")
	if len(labels) <= 2 {
		return strings.Join(labels, ".")
	}
	return strings.Join(labels[len(labels)-2:], ".")
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type cfResponse struct {
	Success bool            `json:"success"`
	Errors  []cfError       `json:"errors"`
	Result  json.RawMessage `json:"result"`
}

type cfRecord struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Proxied bool   `json:"proxied"`
}

func (c *Cloudflare) do(ctx context.Context, method, url string, body any, out *cfResponse) error {
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("cloudflare request: %w", err)
	}
	defer resp.Body.Close()

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode cloudflare response (status %d): %w", resp.StatusCode, err)
	}
	if !out.Success {
		if len(out.Errors) > 0 {
			return fmt.Errorf("cloudflare api error (status %d): %s", resp.StatusCode, out.Errors[0].Message)
		}
		return fmt.Errorf("cloudflare api request failed with status %d", resp.StatusCode)
	}
	return nil
}

// zone resolves and caches the zone ID.
func (c *Cloudflare) zone(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.zoneID != "" {
		return c.zoneID, nil
	}
	if c.resolvedZID != "" {
		return c.resolvedZID, nil
	}
	if c.zoneName == "" {
		return "", fmt.Errorf("cloudflare zone not configured (set zone id or base domain)")
	}

	var out cfResponse
	url := fmt.Sprintf("%s/zones?name=%s&status=active", cloudflareAPIBase, c.zoneName)
	if err := c.do(ctx, http.MethodGet, url, nil, &out); err != nil {
		return "", err
	}
	var zones []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(out.Result, &zones); err != nil {
		return "", fmt.Errorf("decode zones: %w", err)
	}
	if len(zones) == 0 {
		return "", fmt.Errorf("cloudflare zone %q not found", c.zoneName)
	}
	c.resolvedZID = zones[0].ID
	return c.resolvedZID, nil
}

func (c *Cloudflare) findRecord(ctx context.Context, zoneID, name string) (*cfRecord, error) {
	var out cfResponse
	url := fmt.Sprintf("%s/zones/%s/dns_records?type=A&name=%s", cloudflareAPIBase, zoneID, name)
	if err := c.do(ctx, http.MethodGet, url, nil, &out); err != nil {
		return nil, err
	}
	var records []cfRecord
	if err := json.Unmarshal(out.Result, &records); err != nil {
		return nil, fmt.Errorf("decode dns records: %w", err)
	}
	if len(records) == 0 {
		return nil, nil
	}
	return &records[0], nil
}

// EnsureRecord upserts an A record name -> ip.
func (c *Cloudflare) EnsureRecord(ctx context.Context, name, ip string, proxied bool) error {
	zoneID, err := c.zone(ctx)
	if err != nil {
		return err
	}
	existing, err := c.findRecord(ctx, zoneID, name)
	if err != nil {
		return err
	}

	// ttl=1 means "automatic". Proxied records ignore TTL.
	payload := map[string]any{
		"type":    "A",
		"name":    name,
		"content": ip,
		"ttl":     1,
		"proxied": proxied,
	}

	var out cfResponse
	if existing == nil {
		url := fmt.Sprintf("%s/zones/%s/dns_records", cloudflareAPIBase, zoneID)
		return c.do(ctx, http.MethodPost, url, payload, &out)
	}
	if existing.Content == ip && existing.Proxied == proxied {
		return nil // already correct
	}
	url := fmt.Sprintf("%s/zones/%s/dns_records/%s", cloudflareAPIBase, zoneID, existing.ID)
	return c.do(ctx, http.MethodPut, url, payload, &out)
}

// DeleteRecord removes the A record for name, if present.
func (c *Cloudflare) DeleteRecord(ctx context.Context, name string) error {
	zoneID, err := c.zone(ctx)
	if err != nil {
		return err
	}
	existing, err := c.findRecord(ctx, zoneID, name)
	if err != nil {
		return err
	}
	if existing == nil {
		return nil
	}
	var out cfResponse
	url := fmt.Sprintf("%s/zones/%s/dns_records/%s", cloudflareAPIBase, zoneID, existing.ID)
	return c.do(ctx, http.MethodDelete, url, nil, &out)
}
