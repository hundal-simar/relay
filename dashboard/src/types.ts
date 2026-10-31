export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobEvent {
  type: "enqueued" | "started" | "completed" | "retrying" | "failed" | "reclaimed";
  jobId: number;
  queue: string;
  status: JobStatus;
  attempts: number;
  workerId?: string;
  timestamp: string;
}

export interface JobView {
  id: number;
  queue: string;
  status: JobStatus;
  attempts: number;
  workerId?: string;
  updatedAt: number; 
}

export type Counts = Record<JobStatus, number>;

export interface QueueMetrics {
  name: string;
  depth: number;
  processing: number;
  doneLastMinute: number;
  failed: number;
  ratePerSec: number | null
}

export interface Metrics {
  windowSec: number;
  queueDepth: number;
  scheduled: number;
  processing: number;
  throughputPerSec: number;
  avgProcessingMs: number | null;
  p95ProcessingMs: number | null;
  failureRate: number | null;
  throughputSeries: number[];
  queues: QueueMetrics[];
}