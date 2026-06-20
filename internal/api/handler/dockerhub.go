package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/othmanhaba/nixway-core/internal/api/respond"
)

// DockerHubHandler proxies public Docker Hub search and tag listing so the
// browser doesn't hit CORS / rate-limit issues talking to Docker Hub directly.
// These endpoints expose only public registry data; they're behind auth but not
// team-scoped.
type DockerHubHandler struct {
	client *http.Client
	logger *slog.Logger
}

func NewDockerHubHandler(logger *slog.Logger) *DockerHubHandler {
	return &DockerHubHandler{
		client: &http.Client{Timeout: 10 * time.Second},
		logger: logger,
	}
}

// DockerHubImage is the slimmed-down shape we return to the UI.
type DockerHubImage struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	IsOfficial  bool   `json:"is_official"`
	StarCount   int    `json:"star_count"`
	PullCount   int64  `json:"pull_count,omitempty"`
}

// DockerHubTag is a single published tag for an image.
type DockerHubTag struct {
	Name        string `json:"name"`
	Size        int64  `json:"size,omitempty"`
	LastUpdated string `json:"last_updated,omitempty"`
}

// SearchImages searches public Docker Hub repositories.
// GET /api/v1/docker-hub/search?q=<query>
func (h *DockerHubHandler) SearchImages(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		respond.JSON(w, http.StatusOK, []DockerHubImage{})
		return
	}

	endpoint := "https://hub.docker.com/v2/search/repositories/?page_size=25&query=" + url.QueryEscape(q)

	var upstream struct {
		Results []struct {
			RepoName         string `json:"repo_name"`
			ShortDescription string `json:"short_description"`
			StarCount        int    `json:"star_count"`
			PullCount        int64  `json:"pull_count"`
			IsOfficial       bool   `json:"is_official"`
		} `json:"results"`
	}
	if err := h.getJSON(r, endpoint, &upstream); err != nil {
		h.logger.Error("docker hub search failed", "error", err, "query", q)
		respond.Error(w, http.StatusBadGateway, "failed to reach Docker Hub")
		return
	}

	images := make([]DockerHubImage, 0, len(upstream.Results))
	for _, res := range upstream.Results {
		images = append(images, DockerHubImage{
			Name:        res.RepoName,
			Description: res.ShortDescription,
			IsOfficial:  res.IsOfficial,
			StarCount:   res.StarCount,
			PullCount:   res.PullCount,
		})
	}
	respond.JSON(w, http.StatusOK, images)
}

// ListTags lists tags for a Docker Hub image.
// GET /api/v1/docker-hub/tags?image=<name>
func (h *DockerHubHandler) ListTags(w http.ResponseWriter, r *http.Request) {
	image := strings.TrimSpace(r.URL.Query().Get("image"))
	if image == "" {
		respond.Error(w, http.StatusBadRequest, "image is required")
		return
	}

	namespace, repo := splitDockerImage(image)
	if repo == "" {
		respond.Error(w, http.StatusBadRequest, "invalid image reference")
		return
	}

	endpoint := "https://hub.docker.com/v2/repositories/" +
		url.PathEscape(namespace) + "/" + url.PathEscape(repo) +
		"/tags/?page_size=50&ordering=last_updated"

	var upstream struct {
		Results []struct {
			Name        string `json:"name"`
			FullSize    int64  `json:"full_size"`
			LastUpdated string `json:"last_updated"`
		} `json:"results"`
	}
	if err := h.getJSON(r, endpoint, &upstream); err != nil {
		h.logger.Error("docker hub tags failed", "error", err, "image", image)
		respond.Error(w, http.StatusBadGateway, "failed to reach Docker Hub")
		return
	}

	tags := make([]DockerHubTag, 0, len(upstream.Results))
	for _, res := range upstream.Results {
		tags = append(tags, DockerHubTag{
			Name:        res.Name,
			Size:        res.FullSize,
			LastUpdated: res.LastUpdated,
		})
	}
	respond.JSON(w, http.StatusOK, tags)
}

// splitDockerImage normalizes a Docker Hub reference into (namespace, repo).
// Official images live under the implicit "library" namespace. Any registry
// host prefix (docker.io/) and tag suffix (:latest) are stripped.
func splitDockerImage(image string) (namespace, repo string) {
	image = strings.TrimPrefix(image, "docker.io/")
	image = strings.TrimPrefix(image, "registry-1.docker.io/")
	if i := strings.IndexByte(image, ':'); i >= 0 {
		image = image[:i]
	}
	image = strings.Trim(image, "/")
	parts := strings.SplitN(image, "/", 2)
	if len(parts) == 1 {
		return "library", parts[0]
	}
	return parts[0], parts[1]
}

func (h *DockerHubHandler) getJSON(r *http.Request, endpoint string, dst any) error {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &dockerHubStatusError{status: resp.StatusCode}
	}
	return json.NewDecoder(resp.Body).Decode(dst)
}

type dockerHubStatusError struct{ status int }

func (e *dockerHubStatusError) Error() string {
	return "docker hub returned status " + http.StatusText(e.status)
}
