package main

import (
	"context"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// HandleDatabaseAlterUser execs the right CLI inside the database container to
// change a user's password. The command string per database_type:
//
//	postgresql: psql -U postgres -c "ALTER USER \"<user>\" WITH PASSWORD '<pw>';"
//	mysql:      mysql -uroot -e "ALTER USER '<user>'@'%' IDENTIFIED BY '<pw>'; FLUSH PRIVILEGES;"
//	mongodb:    mongosh --eval "db.changeUserPassword('<user>', '<pw>')"
//	redis:      redis-cli CONFIG SET requirepass <pw>
//
// IMPORTANT: the new_password must NEVER be logged. We log only the database
// type, container, and outcome — no command string with the password
// substituted in. Audit-logging is the control plane's responsibility.
func HandleDatabaseAlterUser(ctx context.Context, cmd *agentv1.DatabaseAlterUserCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.DatabaseAlterUserResult{
		RequestId:  cmd.RequestId,
		DatabaseId: cmd.DatabaseId,
		Success:    true,
	}

	if cmd.ContainerName == "" {
		sendAlterUserResult(stream, finishAlterError(res, "container_name is required"))
		return
	}
	if cmd.NewPassword == "" {
		sendAlterUserResult(stream, finishAlterError(res, "new_password is required"))
		return
	}

	dbType := strings.ToLower(strings.TrimSpace(cmd.DatabaseType))
	user := cmd.Username
	if user == "" {
		user = "app_user"
	}

	var shellCmd string
	switch dbType {
	case "postgresql", "postgres":
		// Use single quotes for password (PG SQL string), double quotes for the
		// identifier. Both shell-escaped via shellSingleQuote to be safe.
		sql := fmt.Sprintf(`ALTER USER "%s" WITH PASSWORD %s;`, user, sqlSingleQuote(cmd.NewPassword))
		shellCmd = fmt.Sprintf("psql -U postgres -c %s", shellSingleQuote(sql))
	case "mysql", "mariadb":
		sql := fmt.Sprintf(`ALTER USER '%s'@'%%' IDENTIFIED BY %s; FLUSH PRIVILEGES;`, user, sqlSingleQuote(cmd.NewPassword))
		shellCmd = fmt.Sprintf("mysql -uroot -e %s", shellSingleQuote(sql))
	case "mongodb", "mongo":
		js := fmt.Sprintf("db.changeUserPassword('%s', %s)", user, jsSingleQuote(cmd.NewPassword))
		shellCmd = fmt.Sprintf("mongosh --quiet --eval %s", shellSingleQuote(js))
	case "redis":
		// v1 limitation: Redis usually has a single password (requirepass).
		// Per-user ACLs (Redis 6+) exist but most templates use single auth.
		if user != "" && user != "default" {
			logger.Warn("redis app-user rotation is best-effort; updating requirepass only",
				"username", user, "container", cmd.ContainerName)
		}
		shellCmd = fmt.Sprintf("redis-cli CONFIG SET requirepass %s", shellSingleQuote(cmd.NewPassword))
	default:
		sendAlterUserResult(stream, finishAlterError(res, "unsupported database_type: "+cmd.DatabaseType))
		return
	}

	execCmd := exec.CommandContext(ctx, "docker", "exec", cmd.ContainerName, "sh", "-c", shellCmd)
	out, err := execCmd.CombinedOutput()
	if err != nil {
		// Trim and bound the error output so we don't leak large stack traces.
		errMsg := strings.TrimSpace(string(out))
		if errMsg == "" {
			errMsg = err.Error()
		}
		if len(errMsg) > 512 {
			errMsg = errMsg[:512] + "...(truncated)"
		}
		logger.Warn("database alter user failed",
			"database_id", cmd.DatabaseId,
			"container", cmd.ContainerName,
			"db_type", dbType,
			"error", err,
		)
		sendAlterUserResult(stream, finishAlterError(res, errMsg))
		return
	}

	logger.Info("database alter user succeeded",
		"database_id", cmd.DatabaseId,
		"container", cmd.ContainerName,
		"db_type", dbType,
	)
	sendAlterUserResult(stream, res)
}

func sendAlterUserResult(stream agentv1.AgentService_ConnectClient, res *agentv1.DatabaseAlterUserResult) {
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_DatabaseAlterUserResult{DatabaseAlterUserResult: res},
	})
}

func finishAlterError(res *agentv1.DatabaseAlterUserResult, msg string) *agentv1.DatabaseAlterUserResult {
	res.Success = false
	res.Error = msg
	return res
}

// shellSingleQuote returns s wrapped in single quotes, with any embedded
// single quotes escaped using the standard `'\”` trick. Safe for `sh -c`.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// sqlSingleQuote returns s wrapped in single quotes for use as a SQL string
// literal. Embedded single quotes are doubled. The result is then itself
// wrapped in shellSingleQuote when interpolated into a `psql -c '...'` call.
func sqlSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// jsSingleQuote escapes for a JavaScript single-quoted string (used by mongosh).
func jsSingleQuote(s string) string {
	r := strings.ReplaceAll(s, `\`, `\\`)
	r = strings.ReplaceAll(r, `'`, `\'`)
	return "'" + r + "'"
}
