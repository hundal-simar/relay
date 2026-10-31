INSERT INTO queues (name) VALUES ('emails'), ('reports')
ON CONFLICT (name) DO NOTHING;