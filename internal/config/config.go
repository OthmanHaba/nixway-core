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
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Auth     AuthConfig
	Email    EmailConfig
	Crypto   CryptoConfig
}

type ServerConfig struct {
	Host           string
	Port           int
	PublicURL      string // Public URL for agent connections (e.g. cloudflare tunnel URL)
	GRPCPort       int
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
	BaseURL  string
}

type CryptoConfig struct {
	MasterKey string
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
	v.AutomaticEnv()

	// Server defaults
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.public_url", "")  // Set via NIXWAY_SERVER_PUBLIC_URL or .tunnel-url file
	v.SetDefault("server.grpc_port", 9090)
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
	cfg.Server.AgentBinaryDir = v.GetString("server.agent_binary_dir")

	// If no public URL set, try reading from .tunnel-url file (written by cloudflared tunnel)
	if cfg.Server.PublicURL == "" {
		if data, err := os.ReadFile(".tunnel-url"); err == nil {
			cfg.Server.PublicURL = strings.TrimSpace(string(data))
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
	cfg.Email.BaseURL = v.GetString("email.base_url")
	// Read master key directly from env — viper has issues with nested underscore keys
	cfg.Crypto.MasterKey = os.Getenv("NIXWAY_CRYPTO_MASTER_KEY")
	if cfg.Crypto.MasterKey == "" {
		cfg.Crypto.MasterKey = v.GetString("crypto.master_key")
	}

	return cfg, nil
}
