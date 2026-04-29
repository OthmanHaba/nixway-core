package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/db"
)

// rotationAlterTimeout caps how long we wait for the agent to ALTER USER.
const rotationAlterTimeout = 30 * time.Second

// RotationRecord is the API response shape — `db.DatabaseCredentialRotation`
// is re-exported with the same field set so callers don't import the sqlc
// package directly.
type RotationRecord = db.DatabaseCredentialRotation

// RotateAppUserCredential rotates the app-user password for a database.
//
// Flow:
//  1. Generate a new password.
//  2. Insert a rotation row in `pending` state.
//  3. Send DatabaseAlterUserCommand to the host agent and wait for the result.
//  4. On success, persist the new password as a NEW secret (not Update — we
//     keep the old secret for audit), and repoint `databases.appuser_secret_id`.
//  5. For every linked app, trigger a re-deploy so the new env propagates.
//  6. Mark the rotation `completed` with the linked-apps-restarted count.
//
// Partial-failure behaviour: if the ALTER succeeds but a linked app fails to
// re-deploy, the new credentials remain valid; only the failed apps need
// manual redeploy. We do NOT roll back the password change — that would
// leave apps with the new password (from secrets) unable to connect.
func (s *Service) RotateAppUserCredential(ctx context.Context, databaseID, userID uuid.UUID) (string, uuid.UUID, error) {
	d, err := s.queries.GetDatabase(ctx, databaseID)
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("get database: %w", err)
	}

	newPassword, err := GeneratePassword()
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("generate password: %w", err)
	}

	// Record the rotation attempt before any side effect.
	oldSecretID := d.AppuserSecretID
	rotation, err := s.queries.CreateDatabaseCredentialRotation(ctx, db.CreateDatabaseCredentialRotationParams{
		DatabaseID:  databaseID,
		RotatedBy:   userID,
		OldSecretID: oldSecretID,
		Status:      "pending",
	})
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("create rotation row: %w", err)
	}

	finishFailure := func(reason string) error {
		errMsg := reason
		_ = s.queries.UpdateDatabaseCredentialRotationStatus(ctx, db.UpdateDatabaseCredentialRotationStatusParams{
			ID:     rotation.ID,
			Status: "failed",
			Error:  &errMsg,
		})
		return errors.New(reason)
	}

	// Step 1: ask the agent to ALTER USER inside the running container.
	if err := s.sendAlterUser(ctx, &d, newPassword); err != nil {
		_ = finishFailure(err.Error())
		return "", rotation.ID, err
	}

	// Step 2: persist the new password as a new secret. Old one stays for audit.
	envNamespace := "database:" + d.Name
	newSecret, err := s.secretSvc.Create(ctx, d.TeamID, envNamespace, newAppPasswordKey(rotation.ID), newPassword, userID)
	if err != nil {
		_ = finishFailure(fmt.Sprintf("store new secret: %v", err))
		return "", rotation.ID, fmt.Errorf("store new secret: %w", err)
	}

	// Best-effort: also update the canonical APP_PASSWORD entry so subsequent
	// Start/BuildEnvForApp/etc pull the new value via BulkResolve. We use the
	// existing UpdateSecretValue flow when the old appuser secret is known;
	// when it's not (e.g. row was orphaned), we fall back to creating a fresh
	// APP_PASSWORD entry.
	if oldSecretID.Valid {
		if _, err := s.secretSvc.Update(ctx, oldSecretID.Bytes, d.TeamID, newPassword, userID); err != nil {
			s.logger.Warn("update canonical APP_PASSWORD secret failed; new versioned secret still valid",
				"database_id", databaseID, "rotation_id", rotation.ID, "error", err)
		}
	}

	// Note: we don't yet have a sqlc query to repoint databases.appuser_secret_id
	// to the NEW versioned secret. The canonical APP_PASSWORD update above keeps
	// Start/BuildEnvForApp working unchanged; the rotation row's new_secret_id
	// (set below) is the source of truth for "which versioned secret is live".

	// Step 3: redeploy every linked app so they pick up the new password.
	links, err := s.queries.ListDatabaseLinksByDatabase(ctx, databaseID)
	if err != nil {
		s.logger.Warn("list links failed during rotation; new password is valid but linked apps were not restarted",
			"database_id", databaseID, "error", err)
	}
	restarted := int32(0)
	var redeployErrs []string
	for _, link := range links {
		if s.redeployer == nil {
			break
		}
		if _, err := s.redeployer.RedeployAppLatest(ctx, link.AppID); err != nil {
			redeployErrs = append(redeployErrs, fmt.Sprintf("app %s: %v", link.AppID, err))
			continue
		}
		restarted++
	}

	// Step 4: finalise rotation row.
	finalStatus := "completed"
	var errPtr *string
	if len(redeployErrs) > 0 {
		// Partial failure: ALTER + secret store succeeded; some redeploys did not.
		finalStatus = "partial"
		joined := fmt.Sprintf("%d/%d apps failed to redeploy: %s", len(redeployErrs), len(links), redeployErrs[0])
		errPtr = &joined
	}
	if err := s.queries.UpdateDatabaseCredentialRotationCompleted(ctx, db.UpdateDatabaseCredentialRotationCompletedParams{
		ID:                  rotation.ID,
		Status:              finalStatus,
		NewSecretID:         pgtype.UUID{Bytes: newSecret.ID, Valid: true},
		LinkedAppsRestarted: restarted,
		Error:               errPtr,
	}); err != nil {
		s.logger.Warn("update rotation completion failed", "rotation_id", rotation.ID, "error", err)
	}

	return newPassword, rotation.ID, nil
}

// ListRotations returns rotation history for a database, newest first.
func (s *Service) ListRotations(ctx context.Context, databaseID uuid.UUID) ([]RotationRecord, error) {
	rows, err := s.queries.ListDatabaseCredentialRotationsByDatabase(ctx, databaseID)
	if err != nil {
		return nil, fmt.Errorf("list rotations: %w", err)
	}
	return rows, nil
}

// HandleAlterUserResult is the callback registered with agent.Server. It
// correlates the agent's reply to whichever in-flight RotateAppUserCredential
// call dispatched it, identified by request_id.
func (s *Service) HandleAlterUserResult(ctx context.Context, result *agentv1.DatabaseAlterUserResult) {
	if result == nil || result.RequestId == "" {
		return
	}
	s.mu.Lock()
	ch, ok := s.pendingAlterUser[result.RequestId]
	if ok {
		delete(s.pendingAlterUser, result.RequestId)
	}
	s.mu.Unlock()
	if !ok {
		return
	}
	select {
	case ch <- result:
	default:
	}
}

// sendAlterUser dispatches a DatabaseAlterUserCommand to the database's host
// agent and waits for the matching DatabaseAlterUserResult.
func (s *Service) sendAlterUser(ctx context.Context, d *db.Database, newPassword string) error {
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: d.ServerID, TeamID: d.TeamID})
	if err != nil {
		return fmt.Errorf("get server: %w", err)
	}
	if srv.AgentID == nil || *srv.AgentID == "" {
		return errors.New("server has no connected agent")
	}

	requestID := uuid.NewString()
	ch := make(chan *agentv1.DatabaseAlterUserResult, 1)
	s.mu.Lock()
	s.pendingAlterUser[requestID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pendingAlterUser, requestID)
		s.mu.Unlock()
	}()

	dbType := dbTypeForTemplate(d.TemplateSlug)
	cmd := &agentv1.DatabaseAlterUserCommand{
		RequestId:     requestID,
		DatabaseId:    d.ID.String(),
		ContainerName: d.ContainerName,
		DatabaseType:  dbType,
		Username:      "app_user",
		NewPassword:   newPassword,
	}
	if err := s.connMgr.SendToAgent(*srv.AgentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_DatabaseAlterUser{DatabaseAlterUser: cmd},
	}); err != nil {
		return fmt.Errorf("send to agent: %w", err)
	}

	timeout := rotationAlterTimeout
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 && remaining < timeout {
			timeout = remaining
		}
	}
	select {
	case res := <-ch:
		if res == nil {
			return errors.New("nil agent result")
		}
		if !res.Success {
			return fmt.Errorf("agent ALTER failed: %s", res.Error)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(timeout):
		return errors.New("timed out waiting for agent ALTER result")
	}
}

// dbTypeForTemplate maps a template slug to the database_type the agent
// understands. Unknown slugs fall back to the slug itself; the agent will
// reject anything it doesn't recognise.
func dbTypeForTemplate(slug string) string {
	switch slug {
	case "postgres", "postgresql":
		return "postgresql"
	case "mysql", "mariadb":
		return "mysql"
	case "mongodb", "mongo":
		return "mongodb"
	case "redis":
		return "redis"
	default:
		return slug
	}
}

// newAppPasswordKey returns the secrets-store key for the rotation-scoped
// versioned copy of the new app password. The canonical APP_PASSWORD entry is
// also updated so existing readers (Start, BuildEnvForApp via BulkResolve)
// continue to work unchanged.
func newAppPasswordKey(rotationID uuid.UUID) string {
	return "APP_PASSWORD_v_" + rotationID.String()[:8]
}
