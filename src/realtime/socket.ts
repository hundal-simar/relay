import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { createSubscriber } from "../events/redis";
import { JOB_EVENTS_CHANNEL, jobEventSchema, JobEvent } from "../events/types";

const BATCH_INTERVAL_MS = 100;
const MAX_BUFFER = 5000;

export function attachRealtime(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173" },
  });

  const sub = createSubscriber();
  let buffer: JobEvent[] = [];
  let dropped = 0;

  sub.subscribe(JOB_EVENTS_CHANNEL, (err) => {
    if (err) {
      console.error("[realtime] subscribe failed:", err.message);
      return;
    }
    console.log(`[realtime] subscribed to ${JOB_EVENTS_CHANNEL}`);
  });

  sub.on("message", (_channel, message) => {
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      return;
    }
    const parsed = jobEventSchema.safeParse(raw);
    if (!parsed.success) return;

    if (buffer.length >= MAX_BUFFER) {
      dropped++; 
      return;
    }
    buffer.push(parsed.data);
  });

  const flushTimer = setInterval(() => {
    if (dropped > 0) {
      console.warn(`[realtime] dropped ${dropped} events (buffer full)`);
      dropped = 0;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    io.emit("job-events", batch);
  }, BATCH_INTERVAL_MS);

  io.on("connection", (socket) => {
    console.log(`[realtime] client connected: ${socket.id} (total ${io.engine.clientsCount})`);
    socket.on("disconnect", (reason) => {
      console.log(`[realtime] client disconnected: ${socket.id} (${reason})`);
    });
  });

  async function close(): Promise<void> {
    clearInterval(flushTimer);
    await sub.quit()
    await new Promise<void>((resolve) => io.close(() => resolve()));
  }

  return { io, close };
}