// Package appenv manages app-level environment variables: configurable .env
// entries scoped to a single (app, environment). Values are encrypted at rest
// with the same AES-secretbox scheme as team secrets. At deploy time these are
// merged on top of team secrets (app vars win) and below database-link and
// platform-reserved vars.
package appenv

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// Service manages encrypted environment variables scoped to an app+environment.
type Service struct {
	queries   *db.Queries
	masterKey [32]byte
	logger    *slog.Logger
}

// NewService creates a new app env-var Service.
func NewService(queries *db.Queries, masterKey [32]byte, logger *slog.Logger) *Service {
	return &Service{
		queries:   queries,
		masterKey: masterKey,
		logger:    logger,
	}
}

// encryptionContext returns the HKDF context string for an app's env vars.
// Scoping by app ID keeps these crypto-isolated from team secrets.
func (s *Service) encryptionContext(appID uuid.UUID) string {
	return "appenv:" + appID.String()
}

func uuidToPgtype(id uuid.UUID) pgtype.UUID {
	if id == uuid.Nil {
		return pgtype.UUID{Valid: false}
	}
	return pgtype.UUID{Bytes: id, Valid: true}
}

// Set encrypts the plaintext and inserts or updates the env var for the given
// (app, environment, key). Returns the stored row.
func (s *Service) Set(ctx context.Context, appID, envID uuid.UUID, key, plaintext string, actorID uuid.UUID) (db.AppEnvVar, error) {
	ciphertext, err := crypto.Encrypt([]byte(plaintext), s.masterKey, s.encryptionContext(appID))
	if err != nil {
		return db.AppEnvVar{}, fmt.Errorf("encrypt env var: %w", err)
	}

	row, err := s.queries.UpsertAppEnvVar(ctx, db.UpsertAppEnvVarParams{
		AppID:          appID,
		EnvironmentID:  envID,
		Key:            key,
		EncryptedValue: ciphertext,
		CreatedBy:      uuidToPgtype(actorID),
	})
	if err != nil {
		return db.AppEnvVar{}, fmt.Errorf("upsert env var: %w", err)
	}
	return row, nil
}

// List returns env-var metadata (no values) for an app+environment.
func (s *Service) List(ctx context.Context, appID, envID uuid.UUID) ([]db.ListAppEnvVarsRow, error) {
	rows, err := s.queries.ListAppEnvVars(ctx, db.ListAppEnvVarsParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err != nil {
		return nil, fmt.Errorf("list env vars: %w", err)
	}
	return rows, nil
}

// Reveal decrypts and returns the plaintext value of a single env var. Unlike
// secrets, env vars are editable config and may be revealed repeatedly.
func (s *Service) Reveal(ctx context.Context, id, appID uuid.UUID) (string, error) {
	row, err := s.queries.GetAppEnvVarByID(ctx, db.GetAppEnvVarByIDParams{
		ID:    id,
		AppID: appID,
	})
	if err != nil {
		return "", fmt.Errorf("get env var: %w", err)
	}
	plaintext, err := crypto.Decrypt(row.EncryptedValue, s.masterKey, s.encryptionContext(appID))
	if err != nil {
		return "", fmt.Errorf("decrypt env var: %w", err)
	}
	return string(plaintext), nil
}

// Delete removes a single env var.
func (s *Service) Delete(ctx context.Context, id, appID uuid.UUID) error {
	if err := s.queries.DeleteAppEnvVar(ctx, db.DeleteAppEnvVarParams{
		ID:    id,
		AppID: appID,
	}); err != nil {
		return fmt.Errorf("delete env var: %w", err)
	}
	return nil
}

// ResolveForDeploy decrypts every env var for an app+environment into a flat
// map for deploy-time injection. A single decryption failure aborts the resolve
// so a corrupt value never silently drops config.
func (s *Service) ResolveForDeploy(ctx context.Context, appID, envID uuid.UUID) (map[string]string, error) {
	rows, err := s.queries.ListAppEnvVarsWithValues(ctx, db.ListAppEnvVarsWithValuesParams{
		AppID:         appID,
		EnvironmentID: envID,
	})
	if err != nil {
		return nil, fmt.Errorf("list env vars with values: %w", err)
	}
	result := make(map[string]string, len(rows))
	for _, row := range rows {
		plaintext, err := crypto.Decrypt(row.EncryptedValue, s.masterKey, s.encryptionContext(appID))
		if err != nil {
			return nil, fmt.Errorf("decrypt env var %q: %w", row.Key, err)
		}
		result[row.Key] = string(plaintext)
	}
	return result, nil
}
