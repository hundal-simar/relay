import { useEffect, useReducer, useState } from "react";
import { io } from "socket.io-client";
import { fetchCounts, fetchRecentJobs, SOCKET_ORIGIN } from "./api";
import type { Counts, JobEvent, JobView } from "./types";

const MAX_ROWS = 200;

type State = Map<number, JobView>;
type Action =
  | { type: "reset" }
  | { type: "snapshot"; jobs: JobView[] }
  | { type: "events"; events: JobEvent[] };

function trim(map: State): State {
  if (map.size <= MAX_ROWS) return map;
  const newest = [...map.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ROWS);
  return new Map(newest.map((j) => [j.id, j]));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return new Map();
    case "snapshot": {
      
      const next = new Map(state);
      for (const job of action.jobs) {
        if (!next.has(job.id)) next.set(job.id, job);
      }
      return trim(next);
    }
    case "events": {
      const next = new Map(state);
      for (const e of action.events) {
        const prev = next.get(e.jobId);
        next.set(e.jobId, {
          id: e.jobId,
          queue: e.queue,
          status: e.status,
          attempts: e.attempts,
          workerId: e.workerId ?? prev?.workerId,
          updatedAt: new Date(e.timestamp).getTime(),
        });
      }
      return trim(next);
    }
  }
}

export function useJobFeed() {
  const [jobsMap, dispatch] = useReducer(reducer, new Map<number, JobView>());
  const [counts, setCounts] = useState<Counts | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_ORIGIN);
    let cancelled = false;
    let countsTimer: ReturnType<typeof setTimeout> | null = null;

    const loadCounts = async () => {
      try {
        const c = await fetchCounts();
        if (!cancelled) setCounts(c);
      } catch (err) {
        console.error("counts fetch failed", err);
      }
    };

    const scheduleCounts = () => {
      if (countsTimer) return;
      countsTimer = setTimeout(() => {
        countsTimer = null;
        void loadCounts();
      }, 1000);
    };

    socket.on("connect", async () => {
      setConnected(true);
      dispatch({ type: "reset" }); 
      void loadCounts();
      try {
        const jobs = await fetchRecentJobs(100);
        if (!cancelled) dispatch({ type: "snapshot", jobs });
      } catch (err) {
        console.error("snapshot fetch failed", err);
      }
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("job-events", (events: JobEvent[]) => {
      dispatch({ type: "events", events });
      scheduleCounts();
    });

    return () => {
      cancelled = true;
      if (countsTimer) clearTimeout(countsTimer);
      socket.disconnect();
    };
  }, []);

  const jobs = [...jobsMap.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { jobs, counts, connected };
}