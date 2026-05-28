package handler

import (
	"log/slog"
	"net/http"

	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/template"
)

// TemplateHandler exposes the static service template catalog (databases,
// caches, queues, storage, search). Endpoints are platform-wide and
// read-only: any authenticated caller can browse the catalog.
type TemplateHandler struct {
	registry *template.Registry
	logger   *slog.Logger
}

func NewTemplateHandler(registry *template.Registry, logger *slog.Logger) *TemplateHandler {
	return &TemplateHandler{registry: registry, logger: logger}
}

// templateSummary is the metadata-only view returned by List, omitting the
// per-version detail to keep the payload small.
type templateSummary struct {
	Slug             string              `json:"slug"`
	Name             string              `json:"name"`
	Category         string              `json:"category"`
	Description      string              `json:"description,omitempty"`
	Ports            []int               `json:"ports"`
	DefaultResources template.Resources  `json:"default_resources"`
	VolumeSpec       template.VolumeSpec `json:"volume_spec"`
	CredentialPolicy string              `json:"credential_policy"`
	VersionCount     int                 `json:"version_count"`
	Versions         []template.Version  `json:"versions"`
}

// List returns metadata for every template in the catalog.
// GET /api/v1/templates
func (h *TemplateHandler) List(w http.ResponseWriter, r *http.Request) {
	templates := h.registry.List()
	out := make([]templateSummary, 0, len(templates))
	for _, t := range templates {
		out = append(out, templateSummary{
			Slug:             t.Slug,
			Name:             t.Name,
			Category:         t.Category,
			Description:      t.Description,
			Ports:            t.Ports,
			DefaultResources: t.DefaultResources,
			VolumeSpec:       t.VolumeSpec,
			CredentialPolicy: t.CredentialPolicy,
			VersionCount:     len(t.Versions),
			Versions:         t.Versions,
		})
	}
	respond.JSON(w, http.StatusOK, out)
}

// Get returns the full details of a single template, including all versions.
// GET /api/v1/templates/{slug}
func (h *TemplateHandler) Get(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		respond.Error(w, http.StatusBadRequest, "slug is required")
		return
	}
	tmpl, ok := h.registry.Get(slug)
	if !ok {
		respond.Error(w, http.StatusNotFound, "template not found")
		return
	}
	respond.JSON(w, http.StatusOK, tmpl)
}

// ListVersions returns the version list for a single template.
// GET /api/v1/templates/{slug}/versions
func (h *TemplateHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		respond.Error(w, http.StatusBadRequest, "slug is required")
		return
	}
	tmpl, ok := h.registry.Get(slug)
	if !ok {
		respond.Error(w, http.StatusNotFound, "template not found")
		return
	}
	respond.JSON(w, http.StatusOK, tmpl.Versions)
}
