package secret

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// ErrAlreadyRevealed is returned when attempting to reveal a secret that has
// already been revealed in its current version.
var ErrAlreadyRevealed = errors.New("secret has already been revealed")

// Service manages encrypted secrets scoped to a team and environment.
type Service struct {
	queries   *db.Queries
	masterKey [32]byte
	logger    *slog.Logger
}

// NewService creates a new secret Service.
func NewService(queries *db.Queries, masterKey [32]byte, logger *slog.Logger) *Service {
	return &Service{
		queries:   queries,
		masterKey: masterKey,
		logger:    logger,
	}
}

// encryptionContext returns the HKDF context string for a team's secrets.
func (s *Service) encryptionContext(teamID uuid.UUID) string {
	return "secret:" + teamID.String()
}

// uuidToPgtype converts a uuid.UUID to pgtype.UUID.
func uuidToPgtype(id uuid.UUID) pgtype.UUID {
	if id == uuid.Nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

// optionalUUIDToPgtype converts a nullable *uuid.UUID to pgtype.UUID.
func optionalUUIDToPgtype(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// Create encrypts the plaintext and stores a new secret.
func (s *Service) Create(ctx context.Context, teamID uuid.UUID, environment, key, plaintext string, creatorID uuid.UUID) (db.Secret, error) {
	ciphertext, err := crypto.Encrypt([]byte(plaintext), s.masterKey, s.encryptionContext(teamID))
	if err != nil {
		return db.Secret{}, fmt.Errorf("encrypt secret: %w", err)
	}

	secret, err := s.queries.CreateSecret(ctx, db.CreateSecretParams{
		TeamID:         teamID,
		Environment:    environment,
		Key:            key,
		EncryptedValue: ciphertext,
		CreatedBy:      uuidToPgtype(creatorID),
	})
	if err != nil {
		return db.Secret{}, fmt.Errorf("create secret: %w", err)
	}

	return secret, nil
}

// Update encrypts a new plaintext value, stores it, and resets revealed_at via the DB query.
func (s *Service) Update(ctx context.Context, secretID, teamID uuid.UUID, plaintext string, updaterID uuid.UUID) (db.Secret, error) {
	ciphertext, err := crypto.Encrypt([]byte(plaintext), s.masterKey, s.encryptionContext(teamID))
	if err != nil {
		return db.Secret{}, fmt.Errorf("encrypt secret: %w", err)
	}

	secret, err := s.queries.UpdateSecretValue(ctx, db.UpdateSecretValueParams{
		ID:             secretID,
		TeamID:         teamID,
		EncryptedValue: ciphertext,
		UpdatedBy:      uuidToPgtype(updaterID),
	})
	if err != nil {
		return db.Secret{}, fmt.Errorf("update secret: %w", err)
	}

	return secret, nil
}

// Reveal decrypts and returns the plaintext for a secret. Returns ErrAlreadyRevealed
// if the secret's revealed_at is already set. On success, marks the secret as revealed
// and logs the access.
func (s *Service) Reveal(ctx context.Context, secretID, teamID uuid.UUID, actorID *uuid.UUID, actorType string, ipAddr netip.Addr) (string, error) {
	secret, err := s.queries.GetSecretByID(ctx, db.GetSecretByIDParams{
		ID:     secretID,
		TeamID: teamID,
	})
	if err != nil {
		return "", fmt.Errorf("get secret: %w", err)
	}

	if secret.RevealedAt.Valid {
		return "", ErrAlreadyRevealed
	}

	plaintext, err := crypto.Decrypt(secret.EncryptedValue, s.masterKey, s.encryptionContext(teamID))
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}

	if err := s.queries.SetSecretRevealedAt(ctx, secretID); err != nil {
		return "", fmt.Errorf("mark secret revealed: %w", err)
	}

	if _, logErr := s.queries.CreateSecretAccessLog(ctx, db.CreateSecretAccessLogParams{
		SecretID:  secretID,
		TeamID:    teamID,
		ActorID:   optionalUUIDToPgtype(actorID),
		ActorType: actorType,
		Action:    "read",
		IpAddress: &ipAddr,
	}); logErr != nil {
		s.logger.WarnContext(ctx, "failed to log secret reveal", "secret_id", secretID, "error", logErr)
	}

	return string(plaintext), nil
}

// BulkResolve decrypts multiple secrets by key for deploy-time injection.
// It bypasses the reveal-once restriction and logs each access.
func (s *Service) BulkResolve(ctx context.Context, teamID uuid.UUID, environment string, keys []string, actorID *uuid.UUID, actorType string) (map[string]string, error) {
	result := make(map[string]string, len(keys))

	for _, key := range keys {
		secret, err := s.queries.GetSecretByKey(ctx, db.GetSecretByKeyParams{
			TeamID:      teamID,
			Environment: environment,
			Key:         key,
		})
		if err != nil {
			return nil, fmt.Errorf("get secret %q: %w", key, err)
		}

		plaintext, err := crypto.Decrypt(secret.EncryptedValue, s.masterKey, s.encryptionContext(teamID))
		if err != nil {
			return nil, fmt.Errorf("decrypt secret %q: %w", key, err)
		}

		result[key] = string(plaintext)

		if _, logErr := s.queries.CreateSecretAccessLog(ctx, db.CreateSecretAccessLogParams{
			SecretID:  secret.ID,
			TeamID:    teamID,
			ActorID:   optionalUUIDToPgtype(actorID),
			ActorType: actorType,
			Action:    "resolve",
			IpAddress: nil,
		}); logErr != nil {
			s.logger.WarnContext(ctx, "failed to log bulk resolve", "secret_id", secret.ID, "key", key, "error", logErr)
		}
	}

	return result, nil
}

// List returns secret metadata (no values) for the given team and environment.
func (s *Service) List(ctx context.Context, teamID uuid.UUID, environment string) ([]db.ListSecretsRow, error) {
	secrets, err := s.queries.ListSecrets(ctx, db.ListSecretsParams{
		TeamID:      teamID,
		Environment: environment,
	})
	if err != nil {
		return nil, fmt.Errorf("list secrets: %w", err)
	}
	return secrets, nil
}

// CreateDatabaseSecrets creates two secrets scoped to a team for a database's
// superuser and app-user credentials. Returns the secret IDs. Used by database
// provisioning to atomically store credentials with the reveal-once flag.
//
// NOTE: secrets are scoped to (team, environment, key). The current schema
// does not support project scoping; we use environment="database:<dbname>" as
// a namespace to avoid colliding with regular env-secret keys.
func (s *Service) CreateDatabaseSecrets(ctx context.Context, teamID, projectID uuid.UUID, dbName, superPassword, appPassword string) (uuid.UUID, uuid.UUID, error) {
	env := "database:" + dbName
	creator := uuid.Nil // system-created; no user actor at provision time
	superSecret, err := s.Create(ctx, teamID, env, "SUPERUSER_PASSWORD", superPassword, creator)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("create superuser secret: %w", err)
	}
	appSecret, err := s.Create(ctx, teamID, env, "APP_PASSWORD", appPassword, creator)
	if err != nil {
		// Best-effort cleanup of superuser secret to avoid an orphaned row.
		_ = s.queries.DeleteSecret(ctx, db.DeleteSecretParams{ID: superSecret.ID, TeamID: teamID})
		return uuid.Nil, uuid.Nil, fmt.Errorf("create app secret: %w", err)
	}
	return superSecret.ID, appSecret.ID, nil
}

// Delete removes a secret and logs the deletion action.
func (s *Service) Delete(ctx context.Context, secretID, teamID uuid.UUID, actorID *uuid.UUID, actorType string, ipAddr netip.Addr) error {
	// Log before deletion so we have a record even if the secret row is gone.
	if _, logErr := s.queries.CreateSecretAccessLog(ctx, db.CreateSecretAccessLogParams{
		SecretID:  secretID,
		TeamID:    teamID,
		ActorID:   optionalUUIDToPgtype(actorID),
		ActorType: actorType,
		Action:    "delete",
		IpAddress: &ipAddr,
	}); logErr != nil {
		s.logger.WarnContext(ctx, "failed to log secret delete", "secret_id", secretID, "error", logErr)
	}

	if err := s.queries.DeleteSecret(ctx, db.DeleteSecretParams{
		ID:     secretID,
		TeamID: teamID,
	}); err != nil {
		return fmt.Errorf("delete secret: %w", err)
	}

	return nil
}
