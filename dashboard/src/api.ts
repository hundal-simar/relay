import type { JobStatus } from "./types";
import type { Counts, JobView } from "./types";
import type { Metrics } from "./types";

export const API_URL = import.meta.env.VITE_API_URL as string;
export const SOCKET_ORIGIN = new URL(API_URL).origin;         

interface ApiJobRow {
  id: string | number; 
  queue_name: string;
  status: JobStatus;
  attempts: number;
  locked_by: string | null;
  updated_at: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  const body = (await res.json()) as { success: boolean; data: T };
  return body.data;
}

export async function fetchCounts(): Promise<Counts> {
  return get<Counts>("/jobs/counts");
}

export async function fetchRecentJobs(limit = 100): Promise<JobView[]> {
  const rows = await get<ApiJobRow[]>(`/jobs?limit=${limit}`);
  return rows.map((r) => ({
    id: Number(r.id),
    queue: r.queue_name,
    status: r.status,
    attempts: r.attempts,
    workerId: r.locked_by ?? undefined,
    updatedAt: new Date(r.updated_at).getTime(),
  }));
}

export async function fetchMetrics(): Promise<Metrics> {
  return get<Metrics>("/metrics");
}