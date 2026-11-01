// Runs before any test file loads, so dotenv (which never overrides existing vars) can't win
process.env.NODE_ENV = "test";
process.env.DB_HOST = "localhost";
process.env.DB_NAME = "relay_test"; // tests TRUNCATE tables, so never the dev DB
process.env.REDIS_HOST = "localhost";