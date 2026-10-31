const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000; 

export function calculateBackoffMs(attempt: number): number {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  const jitterFactor = 0.5 + Math.random() * 0.5;
  return Math.floor(capped * jitterFactor);
}