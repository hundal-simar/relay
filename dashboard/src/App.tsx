import { useState } from "react";
import { useJobFeed } from "./useJobFeed";
import { useMetrics } from "./useMetrics";
import MetricsPanel from "./MetricsPanel";
import type { JobStatus } from "./types";

const STATUSES: JobStatus[] = ["pending", "processing", "completed", "failed"];
type Filter = "all" | JobStatus;
const FILTERS: Filter[] = ["all", ...STATUSES];

const CARD_BORDER: Record<JobStatus, string> = {
  pending: "border-t-yellow-400",
  processing: "border-t-blue-400",
  completed: "border-t-green-400",
  failed: "border-t-red-400",
};

const BADGE: Record<JobStatus, string> = {
  pending: "bg-yellow-400/10 text-yellow-400",
  processing: "bg-blue-400/10 text-blue-400",
  completed: "bg-green-400/10 text-green-400",
  failed: "bg-red-400/10 text-red-400",
};

export default function App() {
  const { jobs, counts, connected } = useJobFeed();
  const { metrics, error: metricsError } = useMetrics();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Forge</h1>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-medium ${
              connected ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            {connected ? "Live" : "Disconnected"}
          </span>
        </header>

        {(!connected || metricsError) && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {!connected
              ? "Lost connection to the server. Reconnecting; data will refresh automatically."
              : "Metrics are temporarily unavailable."}
          </div>
        )}

        <section className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <div key={s} className={`rounded-lg border-t-4 bg-slate-900 p-4 ${CARD_BORDER[s]}`}>
              <div className="text-xs uppercase tracking-wide text-slate-400">{s}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {counts ? counts[s].toLocaleString() : "-"}
              </div>
            </div>
          ))}
        </section>

        <MetricsPanel metrics={metrics} />

        <div className="mb-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${
                filter === f
                  ? "bg-slate-200 text-slate-900"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-slate-500">
            Showing {visible.length} of latest {jobs.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Worker</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    {jobs.length === 0
                      ? "No jobs yet. Enqueue one to see it appear."
                      : `No ${filter} jobs in the latest ${jobs.length}.`}
                  </td>
                </tr>
              )}
              {visible.map((j) => {
                const fresh = Date.now() - j.updatedAt < 1500;
                return (
                  <tr
                    key={`${j.id}-${j.updatedAt}`} // new key on update retriggers the flash
                    className={`border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40 ${
                      fresh ? "animate-flash" : ""
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums">{j.id}</td>
                    <td className="px-3 py-2">{j.queue}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${BADGE[j.status]}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{j.attempts}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {j.workerId ?? "-"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-400">
                      {new Date(j.updatedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}