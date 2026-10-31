import {z} from "zod";

export const createJobSchema = z.object({
     queueName: z.string().min(1),
     payload: z.record(z.string(), z.unknown()),
     maxAttempts: z.number().int().positive().optional(),
     runAt: z.string().datetime().optional(), // ISO string from client
   });

export type CreateJobInput = z.infer<typeof createJobSchema>;