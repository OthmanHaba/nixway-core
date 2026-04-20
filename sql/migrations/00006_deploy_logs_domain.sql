-- +goose Up

-- Add logs column to deployments (same pattern as builds)
ALTER TABLE deployments ADD COLUMN logs TEXT NOT NULL DEFAULT '';

-- Store the auto-generated platform domain on each deployment
ALTER TABLE deployments ADD COLUMN platform_domain TEXT NOT NULL DEFAULT '';

-- Allow multiple domains per app (JSON array instead of single custom_domain)
ALTER TABLE apps ADD COLUMN domains TEXT[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE apps DROP COLUMN IF EXISTS domains;
ALTER TABLE deployments DROP COLUMN IF EXISTS platform_domain;
ALTER TABLE deployments DROP COLUMN IF EXISTS logs;
