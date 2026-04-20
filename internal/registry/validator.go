package registry

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

	endpoint := fmt.Sprintf("https://ecr.%s.amazonaws.com/", region)
	payload := `{"registryIds":[]}`
	payloadHash := sha256Hex([]byte(payload))

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	headers := map[string]string{
		"content-type": "application/x-amz-json-1.1",
		"host":         fmt.Sprintf("ecr.%s.amazonaws.com", region),
		"x-amz-date":  amzDate,
		"x-amz-target": "AmazonEC2ContainerRegistry_V20150921.GetAuthorizationToken",
	}

	// Canonical headers (sorted by key).
	canonicalHeaders := "" +
		"content-type:" + headers["content-type"] + "\n" +
		"host:" + headers["host"] + "\n" +
		"x-amz-date:" + headers["x-amz-date"] + "\n" +
		"x-amz-target:" + headers["x-amz-target"] + "\n"
	signedHeaders := "content-type;host;x-amz-date;x-amz-target"

	canonicalRequest := strings.Join([]string{
		"POST",
		"/",
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	credentialScope := strings.Join([]string{dateStamp, region, "ecr", "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(secretAccessKey, dateStamp, region, "ecr")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	authHeader := fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKeyID, credentialScope, signedHeaders, signature,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(payload))
	if err != nil {
		return fmt.Errorf("ecr: failed to build request: %w", err)
	}
	req.Header.Set("Content-Type", headers["content-type"])
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Target", headers["x-amz-target"])
	req.Header.Set("Authorization", authHeader)

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

// sha256Hex returns the lowercase hex SHA-256 digest of data.
func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// hmacSHA256 returns the HMAC-SHA256 of data using key.
func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

// deriveSigningKey derives the AWS Signature V4 signing key.
func deriveSigningKey(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}
