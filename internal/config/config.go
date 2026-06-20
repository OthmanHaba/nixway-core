package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	Server          ServerConfig
	Database        DatabaseConfig
	Redis           RedisConfig
	Auth            AuthConfig
	Email           EmailConfig
	Crypto          CryptoConfig
	Cluster         ClusterConfig
	GitHub          GitHubConfig
	Webhook         WebhookConfig
	Domain          DomainConfig
	Cloudflare      CloudflareConfig
	Observability   ObservabilityConfig
	PlatformStorage PlatformStorageConfig
}

type ServerConfig struct {
	Host           string
	Port           int
	PublicURL      string // Public URL for HTTP traffic (webhooks, agent download). May be a Cloudflare-proxied domain.
	GRPCPort       int
	AgentGRPCHost  string // Optional override for the host agents dial for gRPC. Use when PublicURL is proxied (e.g. set to raw EC2 IP).
	AgentBinaryDir string // Directory containing pre-built agent binaries
}

type DatabaseConfig struct {
	URL string
}

type RedisConfig struct {
	URL string
}

type AuthConfig struct {
	SessionTTL       time.Duration
	BcryptCost       int
	TokenLength      int
	VerifyEmailTTL   time.Duration
	PasswordResetTTL time.Duration
	InviteTTL        time.Duration
}

type EmailConfig struct {
	Driver   string
	From     string
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	APIKey   string // shared across HTTP-API drivers (currently: resend)
	BaseURL  string
}

type CryptoConfig struct {
	MasterKey string
}

type ClusterConfig struct {
	PoolCIDR string // CIDR pool for cluster allocation (default: 10.100.0.0/10)
}

type GitHubConfig struct {
	BaseURL     string // GitHub base URL (default: https://github.com, override for GHE)
	APIURL      string // GitHub API URL (default: https://api.github.com)
	WebhookURL  string // Public URL for GitHub webhooks (defaults to Server.PublicURL / tunnel URL)
	RedirectURL string // URL GitHub redirects user's browser to (defaults to Email.BaseURL / frontend URL)
}

type WebhookConfig struct {
	EventRetentionDays int // Days to keep webhook events (default: 10, 0 = keep forever)
}

type DomainConfig struct {
	BaseDomain string // Platform wildcard base domain (e.g., "apps.nixway.dev")
}

// CloudflareConfig drives per-app public DNS for platform domains. When
// APIToken is set, each deploy upserts an A record for its generated
// platform domain (under Domain.BaseDomain) pointing at the serving node's
// public IP. Left blank, the platform falls back to *.nip.io and no DNS
// records are managed.
type CloudflareConfig struct {
	APIToken string // Cloudflare API token with DNS edit permission on the zone
	ZoneID   string // Optional explicit zone ID; resolved from BaseDomain when empty
	Proxied  bool   // Orange-cloud records (TLS terminated at Cloudflare's edge)
}

type ObservabilityConfig struct {
	VictoriaMetricsURL string
	VMAgentConfigPath  string
	VMAgentURL         string
}

type PlatformStorageConfig struct {
	Endpoint  string // e.g. "http://nw-platform-minio:9000" or external S3/R2 endpoint
	AccessKey string // platform-managed MinIO root user, or user-provided S3 key
	SecretKey string
	Bucket    string // default "nixway-backups"
	Region    string // for S3/R2 compat; "us-east-1" default
	UseSSL    bool   // default false for local MinIO, true for S3/R2
	Provider  string // "minio" (platform), "s3", "r2", "custom"
}

func Load() (*Config, error) {
	// Load .env file if it exists.
	// Try multiple paths since the working directory varies depending on
	// how the binary is launched (project root, apps/api/, etc.)
	envPaths := []string{".env", "../../.env", "../.env"}

	// Also check NIXWAY_ROOT if set, for reliable .env discovery
	if root := os.Getenv("NIXWAY_ROOT"); root != "" {
		envPaths = append([]string{root + "/.env"}, envPaths...)
	}

	for _, path := range envPaths {
		if err := godotenv.Load(path); err == nil {
			break
		}
	}

	v := viper.New()
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("/etc/nixway")
	v.SetEnvPrefix("NIXWAY")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Server defaults
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.public_url", "") // Set via NIXWAY_SERVER_PUBLIC_URL or .tunnel-url file
	v.SetDefault("server.grpc_port", 9090)
	v.SetDefault("server.agent_grpc_host", "") // Optional: raw host (e.g. EC2 IP) agents should dial for gRPC; falls back to host of public_url
	v.SetDefault("server.agent_binary_dir", "apps/agent/bin")

	// Database defaults
	v.SetDefault("database.url", "postgres://postgres@localhost:5432/nixway_core?sslmode=disable")

	// Redis defaults
	v.SetDefault("redis.url", "redis://localhost:6379/0")

	// Auth defaults
	v.SetDefault("auth.session_ttl", "24h")
	v.SetDefault("auth.bcrypt_cost", 12)
	v.SetDefault("auth.token_length", 40)
	v.SetDefault("auth.verify_email_ttl", "24h")
	v.SetDefault("auth.password_reset_ttl", "1h")
	v.SetDefault("auth.invite_ttl", "168h")

	// Crypto defaults
	v.SetDefault("crypto.master_key", "")

	// Cluster defaults
	v.SetDefault("cluster.pool_cidr", "10.100.0.0/10")

	// GitHub defaults
	v.SetDefault("github.base_url", "https://github.com")
	v.SetDefault("github.api_url", "https://api.github.com")
	v.SetDefault("github.webhook_url", "")  // defaults to server.public_url (tunnel URL)
	v.SetDefault("github.redirect_url", "") // defaults to email.base_url (frontend URL)

	// Domain defaults
	v.SetDefault("domain.base_domain", "apps.nixway.dev")

	// Cloudflare DNS defaults (blank token = disabled, falls back to nip.io)
	v.SetDefault("cloudflare.api_token", "")
	v.SetDefault("cloudflare.zone_id", "")
	v.SetDefault("cloudflare.proxied", true)

	// Webhook defaults
	v.SetDefault("webhook.event_retention_days", 10)

	// Observability defaults
	v.SetDefault("observability.victoria_metrics_url", "http://localhost:8428")
	v.SetDefault("observability.vmagent_config_path", "configs/vmagent.yml")
	v.SetDefault("observability.vmagent_url", "http://localhost:8429")

	// Platform storage defaults (MinIO / S3 / R2)
	v.SetDefault("platformstorage.endpoint", "http://localhost:9000")
	v.SetDefault("platformstorage.bucket", "nixway-backups")
	v.SetDefault("platformstorage.region", "us-east-1")
	v.SetDefault("platformstorage.usessl", false)
	v.SetDefault("platformstorage.provider", "minio")
	v.SetDefault("platformstorage.accesskey", "")
	v.SetDefault("platformstorage.secretkey", "")

	// Email defaults
	v.SetDefault("email.driver", "console")
	v.SetDefault("email.from", "noreply@nixway.dev")
	v.SetDefault("email.base_url", "http://localhost:5173")

	_ = v.ReadInConfig()

	cfg := &Config{}
	cfg.Server.Host = v.GetString("server.host")
	cfg.Server.Port = v.GetInt("server.port")
	cfg.Server.GRPCPort = v.GetInt("server.grpc_port")
	cfg.Server.PublicURL = v.GetString("server.public_url")
	// Read directly from env — viper has issues with nested underscore keys.
	cfg.Server.AgentGRPCHost = os.Getenv("NIXWAY_SERVER_AGENT_GRPC_HOST")
	if cfg.Server.AgentGRPCHost == "" {
		cfg.Server.AgentGRPCHost = v.GetString("server.agent_grpc_host")
	}
	cfg.Server.AgentBinaryDir = v.GetString("server.agent_binary_dir")

	// If no public URL set, try reading from .tunnel-url file (written by cloudflared tunnel)
	if cfg.Server.PublicURL == "" {
		tunnelPaths := []string{".tunnel-url", "../../.tunnel-url", "../.tunnel-url"}
		if root := os.Getenv("NIXWAY_ROOT"); root != "" {
			tunnelPaths = append([]string{root + "/.tunnel-url"}, tunnelPaths...)
		}
		for _, tp := range tunnelPaths {
			if data, err := os.ReadFile(tp); err == nil {
				cfg.Server.PublicURL = strings.TrimSpace(string(data))
				break
			}
		}
	}
	// Final fallback to localhost
	if cfg.Server.PublicURL == "" {
		cfg.Server.PublicURL = fmt.Sprintf("http://localhost:%d", cfg.Server.Port)
	}
	cfg.Database.URL = v.GetString("database.url")
	cfg.Redis.URL = v.GetString("redis.url")
	cfg.Auth.SessionTTL = v.GetDuration("auth.session_ttl")
	cfg.Auth.BcryptCost = v.GetInt("auth.bcrypt_cost")
	cfg.Auth.TokenLength = v.GetInt("auth.token_length")
	cfg.Auth.VerifyEmailTTL = v.GetDuration("auth.verify_email_ttl")
	cfg.Auth.PasswordResetTTL = v.GetDuration("auth.password_reset_ttl")
	cfg.Auth.InviteTTL = v.GetDuration("auth.invite_ttl")
	cfg.Email.Driver = v.GetString("email.driver")
	cfg.Email.From = v.GetString("email.from")
	cfg.Email.SMTPHost = v.GetString("email.smtp_host")
	cfg.Email.SMTPPort = v.GetInt("email.smtp_port")
	cfg.Email.SMTPUser = v.GetString("email.smtp_user")
	cfg.Email.SMTPPass = v.GetString("email.smtp_pass")
	cfg.Email.APIKey = v.GetString("email.api_key")
	cfg.Email.BaseURL = v.GetString("email.base_url")
	// Read master key directly from env — viper has issues with nested underscore keys
	cfg.Crypto.MasterKey = os.Getenv("NIXWAY_CRYPTO_MASTER_KEY")
	if cfg.Crypto.MasterKey == "" {
		cfg.Crypto.MasterKey = v.GetString("crypto.master_key")
	}

	cfg.Cluster.PoolCIDR = v.GetString("cluster.pool_cidr")

	cfg.GitHub.BaseURL = v.GetString("github.base_url")
	cfg.GitHub.APIURL = v.GetString("github.api_url")
	cfg.GitHub.WebhookURL = v.GetString("github.webhook_url")
	if cfg.GitHub.WebhookURL == "" {
		cfg.GitHub.WebhookURL = cfg.Server.PublicURL
	}
	cfg.GitHub.RedirectURL = v.GetString("github.redirect_url")
	if cfg.GitHub.RedirectURL == "" {
		cfg.GitHub.RedirectURL = cfg.Email.BaseURL // frontend URL (e.g., http://localhost:5173)
	}

	cfg.Webhook.EventRetentionDays = v.GetInt("webhook.event_retention_days")

	cfg.Domain.BaseDomain = v.GetString("domain.base_domain")

	// Read directly from env — viper is unreliable with nested underscore keys.
	cfg.Cloudflare.APIToken = os.Getenv("NIXWAY_CLOUDFLARE_API_TOKEN")
	if cfg.Cloudflare.APIToken == "" {
		cfg.Cloudflare.APIToken = v.GetString("cloudflare.api_token")
	}
	cfg.Cloudflare.ZoneID = os.Getenv("NIXWAY_CLOUDFLARE_ZONE_ID")
	if cfg.Cloudflare.ZoneID == "" {
		cfg.Cloudflare.ZoneID = v.GetString("cloudflare.zone_id")
	}
	cfg.Cloudflare.Proxied = v.GetBool("cloudflare.proxied")

	cfg.Observability.VictoriaMetricsURL = v.GetString("observability.victoria_metrics_url")
	cfg.Observability.VMAgentConfigPath = v.GetString("observability.vmagent_config_path")
	cfg.Observability.VMAgentURL = v.GetString("observability.vmagent_url")

	cfg.PlatformStorage.Endpoint = v.GetString("platformstorage.endpoint")
	cfg.PlatformStorage.AccessKey = v.GetString("platformstorage.accesskey")
	cfg.PlatformStorage.SecretKey = v.GetString("platformstorage.secretkey")
	cfg.PlatformStorage.Bucket = v.GetString("platformstorage.bucket")
	cfg.PlatformStorage.Region = v.GetString("platformstorage.region")
	cfg.PlatformStorage.UseSSL = v.GetBool("platformstorage.usessl")
	cfg.PlatformStorage.Provider = v.GetString("platformstorage.provider")

	return cfg, nil
}
