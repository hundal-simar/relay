import parser from "cron-parser";

export function nextRun(expr: string, timezone = "UTC", from: Date = new Date()): Date {
  return parser.parseExpression(expr, { currentDate: from, tz: timezone }).next().toDate();
}

export function isValidSchedule(expr: string, timezone = "UTC"): boolean {
  try {
    nextRun(expr, timezone);
    return true;
  } catch {
    return false;
  }
}