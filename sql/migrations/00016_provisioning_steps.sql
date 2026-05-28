-- +goose Up

-- Per-component progress on a provisioning job. The service writes the
-- full array on every transition (pending -> running -> succeeded/failed)
-- so the UI can render a checklist + duration without parsing log lines.
-- Stored as JSONB to keep the row count flat (one job = one row).
ALTER TABLE provisioning_jobs
    ADD COLUMN steps JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +goose Down
ALTER TABLE provisioning_jobs DROP COLUMN IF EXISTS steps;
