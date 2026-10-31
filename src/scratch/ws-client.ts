import { io } from "socket.io-client";
import { JobEvent } from "../events/types";

const socket = io("http://localhost:3000");

socket.on("connect", () => {
  console.log(`connected as ${socket.id}`);
});

socket.on("job-events", (batch: JobEvent[]) => {
  console.log(`--- batch of ${batch.length} ---`);
  for (const e of batch.slice(0, 5)) {
    console.log(`  job ${e.jobId} (${e.queue}) ${e.type}${e.workerId ? ` by ${e.workerId}` : ""}`);
  }
  if (batch.length > 5) console.log(`  ... and ${batch.length - 5} more`);
});

socket.on("disconnect", (reason) => console.log("disconnected:", reason));