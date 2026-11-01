
-- Add the foreign key if it does not already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_executions_job_id_fkey'
      AND conrelid = 'job_executions'::regclass
  ) THEN
    ALTER TABLE job_executions
    ADD CONSTRAINT job_executions_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs(id);
  END IF;
END $$;

-- Create the index if it does not already exist.
CREATE INDEX IF NOT EXISTS idx_job_executions_job_id
ON job_executions(job_id);
