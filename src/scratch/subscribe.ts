import { createSubscriber } from "../events/redis";
import { JOB_EVENTS_CHANNEL, jobEventSchema } from "../events/types";

const sub = createSubscriber();

sub.subscribe(JOB_EVENTS_CHANNEL, (err, count) => {
  if (err) {
    console.error("subscribe failed:", err.message);
    process.exit(1);
  }
  console.log(`Subscribed to ${JOB_EVENTS_CHANNEL} (${count} channel)`);
});

sub.on("message", (_channel, message) => {
  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    console.warn("Skipped message: invalid JSON");
    return;
  }

  const parsed = jobEventSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Skipped message: failed validation", parsed.error.issues[0]?.message);
    return;
  }

  const e = parsed.data;
  const time = new Date(e.timestamp).toLocaleTimeString("en-GB");
  const by = e.workerId ? ` by ${e.workerId}` : "";
  console.log(`[${time}] job ${e.jobId} (${e.queue}) ${e.type}${by} [attempts: ${e.attempts}]`);
});

process.on("SIGINT", async () => {
  await sub.quit();
  process.exit(0);
});