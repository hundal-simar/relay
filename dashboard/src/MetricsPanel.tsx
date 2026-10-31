import type { Metrics } from "./types";

function formatMs(ms: number | null): string {
  if (ms === null) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function formatPct(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(1)}%`;
}

function Stat({
  label,
  value,
  sub,
  tone = "text-slate-100",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function MetricsPanel({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) {
    return <div className="my-5 text-sm text-slate-500">Loading metrics...</div>;
  }

  const max = Math.max(1, ...metrics.throughputSeries);
  const failureTone =
    metrics.failureRate !== null && metrics.failureRate > 0.05
      ? "text-red-400"
      : "text-slate-100";

  return (
    <section className="my-5 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Queue depth"
          value={metrics.queueDepth.toLocaleString()}
          sub={`${metrics.scheduled.toLocaleString()} scheduled · ${metrics.processing} running`}
        />
        <Stat
          label="Throughput"
          value={`${metrics.throughputPerSec.toFixed(1)}/s`}
          sub="last 60s"
        />
        <Stat
          label="Avg time"
          value={formatMs(metrics.avgProcessingMs)}
          sub={`last ${Math.round(metrics.windowSec / 60)} min`}
        />
        <Stat label="p95 time" value={formatMs(metrics.p95ProcessingMs)} />
        <Stat
          label="Failure rate"
          value={formatPct(metrics.failureRate)}
          sub="dead-lettered"
          tone={failureTone}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-900 p-4">
          <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">
            Completed per 5s (last minute)
          </div>
          <div className="flex h-24 items-end gap-1">
            {metrics.throughputSeries.map((n, i) => (
              <div
                key={i}
                title={`${n} jobs`}
                className="flex-1 rounded-t bg-green-400/70"
                style={{ height: `${(n / max) * 100}%`, minHeight: n > 0 ? 2 : 0 }}
              />
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 font-medium">Depth</th>
                <th className="px-3 py-2 font-medium">Running</th>
                <th className="px-3 py-2 font-medium">Done/min</th>
                <th className="px-3 py-2 font-medium">Failed</th>
                <th className="px-3 py-2 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {metrics.queues.map((q) => (
                <tr key={q.name} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-3 py-2">{q.name}</td>
                  <td className="px-3 py-2 tabular-nums">{q.depth}</td>
                  <td className="px-3 py-2 tabular-nums">{q.processing}</td>
                  <td className="px-3 py-2 tabular-nums">{q.doneLastMinute}</td>
                  <td className="px-3 py-2 tabular-nums text-red-400">{q.failed}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-400"> {q.ratePerSec === null ? "-" : `${q.ratePerSec}/s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}