export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export const handlers: Record<string, JobHandler> = {
  emails: async (payload) => {
    console.log("Pretending to send email:", payload);
    await new Promise((r) => setTimeout(r, 200)); // simulate I/O
  },
  reports: async (payload) => {
    console.log("Pretending to generate report:", payload);
    await new Promise((r) => setTimeout(r, 300));
  },

  
};


if (process.env.ENABLE_BENCH_HANDLERS === "true") {
  handlers.bench_noop = async () => {};
  handlers.bench_work = async () => {
    await new Promise((r) => setTimeout(r, 50));
  };
}