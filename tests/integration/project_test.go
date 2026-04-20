package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectCRUD(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "proj@test.com", "password123!", "Proj User")
	teamID := env.CreateTeamAsUser(env.Client, "proj-team")

	// Create a cluster first (project needs a cluster)
	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "test-cluster", "region": "eu-central-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)
	clusterID := cluster["id"].(string)

	// Create project
	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id":  clusterID,
		"name":        "My Project",
		"description": "Test project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)
	assert.Equal(t, "My Project", project["name"])
	assert.Equal(t, "my-project", project["slug"])
	assert.Equal(t, "active", project["status"])

	// List projects
	resp = env.Get("/api/v1/teams/" + teamID + "/projects")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var projects []map[string]any
	ReadJSON(t, resp, &projects)
	assert.Len(t, projects, 1)
	assert.Equal(t, "My Project", projects[0]["name"])

	// Get project
	resp = env.Get("/api/v1/teams/" + teamID + "/projects/" + projectID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	got := ReadJSONMap(t, resp)
	assert.Equal(t, projectID, got["id"])

	// Update project
	resp = env.Put("/api/v1/teams/"+teamID+"/projects/"+projectID, map[string]string{
		"name": "Updated Project", "description": "Updated desc", "status": "active",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updated := ReadJSONMap(t, resp)
	assert.Equal(t, "Updated Project", updated["name"])

	// Delete project
	resp = env.Delete("/api/v1/teams/" + teamID + "/projects/" + projectID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)

	// Verify deleted
	resp = env.Get("/api/v1/teams/" + teamID + "/projects/" + projectID)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
	resp.Body.Close()
}

func TestProjectAutoCreatesProductionEnvironment(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "env@test.com", "password123!", "Env User")
	teamID := env.CreateTeamAsUser(env.Client, "env-team")

	// Create cluster
	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "env-cluster", "region": "us-east-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)
	clusterID := cluster["id"].(string)

	// Create project
	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id": clusterID,
		"name":       "Env Project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)

	// List environments — should have production auto-created
	resp = env.Get("/api/v1/projects/" + projectID + "/environments")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var envs []map[string]any
	ReadJSON(t, resp, &envs)
	assert.Len(t, envs, 1)
	assert.Equal(t, "Production", envs[0]["name"])
	assert.Equal(t, "production", envs[0]["slug"])
	assert.Equal(t, true, envs[0]["is_production"])
}

func TestAppCRUD(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "app@test.com", "password123!", "App User")
	teamID := env.CreateTeamAsUser(env.Client, "app-team")

	// Create cluster + project
	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "app-cluster", "region": "eu-west-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)
	clusterID := cluster["id"].(string)

	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id": clusterID,
		"name":       "App Project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)

	// Create app (docker image source)
	resp = env.Post("/api/v1/projects/"+projectID+"/apps", map[string]any{
		"name":         "my-app",
		"source_type":  "docker_image",
		"docker_image": "nginx:latest",
		"port":         80,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	app := ReadJSONMap(t, resp)
	appID := app["id"].(string)
	assert.Equal(t, "my-app", app["name"])
	assert.Equal(t, "my-app", app["slug"])
	assert.Equal(t, "docker_image", app["source_type"])
	assert.Equal(t, float64(80), app["port"])

	// List apps
	resp = env.Get("/api/v1/projects/" + projectID + "/apps")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var apps []map[string]any
	ReadJSON(t, resp, &apps)
	assert.Len(t, apps, 1)

	// Get app
	resp = env.Get("/api/v1/projects/" + projectID + "/apps/" + appID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	got := ReadJSONMap(t, resp)
	assert.Equal(t, appID, got["id"])

	// Update app
	resp = env.Put("/api/v1/projects/"+projectID+"/apps/"+appID, map[string]any{
		"name": "updated-app", "port": 3000, "status": "active",
		"root_path": "/", "builder": "auto", "dockerfile_path": "Dockerfile",
		"health_check_path": "/health", "health_check_interval": 10,
		"health_check_timeout": 120, "replicas": 2,
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)
	updatedApp := ReadJSONMap(t, resp)
	assert.Equal(t, "updated-app", updatedApp["name"])
	assert.Equal(t, float64(3000), updatedApp["port"])

	// Delete app
	resp = env.Delete("/api/v1/projects/" + projectID + "/apps/" + appID)
	require.Equal(t, http.StatusNoContent, resp.StatusCode)
}

func TestBuildAndDeployLifecycle(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "deploy@test.com", "password123!", "Deploy User")
	teamID := env.CreateTeamAsUser(env.Client, "deploy-team")

	// Create cluster + project + app
	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "deploy-cluster", "region": "us-east-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)
	clusterID := cluster["id"].(string)

	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id": clusterID,
		"name":       "Deploy Project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)

	// Get production environment
	resp = env.Get("/api/v1/projects/" + projectID + "/environments")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var envs []map[string]any
	ReadJSON(t, resp, &envs)
	require.Len(t, envs, 1)
	envID := envs[0]["id"].(string)

	// Create app
	resp = env.Post("/api/v1/projects/"+projectID+"/apps", map[string]any{
		"name":         "deploy-app",
		"source_type":  "docker_image",
		"docker_image": "nginx:latest",
		"port":         80,
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	app := ReadJSONMap(t, resp)
	appID := app["id"].(string)

	// Trigger build
	resp = env.Post("/api/v1/apps/"+appID+"/builds", map[string]string{
		"environment_id": envID,
		"commit_sha":     "abc123",
		"branch":         "main",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	buildData := ReadJSONMap(t, resp)
	buildID := buildData["id"].(string)
	assert.Equal(t, "pending", buildData["status"])
	assert.Equal(t, "manual", buildData["trigger_type"])

	// List builds
	resp = env.Get("/api/v1/apps/" + appID + "/builds")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var builds []map[string]any
	ReadJSON(t, resp, &builds)
	assert.Len(t, builds, 1)
	assert.Equal(t, buildID, builds[0]["id"])

	// Get build
	resp = env.Get("/api/v1/apps/" + appID + "/builds/" + buildID)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	gotBuild := ReadJSONMap(t, resp)
	assert.Equal(t, "abc123", gotBuild["commit_sha"])
}

func TestCreateEnvironment(t *testing.T) {
	env := SetupTestEnv(t)
	env.SignupAndLogin(env.Client, "staging@test.com", "password123!", "Staging User")
	teamID := env.CreateTeamAsUser(env.Client, "staging-team")

	// Create cluster + project
	resp := env.Post("/api/v1/teams/"+teamID+"/clusters", map[string]string{
		"name": "staging-cluster", "region": "eu-west-1",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	cluster := ReadJSONMap(t, resp)

	resp = env.Post("/api/v1/teams/"+teamID+"/projects", map[string]any{
		"cluster_id": cluster["id"],
		"name":       "Staging Project",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	project := ReadJSONMap(t, resp)
	projectID := project["id"].(string)

	// Add staging environment
	resp = env.Post("/api/v1/projects/"+projectID+"/environments", map[string]string{
		"name": "Staging",
	})
	require.Equal(t, http.StatusCreated, resp.StatusCode)
	envData := ReadJSONMap(t, resp)
	assert.Equal(t, "Staging", envData["name"])
	assert.Equal(t, "staging", envData["slug"])
	assert.Equal(t, false, envData["is_production"])

	// List environments — should have production + staging
	resp = env.Get("/api/v1/projects/" + projectID + "/environments")
	require.Equal(t, http.StatusOK, resp.StatusCode)
	var envsList []map[string]any
	ReadJSON(t, resp, &envsList)
	assert.Len(t, envsList, 2)
}
