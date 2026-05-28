-- +goose Up
-- +goose StatementBegin
ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_status_check;
ALTER TABLE deployments
    ADD CONSTRAINT deployments_status_check
    CHECK (status IN ('pending', 'deploying', 'healthy', 'degraded', 'failed', 'rolled_back', 'superseded', 'archived'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE deployments SET status = 'rolled_back' WHERE status IN ('superseded', 'archived');
ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_status_check;
ALTER TABLE deployments
    ADD CONSTRAINT deployments_status_check
    CHECK (status IN ('pending', 'deploying', 'healthy', 'degraded', 'failed', 'rolled_back'));
-- +goose StatementEnd
