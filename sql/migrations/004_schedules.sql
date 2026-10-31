CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules (next_run_at) WHERE enabled;