package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Validator checks registry credentials by attempting an authenticated request.
type Validator struct {
	client *http.Client
}

// NewValidator creates a Validator with a 10-second HTTP timeout.
func NewValidator() *Validator {
	return &Validator{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Validate dispatches to the correct validation method based on registry type.
// registryType must be one of: "dockerhub", "ghcr", "ecr", "generic".
func (v *Validator) Validate(ctx context.Context, registryType, registryURL, username, password, region, awsAccessKeyID, awsSecretAccessKey string) error {
	switch strings.ToLower(registryType) {
	case "dockerhub":
		return v.validateDockerHub(ctx, username, password)
	case "ghcr":
		return v.validateGHCR(ctx, username, password)
	case "ecr":
		return v.validateECR(ctx, region, awsAccessKeyID, awsSecretAccessKey)
	case "generic":
		return v.validateGeneric(ctx, registryURL, username, password)
	default:
		return fmt.Errorf("unsupported registry type: %q", registryType)
	}
}

// validateDockerHub checks credentials against Docker Hub's /v2/ endpoint.
// It POSTs to https://hub.docker.com/v2/users/login with username+password
// and expects a 200 response with a token.
func (v *Validator) validateDockerHub(ctx context.Context, username, password string) error {
	body, err := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return fmt.Errorf("docker hub: failed to encode credentials: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://hub.docker.com/v2/users/login", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("docker hub: failed to build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("docker hub: request failed: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("docker hub: invalid credentials (status %d)", resp.StatusCode)
	}
	return nil
}

// validateGHCR checks credentials against ghcr.io/v2/ with basic auth
// (username + PAT token). A 200 response indicates valid credentials.
func (v *Validator) validateGHCR(ctx context.Context, username, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://ghcr.io/v2/", nil)
	if err != nil {
		return fmt.Errorf("ghcr: failed to build request: %w", err)
	}
	req.SetBasicAuth(username, token)

	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("ghcr: request failed: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ghcr: invalid credentials (status %d)", resp.StatusCode)
	}
	return nil
}

// validateECR calls the ECR GetAuthorizationToken API using AWS Signature V4
// signed requests. A successful response indicates the credentials are valid.
func (v *Validator) validateECR(ctx context.Context, region, accessKeyID, secretAccessKey string) error {
	if region == "" {
		return fmt.Errorf("ecr: region is required")
	}
	if accessKeyID == "" || secretAccessKey == "" {
		return fmt.Errorf("ecr: AWS access key ID and secret access key are required")
	}

	req, err := signedECRRequest(ctx, region, accessKeyID, secretAccessKey,
		"AmazonEC2ContainerRegistry_V20150921.GetAuthorizationToken", `{"registryIds":[]}`)
	if err != nil {
		return fmt.Errorf("ecr: failed to build request: %w", err)
	}

	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("ecr: request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ecr: invalid credentials (status %d): %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}

// validateGeneric checks credentials against a generic OCI registry's /v2/
// endpoint with basic auth. A 200 response indicates valid credentials.
func (v *Validator) validateGeneric(ctx context.Context, registryURL, username, password string) error {
	if registryURL == "" {
		return fmt.Errorf("generic: registry URL is required")
	}
	url := strings.TrimRight(registryURL, "/") + "/v2/"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("generic: failed to build request: %w", err)
	}
	req.SetBasicAuth(username, password)

	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("generic: request failed: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("generic: invalid credentials (status %d)", resp.StatusCode)
	}
	return nil
}

