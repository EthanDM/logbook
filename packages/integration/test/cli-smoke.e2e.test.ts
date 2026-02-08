import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

const TEST_TIMEOUT_MS = 8_000;

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve ephemeral port."));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = TEST_TIMEOUT_MS,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await sleep(intervalMs);
  }
}

function getCliBinPath(): string {
  const testDir = fileURLToPath(new URL(".", import.meta.url));
  return join(testDir, "../../cli/dist/bin.js");
}

function runCliCommand(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const cliBin = getCliBinPath();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function waitForHealth(port: number): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.status === 200;
    } catch {
      return false;
    }
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("close", () => resolve());
    child.kill("SIGINT");
  });
}

function waitForProcessExit(
  child: ChildProcess,
  timeoutMs = 4_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
      reject(new Error("Timed out waiting for process exit."));
    }, timeoutMs);

    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

test("black-box CLI flow works with built binary", async () => {
  const root = createTempDir("logbook-cli-smoke-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const cliBin = getCliBinPath();

  const dev = spawn(
    process.execPath,
    [cliBin, "dev", "--host", "127.0.0.1", "--port", String(port), "--db", dbPath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LOGBOOK_FLUSH_INTERVAL_MS: "10",
        LOGBOOK_FLUSH_QUEUE_THRESHOLD: "1",
      },
    },
  );

  let devStdout = "";
  let devStderr = "";
  dev.stdout.on("data", (chunk: Buffer | string) => {
    devStdout += chunk.toString();
  });
  dev.stderr.on("data", (chunk: Buffer | string) => {
    devStderr += chunk.toString();
  });

  try {
    await waitForHealth(port);

    const ingest = await fetch(`http://127.0.0.1:${port}/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ts: Date.now(),
        level: "info",
        name: "smoke.event",
        payload: { source: "integration" },
      }),
    });
    assert.equal(ingest.status, 202);

    let tailResult = { code: 1, stdout: "", stderr: "" };
    await waitFor(async () => {
      tailResult = await runCliCommand([
        "tail",
        "--db",
        dbPath,
        "--name",
        "smoke.event",
        "--json",
        "--limit",
        "5",
      ]);

      if (tailResult.code !== 0) {
        return false;
      }

      const lines = tailResult.stdout.trim().split("\n").filter(Boolean);
      return lines.length > 0;
    });

    assert.equal(tailResult.code, 0);
    const tailLines = tailResult.stdout.trim().split("\n").filter(Boolean);
    const tailRows = tailLines.map((line) => JSON.parse(line) as { name: string });
    assert.ok(tailRows.some((row) => row.name === "smoke.event"));

    const summary = await runCliCommand([
      "summary",
      "--db",
      dbPath,
      "--since",
      "5m",
    ]);
    assert.equal(summary.code, 0);
    assert.match(summary.stdout, /1\) Totals/);
    assert.match(summary.stdout, /total_events=1/);
    assert.match(summary.stdout, /2\) Top Events/);
    assert.match(summary.stdout, /smoke\.event 1/);
  } finally {
    await stopProcess(dev);
    cleanupDir(root);
  }

  assert.match(devStdout, /Collector started/);
  assert.equal(devStderr.trim(), "");
});

test("logbook dev handles repeated termination signals without hanging", async () => {
  const root = createTempDir("logbook-cli-signals-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const cliBin = getCliBinPath();

  const dev = spawn(
    process.execPath,
    [cliBin, "dev", "--host", "127.0.0.1", "--port", String(port), "--db", dbPath],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        LOGBOOK_FLUSH_INTERVAL_MS: "10000",
        LOGBOOK_FLUSH_QUEUE_THRESHOLD: "10000",
      },
    },
  );

  try {
    await waitForHealth(port);

    const ingest = await fetch(`http://127.0.0.1:${port}/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ts: Date.now(),
        level: "info",
        name: "signal.shutdown.flush",
      }),
    });
    assert.equal(ingest.status, 202);

    const exitPromise = waitForProcessExit(dev);
    dev.kill("SIGTERM");
    dev.kill("SIGTERM");
    const exit = await exitPromise;
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 0);

    const tailResult = await runCliCommand([
      "tail",
      "--db",
      dbPath,
      "--name",
      "signal.shutdown.flush",
      "--json",
      "--limit",
      "5",
    ]);
    assert.equal(tailResult.code, 0);
    assert.match(tailResult.stdout, /signal\.shutdown\.flush/);
  } finally {
    if (dev.exitCode === null) {
      await stopProcess(dev);
    }
    cleanupDir(root);
  }
});
