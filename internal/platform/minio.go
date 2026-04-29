// Package platform provides clients for platform-owned infrastructure
// (e.g. the platform MinIO instance used as the default backup target).
package platform

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/othmanhaba/nixway-core/internal/config"
)

// ObjectInfo describes a single object stored in the platform bucket.
type ObjectInfo struct {
	Key       string
	Size      int64
	UpdatedAt time.Time
}

// MinIOClient is a thin wrapper around the official MinIO Go SDK that knows
// about the platform's configured bucket and surface the operations needed by
// the backup pipeline (Phase 8.7).
type MinIOClient struct {
	client   *minio.Client
	bucket   string
	endpoint string
	region   string
	useSSL   bool
	logger   *slog.Logger
}

// NewMinIOClient creates a new client from the supplied platform storage config.
// It returns an error if the endpoint is empty or credentials are missing — in
// that case callers are expected to log a warning and continue without a
// platform storage backend.
func NewMinIOClient(cfg config.PlatformStorageConfig, logger *slog.Logger) (*MinIOClient, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, errors.New("platform storage endpoint not configured")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" || strings.TrimSpace(cfg.SecretKey) == "" {
		return nil, errors.New("platform storage credentials not configured")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, errors.New("platform storage bucket not configured")
	}

	host, useSSL, err := parseEndpoint(cfg.Endpoint, cfg.UseSSL)
	if err != nil {
		return nil, fmt.Errorf("parse endpoint: %w", err)
	}

	mc, err := minio.New(host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: useSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("init minio client: %w", err)
	}

	return &MinIOClient{
		client:   mc,
		bucket:   cfg.Bucket,
		endpoint: host,
		region:   cfg.Region,
		useSSL:   useSSL,
		logger:   logger,
	}, nil
}

// Health pings the MinIO instance and verifies the configured bucket exists.
func (c *MinIOClient) Health(ctx context.Context) error {
	if c == nil {
		return errors.New("platform minio client not initialised")
	}
	exists, err := c.client.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists check: %w", err)
	}
	if !exists {
		return fmt.Errorf("bucket %q does not exist", c.bucket)
	}
	return nil
}

// EnsureBucket creates the configured bucket if it does not already exist.
func (c *MinIOClient) EnsureBucket(ctx context.Context) error {
	if c == nil {
		return errors.New("platform minio client not initialised")
	}
	exists, err := c.client.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists check: %w", err)
	}
	if exists {
		return nil
	}
	if err := c.client.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{Region: c.region}); err != nil {
		return fmt.Errorf("create bucket %q: %w", c.bucket, err)
	}
	c.logger.Info("created platform storage bucket", "bucket", c.bucket, "region", c.region)
	return nil
}

// PresignedPutURL returns a presigned URL valid for `expiry` to upload an
// object at `objectKey` in the platform bucket.
func (c *MinIOClient) PresignedPutURL(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	if c == nil {
		return "", errors.New("platform minio client not initialised")
	}
	u, err := c.client.PresignedPutObject(ctx, c.bucket, objectKey, expiry)
	if err != nil {
		return "", fmt.Errorf("presign put: %w", err)
	}
	return u.String(), nil
}

// PresignedGetURL returns a presigned URL valid for `expiry` to download an
// object at `objectKey`.
func (c *MinIOClient) PresignedGetURL(ctx context.Context, objectKey string, expiry time.Duration) (string, error) {
	if c == nil {
		return "", errors.New("platform minio client not initialised")
	}
	u, err := c.client.PresignedGetObject(ctx, c.bucket, objectKey, expiry, url.Values{})
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return u.String(), nil
}

// DeleteObject removes a single object from the platform bucket.
func (c *MinIOClient) DeleteObject(ctx context.Context, objectKey string) error {
	if c == nil {
		return errors.New("platform minio client not initialised")
	}
	if err := c.client.RemoveObject(ctx, c.bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("remove object: %w", err)
	}
	return nil
}

// ListObjects lists objects under the supplied prefix.
func (c *MinIOClient) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	if c == nil {
		return nil, errors.New("platform minio client not initialised")
	}
	out := make([]ObjectInfo, 0, 32)
	ch := c.client.ListObjects(ctx, c.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})
	for obj := range ch {
		if obj.Err != nil {
			return nil, fmt.Errorf("list objects: %w", obj.Err)
		}
		out = append(out, ObjectInfo{
			Key:       obj.Key,
			Size:      obj.Size,
			UpdatedAt: obj.LastModified,
		})
	}
	return out, nil
}

// Bucket returns the configured bucket name.
func (c *MinIOClient) Bucket() string {
	if c == nil {
		return ""
	}
	return c.bucket
}

// Endpoint returns the configured MinIO host (without scheme).
func (c *MinIOClient) Endpoint() string {
	if c == nil {
		return ""
	}
	return c.endpoint
}

// parseEndpoint accepts inputs like "http://host:9000", "https://host:9000",
// or a bare "host:9000" and returns the host portion and the resolved SSL flag.
// If the endpoint includes a scheme it overrides the supplied useSSL default.
func parseEndpoint(endpoint string, useSSLDefault bool) (string, bool, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return "", false, errors.New("empty endpoint")
	}
	switch {
	case strings.HasPrefix(endpoint, "https://"):
		return strings.TrimPrefix(endpoint, "https://"), true, nil
	case strings.HasPrefix(endpoint, "http://"):
		return strings.TrimPrefix(endpoint, "http://"), false, nil
	default:
		return endpoint, useSSLDefault, nil
	}
}
