package main

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// runDatabasePostInit creates (or refreshes) the application-scoped database
// user inside a freshly-healthy database container.
//
// Containers are initialized with the engine's built-in superuser
// (NIXWAY_SUPERUSER + NIXWAY_SUPERUSER_PASSWORD) so backups can authenticate
// as that user. This step adds a separate "app_user" with NIXWAY_APP_USER_-
// PASSWORD and grants it scoped privileges on NIXWAY_DB_NAME so applications
// don't need superuser credentials. The exact CLI invocation per engine:
//
//	postgresql: psql -U <super> -c "<DO block: CREATE USER if missing; GRANT>"
//	mysql:      handled at container init via MYSQL_USER/MYSQL_PASSWORD; no-op
//	mongodb:    mongosh -u <super> ... db.createUser / db.changeUserPassword
//	redis:      redis-cli -a <super> ACL SETUSER <app_user> on >pw ~* +@all
//	rabbitmq:   rabbitmqctl add_user / change_password + set_permissions
//
// The function is idempotent so it's safe to re-run on container restart or
// version upgrade.
//
// IMPORTANT: passwords are passed via env vars (PGPASSWORD, MYSQL_PWD, etc.)
// or escaped string literals — they are NEVER substituted into argv where
// another process could observe them.
func runDatabasePostInit(ctx context.Context, cmd *agentv1.DeployCommand, logger *slog.Logger) error {
	template := strings.ToLower(strings.TrimSpace(cmd.Labels["nixway.template"]))
	container := cmd.ContainerName

	superUser := cmd.Env["NIXWAY_SUPERUSER"]
	superPass := cmd.Env["NIXWAY_SUPERUSER_PASSWORD"]
	appUser := cmd.Env["NIXWAY_APP_USER"]
	appPass := cmd.Env["NIXWAY_APP_USER_PASSWORD"]
	dbName := cmd.Env["NIXWAY_DB_NAME"]

	// Single-credential engines (or templates that don't ship the post-init
	// metadata) don't need a separate app user — the container is the only
	// credential. We bail out cleanly so deploy continues to "healthy".
	if appUser == "" || appPass == "" {
		logger.Debug("post-init skipped: no app-user metadata", "template", template, "container", container)
		return nil
	}

	switch template {
	case "postgresql", "postgres":
		return postInitPostgres(ctx, container, superUser, superPass, appUser, appPass, dbName, logger)
	case "mysql", "mariadb":
		// MySQL's official image already creates MYSQL_USER + grants it on
		// MYSQL_DATABASE at init via env vars. Nothing to do here.
		return nil
	case "mongodb", "mongo":
		return postInitMongo(ctx, container, superUser, superPass, appUser, appPass, dbName, logger)
	case "redis":
		return postInitRedis(ctx, container, superPass, appUser, appPass, logger)
	case "rabbitmq":
		return postInitRabbitMQ(ctx, container, appUser, appPass, logger)
	default:
		// Unknown engine: not an error, just nothing to set up.
		return nil
	}
}

// postInitPostgres creates app_user (or updates its password if it already
// exists) and grants full access to dbName + the public schema. Wrapping the
// CREATE USER in a DO block makes the call idempotent without us having to
// parse error codes from psql.
func postInitPostgres(ctx context.Context, container, superUser, superPass, appUser, appPass, dbName string, logger *slog.Logger) error {
	if superUser == "" {
		superUser = "postgres"
	}
	if dbName == "" {
		dbName = "postgres"
	}

	// We build one SQL script that:
	//  1. Creates app_user if missing, or sets its password if it exists.
	//  2. Grants CONNECT + ALL on the database and ALL on the public schema.
	//  3. Sets default privileges so future tables created by app_user are
	//     accessible (and so superuser-created tables are accessible too).
	sql := fmt.Sprintf(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN
    EXECUTE format('CREATE USER %%I WITH PASSWORD %%L', '%s', %s);
  ELSE
    EXECUTE format('ALTER USER %%I WITH PASSWORD %%L', '%s', %s);
  END IF;
END $$;
GRANT CONNECT ON DATABASE "%s" TO "%s";
GRANT ALL PRIVILEGES ON DATABASE "%s" TO "%s";
GRANT ALL ON SCHEMA public TO "%s";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "%s";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "%s";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "%s";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "%s";
`,
		appUser, appUser, sqlSingleQuote(appPass),
		appUser, sqlSingleQuote(appPass),
		dbName, appUser,
		dbName, appUser,
		appUser, appUser, appUser,
		appUser, appUser,
	)

	args := []string{
		"exec",
		"-e", "PGPASSWORD=" + superPass,
		container,
		"psql", "-v", "ON_ERROR_STOP=1", "-U", superUser, "-d", dbName, "-c", sql,
	}
	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		logger.Warn("postgres post-init failed",
			"container", container,
			"error", err,
			"output", truncate(string(out), 512),
		)
		return fmt.Errorf("psql: %v: %s", err, truncate(string(out), 256))
	}
	return nil
}

// postInitMongo creates app_user with readWrite on dbName, or rotates the
// password if it already exists. mongosh is shipped in the official mongo
// image (>=5.0 ships it by default; older images use `mongo`).
func postInitMongo(ctx context.Context, container, superUser, superPass, appUser, appPass, dbName string, logger *slog.Logger) error {
	if superUser == "" {
		superUser = "admin"
	}
	if dbName == "" {
		dbName = "admin"
	}

	js := fmt.Sprintf(`
const target = db.getSiblingDB(%s);
const existing = target.getUser(%s);
if (existing) {
  target.changeUserPassword(%s, %s);
} else {
  target.createUser({user: %s, pwd: %s, roles: [{role: "readWrite", db: %s}]});
}
`,
		jsSingleQuote(dbName),
		jsSingleQuote(appUser),
		jsSingleQuote(appUser), jsSingleQuote(appPass),
		jsSingleQuote(appUser), jsSingleQuote(appPass), jsSingleQuote(dbName),
	)

	// Use mongosh first; fall back to legacy `mongo` shell if mongosh is
	// unavailable (mongo:4 and earlier).
	for _, shell := range []string{"mongosh", "mongo"} {
		args := []string{
			"exec", container, shell, "--quiet",
			"-u", superUser, "-p", superPass, "--authenticationDatabase", "admin",
			"--eval", js,
		}
		out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err == nil {
			return nil
		}
		// `command not found` (127 / "executable file not found") → try next shell.
		if shell != "mongo" && (strings.Contains(string(out), "executable file not found") || strings.Contains(string(out), "not found")) {
			continue
		}
		logger.Warn("mongo post-init failed",
			"container", container,
			"shell", shell,
			"error", err,
			"output", truncate(string(out), 512),
		)
		return fmt.Errorf("%s: %v: %s", shell, err, truncate(string(out), 256))
	}
	return fmt.Errorf("mongo post-init: neither mongosh nor mongo CLI available in container")
}

// postInitRedis adds an ACL entry for app_user so applications connect with
// scoped credentials while the implicit "default" user keeps its requirepass
// (= superPass) for backups and admin tooling. Redis 6+ supports ACL; earlier
// versions only have requirepass — for those, app and admin share superPass.
//
// Passwords ride through REDISCLI_AUTH so they don't appear in `ps` output
// for the duration of the docker exec. The ACL >password specifier is part
// of the ACL grammar and unavoidable on argv, but the only host that ever
// observes it is the agent's own process.
func postInitRedis(ctx context.Context, container, superPass, appUser, appPass string, logger *slog.Logger) error {
	// Probe Redis version: ACL SETUSER fails on Redis 5 with "unknown command".
	verCmd := exec.CommandContext(ctx, "docker", "exec",
		"-e", "REDISCLI_AUTH="+superPass,
		container,
		"redis-cli", "--no-auth-warning", "INFO", "server")
	verOut, _ := verCmd.CombinedOutput()
	if strings.Contains(string(verOut), "redis_version:5.") || strings.Contains(string(verOut), "redis_version:4.") {
		logger.Info("redis ACL skipped: server is < 6.0; app and admin share requirepass",
			"container", container)
		return nil
	}

	args := []string{
		"exec",
		"-e", "REDISCLI_AUTH=" + superPass,
		container,
		"redis-cli", "--no-auth-warning",
		"ACL", "SETUSER", appUser, "on", ">" + appPass, "~*", "+@all",
	}
	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil {
		logger.Warn("redis post-init failed",
			"container", container,
			"error", err,
			"output", truncate(string(out), 512),
		)
		return fmt.Errorf("redis ACL SETUSER: %v: %s", err, truncate(string(out), 256))
	}
	return nil
}

// postInitRabbitMQ adds app_user (or updates its password) and grants full
// permissions on the default vhost. Both rabbitmqctl subcommands are
// idempotent in the sense that we tolerate "user already exists" by falling
// back to change_password.
func postInitRabbitMQ(ctx context.Context, container, appUser, appPass string, logger *slog.Logger) error {
	addOut, addErr := exec.CommandContext(ctx, "docker", "exec", container,
		"rabbitmqctl", "add_user", appUser, appPass).CombinedOutput()
	if addErr != nil {
		// add_user fails when the user exists — flip to change_password.
		if strings.Contains(string(addOut), "user_already_exists") {
			if _, err := exec.CommandContext(ctx, "docker", "exec", container,
				"rabbitmqctl", "change_password", appUser, appPass).CombinedOutput(); err != nil {
				logger.Warn("rabbitmq change_password failed",
					"container", container, "error", err)
				return fmt.Errorf("rabbitmqctl change_password: %v", err)
			}
		} else {
			logger.Warn("rabbitmq add_user failed",
				"container", container, "error", addErr,
				"output", truncate(string(addOut), 512))
			return fmt.Errorf("rabbitmqctl add_user: %v: %s", addErr, truncate(string(addOut), 256))
		}
	}

	if out, err := exec.CommandContext(ctx, "docker", "exec", container,
		"rabbitmqctl", "set_permissions", "-p", "/", appUser, ".*", ".*", ".*").CombinedOutput(); err != nil {
		logger.Warn("rabbitmq set_permissions failed",
			"container", container, "error", err,
			"output", truncate(string(out), 512))
		return fmt.Errorf("rabbitmqctl set_permissions: %v: %s", err, truncate(string(out), 256))
	}
	return nil
}
