package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAuditLogRecordsActions verifies Phase 0 exit criterion #8:
// Audit log records all actions with correct actor attribution.
func TestAuditLogRecordsActions(t *testing.T) {
	env := SetupTestEnv(t)

	// --- Setup: full auth flow to generate audit entries ---
	// Sign up Alice
	resp := env.Post("/api/v1/auth/signup", map[string]string{
		"email": "audit-alice@example.com", "password": "password123", "name": "Audit Alice",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	aliceData := ReadJSONMap(t, resp)
	aliceIDStr := aliceData["id"].(string)
	aliceID, err := uuid.Parse(aliceIDStr)
	require.NoError(t, err)

	// Verify Alice
	aliceUser, err := env.Queries.GetUserByEmail(env.Ctx, "audit-alice@example.com")
	require.NoError(t, err)
	resp = env.Post("/api/v1/auth/verify-email", map[string]string{
		"token": *aliceUser.EmailVerifyToken,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Login Alice
	resp = env.Post("/api/v1/auth/login", map[string]string{
		"email": "audit-alice@example.com", "password": "password123",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Create team
	resp = env.Post("/api/v1/teams", map[string]string{"name": "Audit Team"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	teamData := ReadJSONMap(t, resp)
	teamIDStr := teamData["id"].(string)
	teamID, err := uuid.Parse(teamIDStr)
	require.NoError(t, err)

	// Sign up and login Bob
	bobClient := env.NewClientWithJar()
	resp = env.PostWith(bobClient, "/api/v1/auth/signup", map[string]string{
		"email": "audit-bob@example.com", "password": "password456", "name": "Audit Bob",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	bobData := ReadJSONMap(t, resp)
	bobIDStr := bobData["id"].(string)
	bobID, err := uuid.Parse(bobIDStr)
	require.NoError(t, err)

	bobUser, err := env.Queries.GetUserByEmail(env.Ctx, "audit-bob@example.com")
	require.NoError(t, err)
	resp = env.PostWith(bobClient, "/api/v1/auth/verify-email", map[string]string{
		"token": *bobUser.EmailVerifyToken,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	resp = env.PostWith(bobClient, "/api/v1/auth/login", map[string]string{
		"email": "audit-bob@example.com", "password": "password456",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Create invite
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/invites", teamIDStr), map[string]string{
		"email": "audit-bob@example.com", "role": "member",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Get invite token from DB
	var inviteTokenHash string
	row := env.Pool.QueryRow(env.Ctx,
		"SELECT token FROM team_invites WHERE email = 'audit-bob@example.com' LIMIT 1")
	err = row.Scan(&inviteTokenHash)
	require.NoError(t, err)

	// Bob accepts invite
	resp = env.PostWith(bobClient, "/api/v1/invites/accept", map[string]string{
		"token": inviteTokenHash,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- Now query audit logs and verify ---

	// Query audit logs for the team
	teamPgID := pgtype.UUID{Bytes: teamID, Valid: true}
	logs, err := env.Queries.ListAuditLogs(env.Ctx, db.ListAuditLogsParams{
		TeamID:   teamPgID,
		PageSize: 50,
	})
	require.NoError(t, err)

	// Also query global logs (no team filter) for signup/verify/login
	// which don't have a team_id
	allLogs, err := env.Pool.Query(env.Ctx,
		`SELECT actor_id, action, resource_type FROM audit_logs ORDER BY created_at ASC`)
	require.NoError(t, err)
	defer allLogs.Close()

	type logEntry struct {
		ActorID      pgtype.UUID
		Action       string
		ResourceType string
	}
	var allEntries []logEntry
	for allLogs.Next() {
		var e logEntry
		err := allLogs.Scan(&e.ActorID, &e.Action, &e.ResourceType)
		require.NoError(t, err)
		allEntries = append(allEntries, e)
	}
	require.NoError(t, allLogs.Err())

	// Verify expected actions exist
	actionSet := make(map[string]bool)
	for _, e := range allEntries {
		actionSet[e.Action] = true
	}

	expectedActions := []string{
		"user.signup",
		"user.verify_email",
		"user.login",
		"team.create",
		"invite.create",
		"invite.accept",
	}
	for _, action := range expectedActions {
		assert.True(t, actionSet[action], "audit log should contain action %q", action)
	}

	// Verify actor attribution for team-scoped logs
	teamLogActions := make(map[string]pgtype.UUID)
	for _, l := range logs {
		teamLogActions[l.Action] = l.ActorID
	}

	// team.create should be Alice
	if actorID, ok := teamLogActions["team.create"]; ok {
		assert.True(t, actorID.Valid)
		assert.Equal(t, aliceID, uuid.UUID(actorID.Bytes))
	}

	// invite.create should be Alice
	if actorID, ok := teamLogActions["invite.create"]; ok {
		assert.True(t, actorID.Valid)
		assert.Equal(t, aliceID, uuid.UUID(actorID.Bytes))
	}

	// invite.accept should be Bob
	if actorID, ok := teamLogActions["invite.accept"]; ok {
		assert.True(t, actorID.Valid)
		assert.Equal(t, bobID, uuid.UUID(actorID.Bytes))
	}

	// Verify signup attribution from global logs
	for _, e := range allEntries {
		if e.Action == "user.signup" && e.ActorID.Valid {
			id := uuid.UUID(e.ActorID.Bytes)
			assert.True(t, id == aliceID || id == bobID,
				"signup actor should be alice or bob, got %s", id)
		}
	}

	_ = bobID
}
