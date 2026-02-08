import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "@logbook/cli";
import { LogbookDatabase, startCollector } from "@logbook/collector";
import { init, log, shutdownLogger } from "@logbook/sdk";

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
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await sleep(intervalMs);
  }
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = "";

  process.stdout.write = ((chunk: unknown): boolean => {
    output += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

test("SDK emits events that the CLI can read from collector SQLite", async () => {
  const root = createTempDir("logbook-integration-sdk-cli-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1,
    retentionIntervalMs: 60_000,
  });
  const db = new LogbookDatabase({ dbPath });

  try {
    init({
      endpoint: `http://127.0.0.1:${port}/ingest`,
      app: "integration-suite",
      batchIntervalMs: 10,
    });

    log.info("sdk.cli.e2e", { route: "Feed", phase: "start" });
    await log.flush();

    await waitFor(() => {
      const rows = db.queryEvents({
        name: "sdk.cli.e2e",
        limit: 10,
        order: "asc",
      });
      return rows.length >= 1;
    });

    const output = await captureStdout(() =>
      runCli([
        "node",
        "logbook",
        "tail",
        "--db",
        dbPath,
        "--name",
        "sdk.cli.e2e",
        "--limit",
        "5",
        "--json",
      ]),
    );

    const rows = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string; payloadJson: string | null });

    assert.ok(rows.length >= 1);
    assert.equal(rows[rows.length - 1]?.name, "sdk.cli.e2e");

    const payload = rows[rows.length - 1]?.payloadJson
      ? JSON.parse(rows[rows.length - 1].payloadJson)
      : null;
    assert.equal(payload?.app, "integration-suite");
    assert.equal(payload?.route, "Feed");
    assert.equal(payload?.phase, "start");
  } finally {
    await shutdownLogger();
    await server.close();
    db.close();
    cleanupDir(root);
  }
});
