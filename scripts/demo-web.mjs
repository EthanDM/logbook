import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_UI_PORT = 5173;

const args = parseArgs(process.argv.slice(2));
const host = args.host ?? DEFAULT_HOST;
const port = parsePositiveInt(args.port, DEFAULT_PORT);
const uiPort = parsePositiveInt(args["ui-port"], DEFAULT_UI_PORT);
const dbPath = args.db;
const endpoint = `http://127.0.0.1:${port}/ingest`;
const apiTarget = `http://127.0.0.1:${port}`;

let stopping = false;
let stopStarted = false;

const collectorArgs = [
  "-C",
  "packages/cli",
  "exec",
  "tsx",
  "src/bin.ts",
  "dev",
  "--host",
  host,
  "--port",
  String(port),
];
if (dbPath) {
  collectorArgs.push("--db", dbPath);
}

const webArgs = ["-C", "packages/web", "dev", "--", "--port", String(uiPort)];

const collector = spawn("pnpm", collectorArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const web = spawn("pnpm", webArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    LOGBOOK_WEB_API_TARGET: apiTarget,
  },
});

const stream = spawn(
  process.execPath,
  [
    "scripts/demo-stream.mjs",
    "--endpoint",
    endpoint,
    "--interval-ms",
    args["interval-ms"] ?? "400",
    "--batch-size",
    args["batch-size"] ?? "20",
    "--seed",
    args.seed ?? "1337",
    ...(args.devices ? ["--devices", args.devices] : []),
  ],
  {
    stdio: "inherit",
  },
);

process.stdout.write(`Starting web dev loop on http://127.0.0.1:${uiPort}\n`);
process.stdout.write(`Collector endpoint ${endpoint}\n`);

collector.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(
      `Collector exited unexpectedly code=${code ?? "null"} signal=${signal ?? "null"}\n`,
    );
    void stopAll(code ?? (signal ? 1 : 0));
  }
});

web.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(
      `Web dev server exited unexpectedly code=${code ?? "null"} signal=${signal ?? "null"}\n`,
    );
    void stopAll(code ?? (signal ? 1 : 0));
  }
});

stream.once("exit", (code, signal) => {
  if (!stopping) {
    process.stderr.write(
      `Demo stream exited unexpectedly code=${code ?? "null"} signal=${signal ?? "null"}\n`,
    );
    void stopAll(code ?? (signal ? 1 : 0));
  }
});

process.on("SIGINT", () => {
  void stopAll(0);
});
process.on("SIGTERM", () => {
  void stopAll(0);
});

await new Promise(() => {
  // Keep process alive until signals or child exit handlers call stopAll.
});

async function stopAll(exitCode) {
  if (stopStarted) {
    return;
  }

  stopStarted = true;
  stopping = true;

  await stopChild(stream);
  await stopChild(web);
  await stopChild(collector);
  await sleep(25);
  process.exit(exitCode);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);

    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
