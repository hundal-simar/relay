CREATE TABLE job_executions (
    id SERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES jobs(id),
    worker_id TEXT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_executions_job_id
ON job_executions(job_id);