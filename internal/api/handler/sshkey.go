package handler

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/ssh"
)

type SSHKeyHandler struct {
	queries   *db.Queries
	audit     *audit.Writer
	logger    *slog.Logger
	masterKey [32]byte
}

func NewSSHKeyHandler(queries *db.Queries, auditWriter *audit.Writer, logger *slog.Logger, masterKey [32]byte) *SSHKeyHandler {
	return &SSHKeyHandler{
		queries:   queries,
		audit:     auditWriter,
		logger:    logger,
		masterKey: masterKey,
	}
}

type createSSHKeyRequest struct {
	Name       string `json:"name"`
	KeyType    string `json:"key_type"`
	PublicKey  string `json:"public_key"`
	PrivateKey string `json:"private_key"`
}

type sshKeyResponse struct {
	ID          uuid.UUID `json:"id"`
	TeamID      uuid.UUID `json:"team_id"`
	Name        string    `json:"name"`
	PublicKey   string    `json:"public_key"`
	KeyType     string    `json:"key_type"`
	Fingerprint string    `json:"fingerprint"`
	CreatedAt   string    `json:"created_at"`
}

func (h *SSHKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	var req createSSHKeyRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	var pubKeyBytes, privKeyBytes []byte

	if req.PublicKey != "" && req.PrivateKey != "" {
		// Upload existing key pair
		pubKeyBytes = []byte(req.PublicKey)
		privKeyBytes = []byte(req.PrivateKey)
		if req.KeyType == "" {
			req.KeyType = "ed25519"
		}
	} else {
		// Generate new key pair
		if req.KeyType == "" {
			req.KeyType = "ed25519"
		}
		if req.KeyType != "ed25519" && req.KeyType != "rsa" {
			respond.Error(w, http.StatusBadRequest, "key_type must be ed25519 or rsa")
			return
		}
		pub, priv, genErr := ssh.GenerateKeyPair(req.KeyType)
		if genErr != nil {
			h.logger.Error("failed to generate key pair", "error", genErr)
			respond.Error(w, http.StatusInternalServerError, "failed to generate key pair")
			return
		}
		pubKeyBytes = pub
		privKeyBytes = priv
	}

	fingerprint, err := ssh.Fingerprint(pubKeyBytes)
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid public key")
		return
	}

	encrypted, err := crypto.Encrypt(privKeyBytes, h.masterKey, "ssh-private-key")
	if err != nil {
		h.logger.Error("failed to encrypt private key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	key, err := h.queries.CreateSSHKey(r.Context(), db.CreateSSHKeyParams{
		TeamID:              teamID,
		Name:                req.Name,
		PublicKey:           string(pubKeyBytes),
		PrivateKeyEncrypted: encrypted,
		KeyType:             req.KeyType,
		Fingerprint:         fingerprint,
	})
	if err != nil {
		h.logger.Error("failed to create ssh key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to create ssh key")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "ssh_key.create",
		ResourceType: "ssh_key",
		ResourceID:   &key.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, sshKeyResponse{
		ID:          key.ID,
		TeamID:      key.TeamID,
		Name:        key.Name,
		PublicKey:   key.PublicKey,
		KeyType:     key.KeyType,
		Fingerprint: key.Fingerprint,
		CreatedAt:   key.CreatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

func (h *SSHKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	keys, err := h.queries.ListSSHKeysByTeam(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list ssh keys", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]sshKeyResponse, len(keys))
	for i, k := range keys {
		result[i] = sshKeyResponse{
			ID:          k.ID,
			TeamID:      k.TeamID,
			Name:        k.Name,
			PublicKey:   k.PublicKey,
			KeyType:     k.KeyType,
			Fingerprint: k.Fingerprint,
			CreatedAt:   k.CreatedAt.Format("2006-01-02T15:04:05Z"),
		}
	}

	respond.JSON(w, http.StatusOK, result)
}

func (h *SSHKeyHandler) Get(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	keyID, err := uuid.Parse(r.PathValue("keyID"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid key ID")
		return
	}

	key, err := h.queries.GetSSHKeyByID(r.Context(), db.GetSSHKeyByIDParams{
		ID:     keyID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "ssh key not found")
		return
	}

	respond.JSON(w, http.StatusOK, sshKeyResponse{
		ID:          key.ID,
		TeamID:      key.TeamID,
		Name:        key.Name,
		PublicKey:   key.PublicKey,
		KeyType:     key.KeyType,
		Fingerprint: key.Fingerprint,
		CreatedAt:   key.CreatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

func (h *SSHKeyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	keyID, err := uuid.Parse(r.PathValue("keyID"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid key ID")
		return
	}

	err = h.queries.DeleteSSHKey(r.Context(), db.DeleteSSHKeyParams{
		ID:     keyID,
		TeamID: teamID,
	})
	if err != nil {
		h.logger.Error("failed to delete ssh key", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete ssh key")
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "ssh_key.delete",
		ResourceType: "ssh_key",
		ResourceID:   &keyID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
