
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",

  roots: ["<rootDir>/src"],

  setupFilesAfterEnv: [
    "<rootDir>/src/db.test-setup.ts",
  ],

  testMatch: ["**/*.test.ts"],

  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
  ],

  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          target: "es2020",
          esModuleInterop: true,
          strict: true,
        },
        useESM: false,
      },
    ],
  },
};

export default config;
