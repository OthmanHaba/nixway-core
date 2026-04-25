package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

const (
	DefaultGitHubBaseURL = "https://github.com"
	DefaultGitHubAPIURL  = "https://api.github.com"
)

// AppCredentials holds the response from GitHub after manifest code exchange.
type AppCredentials struct {
	ID            int64  `json:"id"`
	Slug          string `json:"slug"`
	Name          string `json:"name"`
	ClientID      string `json:"client_id"`
	ClientSecret  string `json:"client_secret"`
	PEM           string `json:"pem"`
	WebhookSecret string `json:"webhook_secret"`
	HTMLURL       string `json:"html_url"`
}

// Repository represents a GitHub repository accessible to an installation.
type Repository struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	FullName      string `json:"full_name"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"default_branch"`
	CloneURL      string `json:"clone_url"`
}

// Service handles GitHub App operations.
type Service struct {
	baseURL     string // e.g., "https://github.com"
	apiURL      string // e.g., "https://api.github.com"
	webhookURL  string // Public URL for GitHub webhooks (e.g., tunnel URL)
	redirectURL string // URL GitHub redirects the user's browser to after app creation
	client      *http.Client
	tokenCache  *TokenCache
	logger      *slog.Logger
}

func NewService(baseURL, apiURL, webhookURL, redirectURL string, logger *slog.Logger) *Service {
	return &Service{
		baseURL:     baseURL,
		apiURL:      apiURL,
		webhookURL:  webhookURL,
		redirectURL: redirectURL,
		client:      &http.Client{Timeout: 30 * time.Second},
		tokenCache:  NewTokenCache(),
		logger:      logger,
	}
}

// GenerateManifest returns a JSON-serializable GitHub App manifest for the given team.
func (s *Service) GenerateManifest(teamID, teamSlug string) map[string]any {
	return map[string]any{
		"name": "nixway-" + teamSlug,
		"url":  s.webhookURL,
		"hook_attributes": map[string]any{
			"url": s.webhookURL + "/api/v1/webhooks/github/team/" + teamID,
		},
		"redirect_url": s.redirectURL + "/github/callback",
		"public":       false,
		"default_permissions": map[string]any{
			"contents":      "read",
			"metadata":      "read",
			"pull_requests": "read",
			"webhooks":      "write",
		},
		"default_events": []string{"push", "pull_request", "create"},
	}
}

// ExchangeCode exchanges a manifest code for GitHub App credentials.
func (s *Service) ExchangeCode(ctx context.Context, code string) (*AppCredentials, error) {
	url := fmt.Sprintf("%s/app-manifests/%s/conversions", s.apiURL, code)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("exchange code: unexpected status %d: %s", resp.StatusCode, body)
	}

	var creds AppCredentials
	if err := json.Unmarshal(body, &creds); err != nil {
		return nil, fmt.Errorf("decode credentials: %w", err)
	}
	return &creds, nil
}

// GetInstallationToken returns an installation access token, using the cache when possible.
func (s *Service) GetInstallationToken(ctx context.Context, appID int64, installationID int64, privateKeyPEM []byte) (string, time.Time, error) {
	if token, ok := s.tokenCache.Get(installationID); ok {
		s.logger.Debug("github: installation token cache hit", "installation_id", installationID)
		// Return cached token; exact expiry not tracked after retrieval, use a nominal future time.
		return token, time.Now().Add(55 * time.Minute), nil
	}

	jwtToken, err := GenerateJWT(appID, privateKeyPEM)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("generate jwt: %w", err)
	}

	url := fmt.Sprintf("%s/app/installations/%d/access_tokens", s.apiURL, installationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("request installation token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated {
		return "", time.Time{}, fmt.Errorf("installation token: unexpected status %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", time.Time{}, fmt.Errorf("decode token response: %w", err)
	}

	s.tokenCache.Set(installationID, result.Token, result.ExpiresAt)
	s.logger.Debug("github: installation token fetched", "installation_id", installationID, "expires_at", result.ExpiresAt)

	return result.Token, result.ExpiresAt, nil
}

// Installation represents a GitHub App installation.
type Installation struct {
	ID      int64 `json:"id"`
	Account struct {
		Login string `json:"login"`
		Type  string `json:"type"`
	} `json:"account"`
	TargetType          string `json:"target_type"`
	RepositorySelection string `json:"repository_selection"`
}

// ListInstallations fetches all installations for the app from the GitHub API.
func (s *Service) ListInstallations(ctx context.Context, appID int64, privateKeyPEM []byte) ([]Installation, error) {
	jwtToken, err := GenerateJWT(appID, privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("generate jwt: %w", err)
	}

	url := fmt.Sprintf("%s/app/installations", s.apiURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list installations: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	s.logger.Info("github list installations response", "status", resp.StatusCode, "body_len", len(body))

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list installations: unexpected status %d: %s", resp.StatusCode, body)
	}

	var installations []Installation
	if err := json.Unmarshal(body, &installations); err != nil {
		return nil, fmt.Errorf("decode installations: %w", err)
	}

	s.logger.Info("github installations parsed", "count", len(installations))
	return installations, nil
}

// ListRepositories returns repositories accessible to the given installation token.
func (s *Service) ListRepositories(ctx context.Context, token string) ([]Repository, error) {
	url := fmt.Sprintf("%s/installation/repositories", s.apiURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list repositories: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list repositories: unexpected status %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Repositories []Repository `json:"repositories"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode repositories: %w", err)
	}

	return result.Repositories, nil
}
