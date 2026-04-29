// Package template provides the static catalog of service templates
// (databases, caches, queues, storage, search) that users can provision.
//
// Templates are defined in Go (see templates.go) rather than stored in the
// database so they ship with the binary and stay version-controlled. To add
// or update a template, edit templates.go and rebuild.
package template

import "fmt"

// Template describes a provisionable service (e.g. PostgreSQL, Redis).
type Template struct {
	Slug             string            `json:"slug"`
	Name             string            `json:"name"`
	Category         string            `json:"category"` // database, cache, queue, storage, search
	Description      string            `json:"description,omitempty"`
	Versions         []Version         `json:"versions"`
	DefaultResources Resources         `json:"default_resources"`
	VolumeSpec       VolumeSpec        `json:"volume_spec"`
	Ports            []int             `json:"ports"`
	HealthCheck      HealthCheck       `json:"health_check"`
	ConnStringFmt    string            `json:"conn_string_fmt"`
	EnvTemplate      map[string]string `json:"env_template"`
	CredentialPolicy string            `json:"credential_policy"` // always "generated" in v1
	ShellCommand     string            `json:"shell_command"`
	Command          string            `json:"command,omitempty"` // optional container CMD override
}

// Version describes a single supported version of a template.
type Version struct {
	Version string `json:"version"` // e.g. "16", "8.0", "latest"
	Image   string `json:"image"`   // full image reference, e.g. "postgres:16-alpine"
	Default bool   `json:"default,omitempty"`
}

// Resources describes default CPU/memory allocation for a service.
type Resources struct {
	MilliCPU int `json:"milli_cpu"` // 1000 = 1 vCPU
	MemoryMB int `json:"memory_mb"`
}

// VolumeSpec describes the persistent volume a service expects.
type VolumeSpec struct {
	MountPath  string `json:"mount_path"`
	DefaultGiB int    `json:"default_gib,omitempty"`
}

// HealthCheck describes how to verify a service is alive.
type HealthCheck struct {
	Command  string `json:"command"`            // shell command to execute inside the container
	Interval int    `json:"interval,omitempty"` // seconds
	Timeout  int    `json:"timeout,omitempty"`  // seconds
	Retries  int    `json:"retries,omitempty"`
}

// Registry is a read-only catalog of service templates.
type Registry struct {
	templates []Template
	bySlug    map[string]int
}

// NewRegistry returns the default registry populated with the built-in
// template catalog defined in templates.go.
func NewRegistry() *Registry {
	r := &Registry{
		templates: builtinTemplates(),
	}
	r.bySlug = make(map[string]int, len(r.templates))
	for i, t := range r.templates {
		r.bySlug[t.Slug] = i
	}
	return r
}

// List returns all templates in the catalog.
func (r *Registry) List() []Template {
	if r == nil {
		return nil
	}
	out := make([]Template, len(r.templates))
	copy(out, r.templates)
	return out
}

// Get returns the template with the given slug. The second return value is
// false when no template matches.
func (r *Registry) Get(slug string) (Template, bool) {
	if r == nil {
		return Template{}, false
	}
	idx, ok := r.bySlug[slug]
	if !ok {
		return Template{}, false
	}
	return r.templates[idx], true
}

// GetVersion returns the specific Version for a template slug. Returns an
// error when either the slug or version is unknown.
func (r *Registry) GetVersion(slug, version string) (Version, error) {
	tmpl, ok := r.Get(slug)
	if !ok {
		return Version{}, fmt.Errorf("template not found: %s", slug)
	}
	for _, v := range tmpl.Versions {
		if v.Version == version {
			return v, nil
		}
	}
	return Version{}, fmt.Errorf("version %q not found for template %q", version, slug)
}
