package handler

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/registry"
)

type RegistryHandler struct {
	queries   *db.Queries
	audit     *audit.Writer
	validator *registry.Validator
	masterKey [32]byte
	logger    *slog.Logger
}

func NewRegistryHandler(queries *db.Queries, auditWriter *audit.Writer, validator *registry.Validator, masterKey [32]byte, logger *slog.Logger) *RegistryHandler {
	return &RegistryHandler{
		queries:   queries,
		audit:     auditWriter,
		validator: validator,
		masterKey: masterKey,
		logger:    logger,
	}
}

type registryResponse struct {
	ID           uuid.UUID  `json:"id"`
	TeamID       uuid.UUID  `json:"team_id"`
	Name         string     `json:"name"`
	RegistryType string     `json:"registry_type"`
	RegistryURL  string     `json:"registry_url"`
	Username     string     `json:"username"`
	Region       *string    `json:"region,omitempty"`
	ValidatedAt  *time.Time `json:"validated_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

func toRegistryResponse(c db.RegistryCredential) registryResponse {
	r := registryResponse{
		ID:           c.ID,
		TeamID:       c.TeamID,
		Name:         c.Name,
		RegistryType: c.RegistryType,
		RegistryURL:  c.RegistryUrl,
		Username:     c.Username,
		Region:       c.Region,
		CreatedAt:    c.CreatedAt,
		UpdatedAt:    c.UpdatedAt,
	}
	if c.ValidatedAt.Valid {
		t := c.ValidatedAt.Time
		r.ValidatedAt = &t
	}
	return r
}

type createRegistryRequest struct {
	Name               string  `json:"name"`
	RegistryType       string  `json:"registry_type"`
	RegistryURL        string  `json:"registry_url"`
	Username           string  `json:"username"`
	Password           string  `json:"password"`
	Region             *string `json:"region"`
	AwsAccessKeyID     *string `json:"aws_access_key_id"`
	AwsSecretAccessKey string  `json:"aws_secret_access_key"`
}

func ecrURL(region string) string {
	return fmt.Sprintf("https://%s.dkr.ecr.%s.amazonaws.com", "aws_account_id", region)
}

func defaultRegistryURL(registryType, region string) string {
	switch registryType {
	case "dockerhub":
		return "https://registry-1.docker.io"
	case "ghcr":
		return "https://ghcr.io"
	case "ecr":
		if region != "" {
			return fmt.Sprintf("https://ecr.%s.amazonaws.com", region)
		}
		return "https://ecr.amazonaws.com"
	default:
		return ""
	}
}

func (h *RegistryHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	var req createRegistryRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" || req.RegistryType == "" {
		respond.Error(w, http.StatusBadRequest, "name and registry_type are required")
		return
	}

	if req.RegistryURL == "" {
		region := ""
		if req.Region != nil {
			region = *req.Region
		}
		req.RegistryURL = defaultRegistryURL(req.RegistryType, region)
	}

	region := ""
	if req.Region != nil {
		region = *req.Region
	}
	awsAccessKeyID := ""
	if req.AwsAccessKeyID != nil {
		awsAccessKeyID = *req.AwsAccessKeyID
	}
	if err := h.validator.Validate(r.Context(), req.RegistryType, req.RegistryURL, req.Username, req.Password, region, awsAccessKeyID, req.AwsSecretAccessKey); err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	encCtx := "registry:" + teamID.String()
	encPassword, err := crypto.Encrypt([]byte(req.Password), h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to encrypt registry password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	var encAWSSecret []byte
	if req.RegistryType == "ecr" && req.AwsSecretAccessKey != "" {
		encAWSSecret, err = crypto.Encrypt([]byte(req.AwsSecretAccessKey), h.masterKey, encCtx)
		if err != nil {
			h.logger.Error("failed to encrypt AWS secret", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}

	cred, err := h.queries.CreateRegistryCredential(r.Context(), db.CreateRegistryCredentialParams{
		TeamID:             teamID,
		Name:               req.Name,
		RegistryType:       req.RegistryType,
		RegistryUrl:        req.RegistryURL,
		Username:           req.Username,
		Password:           encPassword,
		Region:             req.Region,
		AwsAccessKeyID:     req.AwsAccessKeyID,
		AwsSecretAccessKey: encAWSSecret,
	})
	if err != nil {
		h.logger.Error("failed to create registry credential", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "registry.create",
		ResourceType: "registry_credential",
		ResourceID:   &cred.ID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusCreated, toRegistryResponse(cred))
}

func (h *RegistryHandler) List(w http.ResponseWriter, r *http.Request) {
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

	creds, err := h.queries.ListRegistryCredentials(r.Context(), teamID)
	if err != nil {
		h.logger.Error("failed to list registry credentials", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	resp := make([]registryResponse, 0, len(creds))
	for _, c := range creds {
		resp = append(resp, toRegistryResponse(c))
	}

	respond.JSON(w, http.StatusOK, resp)
}

func (h *RegistryHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	registryID, err := uuid.Parse(r.PathValue("registryId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid registry ID")
		return
	}

	cred, err := h.queries.GetRegistryCredentialByID(r.Context(), db.GetRegistryCredentialByIDParams{
		ID:     registryID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "registry credential not found")
		return
	}

	respond.JSON(w, http.StatusOK, toRegistryResponse(cred))
}

func (h *RegistryHandler) Update(w http.ResponseWriter, r *http.Request) {
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

	registryID, err := uuid.Parse(r.PathValue("registryId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid registry ID")
		return
	}

	var req createRegistryRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" || req.RegistryType == "" {
		respond.Error(w, http.StatusBadRequest, "name and registry_type are required")
		return
	}

	if req.RegistryURL == "" {
		region := ""
		if req.Region != nil {
			region = *req.Region
		}
		req.RegistryURL = defaultRegistryURL(req.RegistryType, region)
	}

	region := ""
	if req.Region != nil {
		region = *req.Region
	}
	awsAccessKeyID := ""
	if req.AwsAccessKeyID != nil {
		awsAccessKeyID = *req.AwsAccessKeyID
	}
	if err := h.validator.Validate(r.Context(), req.RegistryType, req.RegistryURL, req.Username, req.Password, region, awsAccessKeyID, req.AwsSecretAccessKey); err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	encCtx := "registry:" + teamID.String()
	encPassword, err := crypto.Encrypt([]byte(req.Password), h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to encrypt registry password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	var encAWSSecret []byte
	if req.RegistryType == "ecr" && req.AwsSecretAccessKey != "" {
		encAWSSecret, err = crypto.Encrypt([]byte(req.AwsSecretAccessKey), h.masterKey, encCtx)
		if err != nil {
			h.logger.Error("failed to encrypt AWS secret", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}

	cred, err := h.queries.UpdateRegistryCredential(r.Context(), db.UpdateRegistryCredentialParams{
		ID:                 registryID,
		TeamID:             teamID,
		Name:               req.Name,
		RegistryType:       req.RegistryType,
		RegistryUrl:        req.RegistryURL,
		Username:           req.Username,
		Password:           encPassword,
		Region:             req.Region,
		AwsAccessKeyID:     req.AwsAccessKeyID,
		AwsSecretAccessKey: encAWSSecret,
		ValidatedAt:        pgtype.Timestamptz{Valid: false},
	})
	if err != nil {
		h.logger.Error("failed to update registry credential", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "registry.update",
		ResourceType: "registry_credential",
		ResourceID:   &registryID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusOK, toRegistryResponse(cred))
}

func (h *RegistryHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	registryID, err := uuid.Parse(r.PathValue("registryId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid registry ID")
		return
	}

	if err := h.queries.DeleteRegistryCredential(r.Context(), db.DeleteRegistryCredentialParams{
		ID:     registryID,
		TeamID: teamID,
	}); err != nil {
		h.logger.Error("failed to delete registry credential", "error", err)
		respond.Error(w, http.StatusInternalServerError, "failed to delete registry credential")
		return
	}

	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "registry.delete",
		ResourceType: "registry_credential",
		ResourceID:   &registryID,
		IPAddress:    parseIP(r),
	})

	respond.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *RegistryHandler) Revalidate(w http.ResponseWriter, r *http.Request) {
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

	registryID, err := uuid.Parse(r.PathValue("registryId"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid registry ID")
		return
	}

	cred, err := h.queries.GetRegistryCredentialByID(r.Context(), db.GetRegistryCredentialByIDParams{
		ID:     registryID,
		TeamID: teamID,
	})
	if err != nil {
		respond.Error(w, http.StatusNotFound, "registry credential not found")
		return
	}

	encCtx := "registry:" + teamID.String()
	password, err := crypto.Decrypt(cred.Password, h.masterKey, encCtx)
	if err != nil {
		h.logger.Error("failed to decrypt registry password", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	awsSecretAccessKey := ""
	if len(cred.AwsSecretAccessKey) > 0 {
		dec, err := crypto.Decrypt(cred.AwsSecretAccessKey, h.masterKey, encCtx)
		if err != nil {
			h.logger.Error("failed to decrypt AWS secret", "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}
		awsSecretAccessKey = string(dec)
	}

	region := ""
	if cred.Region != nil {
		region = *cred.Region
	}
	awsAccessKeyID := ""
	if cred.AwsAccessKeyID != nil {
		awsAccessKeyID = *cred.AwsAccessKeyID
	}

	if err := h.validator.Validate(r.Context(), cred.RegistryType, cred.RegistryUrl, cred.Username, string(password), region, awsAccessKeyID, awsSecretAccessKey); err != nil {
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	if err := h.queries.UpdateRegistryValidatedAt(r.Context(), registryID); err != nil {
		h.logger.Error("failed to update validated_at", "error", err)
		respond.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}

	respond.JSON(w, http.StatusOK, map[string]string{"status": "valid"})
}
