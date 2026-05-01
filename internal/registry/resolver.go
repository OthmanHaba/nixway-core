package registry

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// Auth is the resolved push/pull credential plus a tag prefix the caller can
// use to construct a fully-qualified image reference. TagPrefix already ends
// in "/" when non-empty, so callers compose tags as TagPrefix+slug+":"+sha.
type Auth struct {
	Server    string // registry hostname, e.g. "ghcr.io" or "<acct>.dkr.ecr.us-east-1.amazonaws.com"
	Username  string
	Password  string
	TagPrefix string // prefix used to build the image reference (host + namespace + "/")
}

// Resolver translates a stored RegistryCredential into runtime Auth a docker
// daemon can use for `docker login` / `docker push` / `docker pull`.
type Resolver struct {
	masterKey [32]byte
	client    *http.Client
}

func NewResolver(masterKey [32]byte) *Resolver {
	return &Resolver{
		masterKey: masterKey,
		client:    &http.Client{Timeout: 15 * time.Second},
	}
}

// Resolve returns Auth for the given credential. teamID is the encryption
// scope used when the credential was stored.
func (r *Resolver) Resolve(ctx context.Context, cred db.RegistryCredential, teamID uuid.UUID) (Auth, error) {
	encCtx := "registry:" + teamID.String()

	switch strings.ToLower(cred.RegistryType) {
	case "dockerhub":
		password, err := crypto.Decrypt(cred.Password, r.masterKey, encCtx)
		if err != nil {
			return Auth{}, fmt.Errorf("decrypt password: %w", err)
		}
		if cred.Username == "" {
			return Auth{}, fmt.Errorf("dockerhub: username is required")
		}
		return Auth{
			Server:    "docker.io",
			Username:  cred.Username,
			Password:  string(password),
			TagPrefix: cred.Username + "/",
		}, nil

	case "ghcr":
		password, err := crypto.Decrypt(cred.Password, r.masterKey, encCtx)
		if err != nil {
			return Auth{}, fmt.Errorf("decrypt password: %w", err)
		}
		if cred.Username == "" {
			return Auth{}, fmt.Errorf("ghcr: username (owner) is required")
		}
		return Auth{
			Server:    "ghcr.io",
			Username:  cred.Username,
			Password:  string(password),
			TagPrefix: "ghcr.io/" + strings.ToLower(cred.Username) + "/",
		}, nil

	case "generic":
		password, err := crypto.Decrypt(cred.Password, r.masterKey, encCtx)
		if err != nil {
			return Auth{}, fmt.Errorf("decrypt password: %w", err)
		}
		host, err := registryHost(cred.RegistryUrl)
		if err != nil {
			return Auth{}, fmt.Errorf("generic: %w", err)
		}
		return Auth{
			Server:    host,
			Username:  cred.Username,
			Password:  string(password),
			TagPrefix: host + "/",
		}, nil

	case "ecr":
		if cred.Region == nil || *cred.Region == "" {
			return Auth{}, fmt.Errorf("ecr: region is required")
		}
		if cred.AwsAccessKeyID == nil || *cred.AwsAccessKeyID == "" {
			return Auth{}, fmt.Errorf("ecr: AWS access key ID is required")
		}
		secret, err := crypto.Decrypt(cred.AwsSecretAccessKey, r.masterKey, encCtx)
		if err != nil {
			return Auth{}, fmt.Errorf("decrypt aws secret: %w", err)
		}
		token, endpoint, err := r.fetchECRToken(ctx, *cred.Region, *cred.AwsAccessKeyID, string(secret))
		if err != nil {
			return Auth{}, err
		}
		username, password, err := decodeECRToken(token)
		if err != nil {
			return Auth{}, err
		}
		host, err := registryHost(endpoint)
		if err != nil {
			return Auth{}, fmt.Errorf("ecr: %w", err)
		}
		return Auth{
			Server:    host,
			Username:  username,
			Password:  password,
			TagPrefix: host + "/",
		}, nil

	default:
		return Auth{}, fmt.Errorf("unsupported registry type %q", cred.RegistryType)
	}
}

func (r *Resolver) fetchECRToken(ctx context.Context, region, accessKeyID, secretAccessKey string) (token, endpoint string, err error) {
	req, err := signedECRRequest(ctx, region, accessKeyID, secretAccessKey,
		"AmazonEC2ContainerRegistry_V20150921.GetAuthorizationToken", `{"registryIds":[]}`)
	if err != nil {
		return "", "", fmt.Errorf("ecr: build request: %w", err)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("ecr: request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("ecr: GetAuthorizationToken status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed struct {
		AuthorizationData []struct {
			AuthorizationToken string `json:"authorizationToken"`
			ProxyEndpoint      string `json:"proxyEndpoint"`
		} `json:"authorizationData"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", "", fmt.Errorf("ecr: decode response: %w", err)
	}
	if len(parsed.AuthorizationData) == 0 {
		return "", "", fmt.Errorf("ecr: empty authorizationData")
	}
	return parsed.AuthorizationData[0].AuthorizationToken, parsed.AuthorizationData[0].ProxyEndpoint, nil
}

// decodeECRToken splits the base64 "AWS:<token>" returned by ECR.
func decodeECRToken(b64 string) (string, string, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", "", fmt.Errorf("ecr: decode auth token: %w", err)
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("ecr: malformed auth token")
	}
	return parts[0], parts[1], nil
}

// registryHost normalizes a registry URL down to its host component.
// Accepts "https://ghcr.io", "ghcr.io", or "ghcr.io/v2/".
func registryHost(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("registry URL is empty")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse registry URL: %w", err)
	}
	if u.Host == "" {
		return "", fmt.Errorf("registry URL has no host: %q", raw)
	}
	return u.Host, nil
}
