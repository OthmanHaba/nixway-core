package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strconv"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/redis/go-redis/v9"

	"github.com/othmanhaba/nixway-core/internal/agent"
	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type ContainerTerminalHandler struct {
	queries *db.Queries
	connMgr *agent.ConnManager
	redis   *redis.Client
	logger  *slog.Logger
}

func NewContainerTerminalHandler(queries *db.Queries, connMgr *agent.ConnManager, redisClient *redis.Client, logger *slog.Logger) *ContainerTerminalHandler {
	return &ContainerTerminalHandler{
		queries: queries,
		connMgr: connMgr,
		redis:   redisClient,
		logger:  logger,
	}
}

// Connect handles GET /api/v1/apps/{appId}/terminal?replica=N
func (h *ContainerTerminalHandler) Connect(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}

	appID, err := uuid.Parse(r.PathValue("appId"))
	if err != nil {
		http.Error(w, "invalid app ID", http.StatusBadRequest)
		return
	}

	// Find active containers for this app
	containers, err := h.queries.ListActiveContainersByApp(r.Context(), appID)
	if err != nil || len(containers) == 0 {
		http.Error(w, "no running containers found", http.StatusNotFound)
		return
	}

	// Select replica
	replicaIdx := 0
	if r := r.URL.Query().Get("replica"); r != "" {
		if v, err := strconv.Atoi(r); err == nil && v >= 0 && v < len(containers) {
			replicaIdx = v
		}
	}

	target := containers[replicaIdx]
	if target.AgentID == nil {
		http.Error(w, "agent not available for this replica", http.StatusServiceUnavailable)
		return
	}
	agentID := *target.AgentID

	// Get app for container name
	app, err := h.queries.GetApp(r.Context(), appID)
	if err != nil {
		http.Error(w, "app not found", http.StatusNotFound)
		return
	}

	// Find the deployment for this container to build the container name
	deploys, err := h.queries.ListDeploymentsByApp(r.Context(), db.ListDeploymentsByAppParams{
		AppID: appID, Limit: 1, Offset: 0,
	})
	if err != nil || len(deploys) == 0 {
		http.Error(w, "no deployments found", http.StatusNotFound)
		return
	}

	containerName := fmt.Sprintf("nixway-%s-%s", app.Slug, deploys[0].ID.String()[:8])

	// Create terminal session audit record
	replicaInt := int32(replicaIdx)
	teamID := uuid.Nil
	if authCtx.TeamID != nil {
		teamID = *authCtx.TeamID
	}
	session, err := h.queries.CreateTerminalSession(r.Context(), db.CreateTerminalSessionParams{
		TeamID:        teamID,
		UserID:        authCtx.UserID,
		AppID:         pgtype.UUID{Bytes: appID, Valid: true},
		ServerID:      target.ServerID,
		ContainerName: &containerName,
		ReplicaIndex:  &replicaInt,
		SessionType:   "container_exec",
		ClientIp:      parseClientIP(r),
	})
	if err != nil {
		h.logger.Error("failed to create terminal session", "error", err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	// Upgrade to WebSocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("container terminal: websocket upgrade failed", "error", err)
		return
	}
	defer func() {
		ws.Close()
		_ = h.queries.EndTerminalSession(r.Context(), session.ID)
	}()

	sessionID := uuid.New().String()

	// Subscribe to exec output via Redis
	channel := "exec:" + sessionID
	sub := h.redis.Subscribe(r.Context(), channel)
	defer sub.Close()

	// Send exec command to agent
	err = h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerExec{
			ContainerExec: &agentv1.ContainerExecCommand{
				SessionId:     sessionID,
				ContainerName: containerName,
				Command:       "/bin/sh",
				Cols:          120,
				Rows:          40,
			},
		},
	})
	if err != nil {
		h.logger.Error("failed to send exec command", "error", err)
		ws.WriteMessage(websocket.TextMessage, []byte("Failed to start exec session: "+err.Error()))
		return
	}

	h.logger.Info("container exec session started",
		"session_id", sessionID,
		"app_id", appID,
		"container", containerName,
	)

	// Redis exec output -> WebSocket
	ch := sub.Channel()
	go func() {
		for msg := range ch {
			if msg.Payload == "__done__" {
				ws.WriteMessage(websocket.TextMessage, []byte("\r\nSession ended.\r\n"))
				ws.Close()
				return
			}
			ws.WriteMessage(websocket.BinaryMessage, []byte(msg.Payload))
		}
	}()

	// WebSocket -> Agent exec input
	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			break
		}

		var msg wsMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			// Raw binary input
			h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
				Payload: &agentv1.ControlMessage_ContainerExecInput{
					ContainerExecInput: &agentv1.ContainerExecInput{
						SessionId: sessionID,
						Data:      message,
					},
				},
			})
			continue
		}

		switch msg.Type {
		case "input":
			h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
				Payload: &agentv1.ControlMessage_ContainerExecInput{
					ContainerExecInput: &agentv1.ContainerExecInput{
						SessionId: sessionID,
						Data:      []byte(msg.Data),
					},
				},
			})
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
					Payload: &agentv1.ControlMessage_ContainerExecInput{
						ContainerExecInput: &agentv1.ContainerExecInput{
							SessionId: sessionID,
							Cols:      int32(msg.Cols),
							Rows:      int32(msg.Rows),
						},
					},
				})
			}
		}
	}

	// Close exec session on agent
	h.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{
		Payload: &agentv1.ControlMessage_ContainerExecInput{
			ContainerExecInput: &agentv1.ContainerExecInput{
				SessionId: sessionID,
				Close:     true,
			},
		},
	})

	h.logger.Info("container exec session ended", "session_id", sessionID)
}

func parseClientIP(r *http.Request) *netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return nil
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return nil
	}
	return &addr
}
