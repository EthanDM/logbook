import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_TIMEOUT_MS = 8000;

async function main() {
  const root = mkdtempSync(join(tmpdir(), "logbook-ci-cli-smoke-"));
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const cliBin = join(process.cwd(), "packages", "cli", "dist", "bin.js");

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
  dev.stdout.on("data", (chunk) => {
    devStdout += chunk.toString();
  });
  dev.stderr.on("data", (chunk) => {
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
        name: "ci.smoke.event",
      }),
    });
    if (ingest.status !== 202) {
      throw new Error(`Ingest failed with status ${ingest.status}.`);
    }

    const tail = await runCliCommand(cliBin, [
      "tail",
      "--db",
      dbPath,
      "--name",
      "ci.smoke.event",
      "--json",
      "--limit",
      "5",
    ]);
    if (tail.code !== 0 || !tail.stdout.includes("ci.smoke.event")) {
      throw new Error(`CLI smoke tail failed. code=${tail.code}\n${tail.stderr}\n${tail.stdout}`);
    }

    const summary = await runCliCommand(cliBin, [
      "summary",
      "--db",
      dbPath,
      "--since",
      "5m",
    ]);
    if (
      summary.code !== 0 ||
      !summary.stdout.includes("1) Totals") ||
      !summary.stdout.includes("ci.smoke.event")
    ) {
      throw new Error(
        `CLI smoke summary failed. code=${summary.code}\n${summary.stderr}\n${summary.stdout}`,
      );
    }
  } finally {
    await stopProcess(dev);
    rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("CLI smoke gate passed\n");
  if (!devStdout.includes("Collector started")) {
    throw new Error("CLI smoke gate failed: dev command did not print startup banner.");
  }
  if (devStderr.trim().length > 0) {
    throw new Error(`CLI smoke gate failed: unexpected stderr output\n${devStderr}`);
  }
}

async function getFreePort() {
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

async function waitForHealth(port) {
  const start = Date.now();
  while (Date.now() - start <= DEFAULT_TIMEOUT_MS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Ignore until timeout.
    }
    await sleep(25);
  }
  throw new Error("Timed out waiting for collector health endpoint.");
}

function runCliCommand(cliBin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
