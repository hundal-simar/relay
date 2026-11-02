import { z } from "zod";

export const JOB_EVENTS_CHANNEL = "relay:job-events";

export const jobEventSchema = z.object({
  type: z.enum(["enqueued", "started", "completed", "retrying", "failed", "reclaimed"]),
  jobId: z.number(),
  queue: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  attempts: z.number(),
  workerId: z.string().optional(),
  timestamp: z.string(),
});

export type JobEvent = z.infer<typeof jobEventSchema>;
export type JobEventType = JobEvent["type"];