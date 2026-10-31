import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",

  setupFiles: [
    "<rootDir>/src/db.test-setup.ts",
  ],

  testMatch: [
    "**/*.test.ts",
  ],
};

export default config;