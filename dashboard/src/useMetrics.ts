import { useEffect, useState } from "react";
import { fetchMetrics } from "./api";
import type { Metrics } from "./types";

const POLL_MS = 2000;

export function useMetrics() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // Chained setTimeout (not setInterval) so slow responses never overlap
    const tick = async () => {
      try {
        const m = await fetchMetrics();
        if (!cancelled) {
          setMetrics(m);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { metrics, error };
}