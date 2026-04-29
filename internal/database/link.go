package database

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/othmanhaba/nixway-core/internal/db"
)

// LinkWithApp augments a database_links row with the linked app's metadata so
// the UI can render the link list without an extra round trip per row.
type LinkWithApp struct {
	Link    db.DatabaseLink `json:"link"`
	AppID   uuid.UUID       `json:"app_id"`
	AppSlug string          `json:"app_slug"`
	AppName string          `json:"app_name"`
}

// LinkDatabase creates a link between a database and an app and triggers a
// re-deploy of the app so the new env vars get injected. Both entities must
// belong to the same project.
func (s *Service) LinkDatabase(ctx context.Context, databaseID, appID uuid.UUID, envPrefix string) (db.DatabaseLink, error) {
	prefix := strings.TrimSpace(envPrefix)
	if prefix == "" {
		prefix = "DATABASE"
	}

	d, err := s.queries.GetDatabase(ctx, databaseID)
	if err != nil {
		return db.DatabaseLink{}, fmt.Errorf("get database: %w", err)
	}
	app, err := s.queries.GetApp(ctx, appID)
	if err != nil {
		return db.DatabaseLink{}, fmt.Errorf("get app: %w", err)
	}
	if app.ProjectID != d.ProjectID {
		return db.DatabaseLink{}, errors.New("database and app are in different projects")
	}

	link, err := s.queries.CreateDatabaseLink(ctx, db.CreateDatabaseLinkParams{
		DatabaseID: databaseID,
		AppID:      appID,
		EnvPrefix:  prefix,
	})
	if err != nil {
		return db.DatabaseLink{}, fmt.Errorf("create link: %w", err)
	}

	// Trigger redeploy so the new env vars take effect. Failure is non-fatal
	// — the link exists and the user can manually redeploy. We log so the
	// operator notices.
	if s.redeployer != nil {
		if _, err := s.redeployer.RedeployAppLatest(ctx, appID); err != nil {
			s.logger.Warn("redeploy after link failed", "app_id", appID, "database_id", databaseID, "error", err)
		}
	}
	return link, nil
}

// UnlinkDatabase deletes a link by ID and triggers a redeploy of the
// previously-linked app to drop the env vars.
func (s *Service) UnlinkDatabase(ctx context.Context, linkID uuid.UUID) error {
	link, err := s.queries.GetDatabaseLink(ctx, linkID)
	if err != nil {
		return fmt.Errorf("get link: %w", err)
	}
	if err := s.queries.DeleteDatabaseLink(ctx, linkID); err != nil {
		return fmt.Errorf("delete link: %w", err)
	}
	if s.redeployer != nil {
		if _, err := s.redeployer.RedeployAppLatest(ctx, link.AppID); err != nil {
			s.logger.Warn("redeploy after unlink failed", "app_id", link.AppID, "link_id", linkID, "error", err)
		}
	}
	return nil
}

// ListLinks returns every link for a database with the linked app's metadata
// joined in so the UI can render names without a second call.
func (s *Service) ListLinks(ctx context.Context, databaseID uuid.UUID) ([]LinkWithApp, error) {
	rows, err := s.queries.ListDatabaseLinksByDatabase(ctx, databaseID)
	if err != nil {
		return nil, fmt.Errorf("list links: %w", err)
	}
	out := make([]LinkWithApp, 0, len(rows))
	for _, l := range rows {
		app, err := s.queries.GetApp(ctx, l.AppID)
		if err != nil {
			s.logger.Warn("link references missing app", "link_id", l.ID, "app_id", l.AppID, "error", err)
			continue
		}
		out = append(out, LinkWithApp{
			Link:    l,
			AppID:   app.ID,
			AppSlug: app.Slug,
			AppName: app.Name,
		})
	}
	return out, nil
}

// BuildEnvForApp derives the env-var map injected at deploy time from every
// database linked to this app. For each link it:
//
//  1. Loads the database row.
//  2. Decrypts the app-user password from the secrets store via BulkResolve
//     (which bypasses reveal-once).
//  3. Substitutes placeholders into the template's ConnStringFmt.
//  4. Emits {PREFIX}_URL/_HOST/_PORT/_USER/_PASSWORD/_NAME.
//
// Multiple databases may target the same app — each uses its own prefix so
// keys don't collide. If the app has no links the result is an empty map
// (never nil).
func (s *Service) BuildEnvForApp(ctx context.Context, appID uuid.UUID) (map[string]string, error) {
	out := map[string]string{}
	links, err := s.queries.ListDatabaseLinksByApp(ctx, appID)
	if err != nil {
		return out, fmt.Errorf("list app links: %w", err)
	}
	for _, link := range links {
		d, err := s.queries.GetDatabase(ctx, link.DatabaseID)
		if err != nil {
			s.logger.Warn("link references missing database; skipping", "link_id", link.ID, "database_id", link.DatabaseID, "error", err)
			continue
		}
		tmpl, ok := s.templateReg.Get(d.TemplateSlug)
		if !ok {
			s.logger.Warn("link references unknown template; skipping", "link_id", link.ID, "template", d.TemplateSlug)
			continue
		}

		// Resolve the app-user password (BulkResolve bypasses reveal-once).
		env := "database:" + d.Name
		resolved, err := s.secretSvc.BulkResolve(ctx, d.TeamID, env, []string{"APP_PASSWORD"}, nil, "system")
		if err != nil {
			s.logger.Warn("decrypt app password failed; skipping link", "link_id", link.ID, "database_id", link.DatabaseID, "error", err)
			continue
		}
		password := resolved["APP_PASSWORD"]

		host := ""
		if d.DnsRecord != nil {
			host = *d.DnsRecord
		}
		if host == "" {
			host = d.ContainerName
		}

		prefix := strings.TrimSpace(link.EnvPrefix)
		if prefix == "" {
			prefix = "DATABASE"
		}

		connStr := tmpl.ConnStringFmt
		connStr = strings.ReplaceAll(connStr, "{user}", "app_user")
		connStr = strings.ReplaceAll(connStr, "{password}", password)
		connStr = strings.ReplaceAll(connStr, "{root_password}", password)
		connStr = strings.ReplaceAll(connStr, "{host}", host)
		connStr = strings.ReplaceAll(connStr, "{port}", fmt.Sprintf("%d", d.Port))
		connStr = strings.ReplaceAll(connStr, "{dbname}", d.Name)

		out[prefix+"_URL"] = connStr
		out[prefix+"_HOST"] = host
		out[prefix+"_PORT"] = fmt.Sprintf("%d", d.Port)
		out[prefix+"_USER"] = "app_user"
		out[prefix+"_PASSWORD"] = password
		out[prefix+"_NAME"] = d.Name
	}
	return out, nil
}
