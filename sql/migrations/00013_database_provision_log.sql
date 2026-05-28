-- Persistent provision log + last error so the dashboard can replay
-- what happened during a database provision after the live SSE has ended.
ALTER TABLE databases
    ADD COLUMN provision_log  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN error_message  TEXT;
