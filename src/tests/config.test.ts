import { parseConfig, ConfigError } from "../config";

const base = { DB_HOST: "localhost", DB_NAME: "relay_db", DB_USER: "u", DB_PASSWORD: "p" };

const issues = (env: NodeJS.ProcessEnv): string => {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  return "";
};

describe("config", () => {
  it("applies defaults", () => {
    const { config } = parseConfig(base);
    expect(config.PORT).toBe(3000);
    expect(config.POLL_INTERVAL_MS).toBe(1000);
    expect(config.EMBED_WORKER).toBe(false);
    expect(config.LOG_LEVEL).toBe("debug");
  });

  it("treats empty strings as unset", () => {
    const { config } = parseConfig({ ...base, PORT: "", HEARTBEAT_MS: "" });
    expect(config.PORT).toBe(3000);
    expect(config.HEARTBEAT_MS).toBe(10000);
  });

  it("accepts DATABASE_URL alone", () => {
    expect(() => parseConfig({ DATABASE_URL: "postgres://u:p@host/db" })).not.toThrow();
  });

  it("requires DB settings when there is no DATABASE_URL", () => {
    expect(issues({})).toContain("DB_HOST");
  });

  it("rejects a stale timeout below 3 heartbeats", () => {
    expect(issues({ ...base, HEARTBEAT_MS: "30000", STALE_JOB_TIMEOUT_MS: "60000" })).toContain(
      "STALE_JOB_TIMEOUT_MS"
    );
  });

  it("rejects bad booleans and numbers", () => {
    expect(issues({ ...base, ENABLE_BENCH_HANDLERS: "yes" })).toContain("ENABLE_BENCH_HANDLERS");
    expect(issues({ ...base, POLL_INTERVAL_MS: "abc" })).toContain("POLL_INTERVAL_MS");
  });

  it("rejects an origin with a trailing slash", () => {
    expect(issues({ ...base, DASHBOARD_ORIGIN: "https://app.vercel.app/" })).toContain("DASHBOARD_ORIGIN");
  });

  it("refuses to run tests against a non-test database", () => {
    expect(issues({ ...base, NODE_ENV: "test" })).toContain("DB_NAME");
    expect(() => parseConfig({ ...base, NODE_ENV: "test", DB_NAME: "relay_test" })).not.toThrow();
  });

  it("strict mode requires production settings", () => {
    const text = issues({ ...base, STRICT_CONFIG: "true" });
    expect(text).toContain("API_KEY");
    expect(text).toContain("DASHBOARD_ORIGIN");
    expect(text).toContain("NODE_ENV");
  });

  it("never echoes secret values in errors", () => {
    expect(issues({ ...base, API_KEY: "short-secret" })).not.toContain("short-secret");
  });
});