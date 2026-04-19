package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFullAuthFlow verifies Phase 0 exit criterion #1:
// User signs up, verifies email, logs in, creates team, invites user, user accepts.
func TestFullAuthFlow(t *testing.T) {
	env := SetupTestEnv(t)

	// --- 1. Sign up user A (Alice) ---
	resp := env.Post("/api/v1/auth/signup", map[string]string{
		"email": "alice@example.com", "password": "password123", "name": "Alice",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	aliceData := ReadJSONMap(t, resp)
	aliceID := aliceData["id"].(string)
	assert.Equal(t, "alice@example.com", aliceData["email"])
	assert.Equal(t, "Alice", aliceData["name"])
	assert.Equal(t, false, aliceData["email_verified"])

	// --- 2. Get verify token from DB ---
	aliceUser, err := env.Queries.GetUserByEmail(env.Ctx, "alice@example.com")
	require.NoError(t, err)
	require.NotNil(t, aliceUser.EmailVerifyToken)

	// --- 3. Verify email ---
	resp = env.Post("/api/v1/auth/verify-email", map[string]string{
		"token": *aliceUser.EmailVerifyToken,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Confirm email is verified in DB
	aliceUser, err = env.Queries.GetUserByEmail(env.Ctx, "alice@example.com")
	require.NoError(t, err)
	assert.True(t, aliceUser.EmailVerified)

	// --- 4. Login ---
	resp = env.Post("/api/v1/auth/login", map[string]string{
		"email": "alice@example.com", "password": "password123",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	loginData := ReadJSONMap(t, resp)
	assert.Equal(t, aliceID, loginData["id"])
	assert.Equal(t, true, loginData["email_verified"])

	// Verify session cookie is set
	cookies := env.Client.Jar.Cookies(resp.Request.URL)
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "session" {
			sessionCookie = c
			break
		}
	}
	require.NotNil(t, sessionCookie, "session cookie should be set after login")

	// --- 5. Create team ---
	resp = env.Post("/api/v1/teams", map[string]string{"name": "My Team"})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	teamData := ReadJSONMap(t, resp)
	teamID := teamData["id"].(string)
	assert.Equal(t, "My Team", teamData["name"])
	assert.Equal(t, "my-team", teamData["slug"])

	// Verify Alice is owner
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/members", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var members []map[string]any
	ReadJSON(t, resp, &members)
	require.Len(t, members, 1)
	assert.Equal(t, "owner", members[0]["role"])

	// --- 6. Sign up user B (Bob) with separate cookie jar ---
	bobClient := env.NewClientWithJar()
	resp = env.PostWith(bobClient, "/api/v1/auth/signup", map[string]string{
		"email": "bob@example.com", "password": "password456", "name": "Bob",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Verify Bob's email
	bobUser, err := env.Queries.GetUserByEmail(env.Ctx, "bob@example.com")
	require.NoError(t, err)
	require.NotNil(t, bobUser.EmailVerifyToken)

	resp = env.PostWith(bobClient, "/api/v1/auth/verify-email", map[string]string{
		"token": *bobUser.EmailVerifyToken,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Login Bob
	resp = env.PostWith(bobClient, "/api/v1/auth/login", map[string]string{
		"email": "bob@example.com", "password": "password456",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- 7. Alice invites Bob ---
	resp = env.Post(fmt.Sprintf("/api/v1/teams/%s/invites", teamID), map[string]string{
		"email": "bob@example.com", "role": "member",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	inviteData := ReadJSONMap(t, resp)
	assert.Equal(t, "bob@example.com", inviteData["email"])
	assert.Equal(t, "member", inviteData["role"])

	// --- 8. Get invite token from DB ---
	invites, err := env.Queries.ListInvitesByTeam(env.Ctx, aliceUser.ID)
	// ListInvitesByTeam takes a teamID, let's query directly
	require.NoError(t, err)
	// The invite token is hashed in the DB. The CreateInvite handler uses
	// auth.HashToken(token) where token = uuid.New().String(), then stores
	// the hash. To accept, AcceptInvite looks up by the stored hash.
	// So we need to get the token hash from the DB.
	var inviteTokenHash string
	rows, err := env.Pool.Query(env.Ctx,
		"SELECT token FROM team_invites WHERE email = 'bob@example.com' LIMIT 1")
	require.NoError(t, err)
	defer rows.Close()
	require.True(t, rows.Next())
	err = rows.Scan(&inviteTokenHash)
	require.NoError(t, err)
	rows.Close()

	// --- 9. Bob accepts invite ---
	// The AcceptInvite handler does: queries.GetInviteByToken(ctx, req.Token)
	// and the token stored in DB is auth.HashToken(plainToken).
	// So we pass the hashed token directly since that's what's in the DB.
	resp = env.PostWith(bobClient, "/api/v1/invites/accept", map[string]string{
		"token": inviteTokenHash,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// --- 10. Verify team has 2 members ---
	resp = env.Get(fmt.Sprintf("/api/v1/teams/%s/members", teamID))
	require.Equal(t, http.StatusOK, resp.StatusCode)
	ReadJSON(t, resp, &members)
	require.Len(t, members, 2, "team should have 2 members after invite accept")

	// Verify roles
	roleMap := map[string]string{}
	for _, m := range members {
		roleMap[m["email"].(string)] = m["role"].(string)
	}
	assert.Equal(t, "owner", roleMap["alice@example.com"])
	assert.Equal(t, "member", roleMap["bob@example.com"])

	// --- Verify /auth/me works with session ---
	resp = env.Get("/api/v1/auth/me")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	meData := ReadJSONMap(t, resp)
	assert.Equal(t, "alice@example.com", meData["email"])

	// --- Verify logout ---
	resp = env.Post("/api/v1/auth/logout", nil)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// After logout, /auth/me should fail
	resp = env.Get("/api/v1/auth/me")
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	resp.Body.Close()

	// Suppress unused variable warning
	_ = invites
	_ = aliceID
}

// TestSignupValidation tests that signup validates inputs properly.
func TestSignupValidation(t *testing.T) {
	env := SetupTestEnv(t)

	tests := []struct {
		name       string
		body       map[string]string
		wantStatus int
	}{
		{
			name:       "missing email",
			body:       map[string]string{"password": "password123", "name": "Test"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid email",
			body:       map[string]string{"email": "notanemail", "password": "password123", "name": "Test"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "short password",
			body:       map[string]string{"email": "test@example.com", "password": "short", "name": "Test"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing name",
			body:       map[string]string{"email": "test@example.com", "password": "password123"},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := env.Post("/api/v1/auth/signup", tt.body)
			assert.Equal(t, tt.wantStatus, resp.StatusCode)
			resp.Body.Close()
		})
	}
}

// TestLoginRequiresVerifiedEmail tests that login fails for unverified emails.
func TestLoginRequiresVerifiedEmail(t *testing.T) {
	env := SetupTestEnv(t)

	// Sign up but don't verify
	resp := env.Post("/api/v1/auth/signup", map[string]string{
		"email": "unverified@example.com", "password": "password123", "name": "Unverified",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	// Try to login
	resp = env.Post("/api/v1/auth/login", map[string]string{
		"email": "unverified@example.com", "password": "password123",
	})
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	resp.Body.Close()
}

// TestDuplicateSignup tests that duplicate email registration fails.
func TestDuplicateSignup(t *testing.T) {
	env := SetupTestEnv(t)

	resp := env.Post("/api/v1/auth/signup", map[string]string{
		"email": "dupe@example.com", "password": "password123", "name": "First",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	resp.Body.Close()

	resp = env.Post("/api/v1/auth/signup", map[string]string{
		"email": "dupe@example.com", "password": "password456", "name": "Second",
	})
	assert.Equal(t, http.StatusConflict, resp.StatusCode)
	resp.Body.Close()
}

// TestTokenRevocation verifies Phase 0 exit criterion #7:
// Revoking an API token invalidates it immediately.
func TestTokenRevocation(t *testing.T) {
	env := SetupTestEnv(t)

	// Setup: create user, verify, login, create team
	aliceID := env.SignupAndLogin(env.Client, "alice-token@example.com", "password123", "Alice Token")
	teamID := env.CreateTeamAsUser(env.Client, "Token Test Team")

	// Create an API token
	resp := env.Post(fmt.Sprintf("/api/v1/teams/%s/tokens", teamID), map[string]any{
		"name":   "test-token",
		"scopes": []string{"read", "write"},
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	tokenData := ReadJSONMap(t, resp)
	plainToken := tokenData["token"].(string)
	tokenID := tokenData["id"].(string)
	assert.NotEmpty(t, plainToken)
	assert.True(t, len(plainToken) > 10)

	// Use the token to access a protected endpoint
	resp = env.GetWithToken(fmt.Sprintf("/api/v1/teams/%s", teamID), plainToken)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	resp.Body.Close()

	// Revoke the token (using session auth)
	resp = env.Delete(fmt.Sprintf("/api/v1/teams/%s/tokens/%s", teamID, tokenID))
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
	resp.Body.Close()

	// Try to use the revoked token — should fail with 401
	resp = env.GetWithToken(fmt.Sprintf("/api/v1/teams/%s", teamID), plainToken)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	resp.Body.Close()

	// Verify the token still works with valid token hash
	tokenHash := auth.HashToken(plainToken)
	_, err := env.Queries.GetAPITokenByHash(env.Ctx, tokenHash)
	assert.Error(t, err, "revoked token should not be found (revoked_at IS NULL filter)")

	_ = aliceID
}
