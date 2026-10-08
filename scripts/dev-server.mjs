import { spawn } from "node:child_process";

const server = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
  },
});

server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

process.on("SIGINT", () => server.kill());
process.on("SIGTERM", () => server.kill());