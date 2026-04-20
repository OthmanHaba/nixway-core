package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/ssh"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// TerminalHandler handles WebSocket-based SSH terminal sessions.
type TerminalHandler struct {
	queries   *db.Queries
	logger    *slog.Logger
	masterKey [32]byte
}

func NewTerminalHandler(queries *db.Queries, logger *slog.Logger, masterKey [32]byte) *TerminalHandler {
	return &TerminalHandler{queries: queries, logger: logger, masterKey: masterKey}
}

// wsMessage represents a message from the browser terminal.
type wsMessage struct {
	Type string `json:"type"` // "input", "resize"
	Data string `json:"data"` // input characters
	Cols int    `json:"cols"` // for resize
	Rows int    `json:"rows"` // for resize
}

// Connect upgrades to WebSocket and bridges to an SSH PTY session.
// GET /api/v1/teams/{id}/servers/{serverId}/terminal
func (h *TerminalHandler) Connect(w http.ResponseWriter, r *http.Request) {
	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid team id", http.StatusBadRequest)
		return
	}
	serverID, err := uuid.Parse(r.PathValue("serverId"))
	if err != nil {
		http.Error(w, "invalid server id", http.StatusBadRequest)
		return
	}

	// Get server details.
	srv, err := h.queries.GetServerByID(r.Context(), db.GetServerByIDParams{
		ID:     serverID,
		TeamID: teamID,
	})
	if err != nil {
		h.logger.Error("terminal: server not found", "server_id", serverID, "error", err)
		http.Error(w, "server not found", http.StatusNotFound)
		return
	}

	// Get and decrypt SSH key.
	sshKey, err := h.queries.GetSSHKeyForServer(r.Context(), serverID)
	if err != nil {
		h.logger.Error("terminal: ssh key not found", "server_id", serverID, "error", err)
		http.Error(w, "ssh key not found for server", http.StatusNotFound)
		return
	}

	privateKey, err := crypto.Decrypt(sshKey.PrivateKeyEncrypted, h.masterKey, "ssh-private-key")
	if err != nil {
		h.logger.Error("terminal: decrypt ssh key failed", "error", err)
		http.Error(w, "failed to decrypt ssh key", http.StatusInternalServerError)
		return
	}

	// Create SSH client.
	client, err := ssh.NewClient(srv.Hostname, int(srv.SshPort), srv.SshUser, privateKey)
	if err != nil {
		h.logger.Error("terminal: ssh client failed", "error", err)
		http.Error(w, "failed to connect via SSH", http.StatusBadGateway)
		return
	}

	// Upgrade to WebSocket.
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("terminal: websocket upgrade failed", "error", err)
		return
	}
	defer ws.Close()

	h.logger.Info("terminal session started", "server_id", serverID, "hostname", srv.Hostname)

	// Start interactive SSH session.
	session, err := client.StartInteractiveSession(120, 40)
	if err != nil {
		h.logger.Error("terminal: ssh session failed", "error", err)
		ws.WriteMessage(websocket.TextMessage, []byte("\r\nFailed to start SSH session: "+err.Error()+"\r\n"))
		return
	}
	defer session.Close()

	// SSH stdout -> WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := session.Stdout.Read(buf)
			if n > 0 {
				if writeErr := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket -> SSH stdin
	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			h.logger.Debug("terminal: websocket read error", "error", err)
			break
		}

		var msg wsMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			// Raw text input (fallback)
			session.Stdin.Write(message)
			continue
		}

		switch msg.Type {
		case "input":
			session.Stdin.Write([]byte(msg.Data))
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				session.Resize(msg.Cols, msg.Rows)
			}
		}
	}

	h.logger.Info("terminal session ended", "server_id", serverID)
}
