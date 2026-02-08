import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogbookDatabase } from "@logbook/collector";
import { runCli } from "../src/run-cli.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
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

test("tail --json returns recent rows in ascending order", async () => {
  const root = createTempDir("logbook-cli-tail-");
  const dbPath = join(root, "logs.db");
  const db = new LogbookDatabase({ dbPath });

  try {
    db.insertEvents([
      { ts: 1_000, level: "info", name: "demo.first" },
      { ts: 2_000, level: "warn", name: "demo.second" },
      { ts: 3_000, level: "error", name: "demo.third" },
    ]);

    const output = await captureStdout(() =>
      runCli(["node", "logbook", "tail", "--db", dbPath, "--json", "--limit", "2"]),
    );

    const lines = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string });

    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.name, "demo.second");
    assert.equal(lines[1]?.name, "demo.third");
  } finally {
    db.close();
    cleanupDir(root);
  }
});

test("summary --md prints deterministic sections and counts", async () => {
  const root = createTempDir("logbook-cli-summary-");
  const dbPath = join(root, "logs.db");
  const db = new LogbookDatabase({ dbPath });

  try {
    const baseTs = Date.parse("2026-02-08T12:00:00.000Z");
    db.insertEvents([
      {
        ts: baseTs,
        level: "info",
        name: "feed.refresh",
        deviceId: "iphone",
      },
      {
        ts: baseTs + 1_000,
        level: "error",
        name: "api.fail",
        deviceId: "iphone",
      },
      {
        ts: baseTs + 2_000,
        level: "error",
        name: "api.fail",
        deviceId: "android",
        flowId: "flow-alpha",
      },
      {
        ts: baseTs + 3_000,
        level: "warn",
        name: "feed.refresh",
        flowId: "flow-alpha",
      },
    ]);

    const output = await captureStdout(() =>
      runCli([
        "node",
        "logbook",
        "summary",
        "--db",
        dbPath,
        "--since",
        "2026-02-08T11:59:00.000Z",
        "--until",
        "2026-02-08T12:10:00.000Z",
        "--md",
      ]),
    );

    assert.match(output, /## Logbook Summary/);
    assert.match(output, /### 1\. Totals/);
    assert.match(output, /- Total events: 4/);
    assert.match(output, /- Unique devices: 2/);
    assert.match(output, /### 2\. Top Events/);
    assert.match(output, /- api\.fail: 2/);
    assert.match(output, /- feed\.refresh: 2/);
    assert.match(output, /### 3\. Errors/);
    assert.match(output, /- api\.fail: 2/);
    assert.match(output, /### 4\. Recent Flows/);
    assert.match(output, /- flow-alpha: 2 events/);
  } finally {
    db.close();
    cleanupDir(root);
  }
});

test("around --json returns events within the requested time window", async () => {
  const root = createTempDir("logbook-cli-around-");
  const dbPath = join(root, "logs.db");
  const db = new LogbookDatabase({ dbPath });

  try {
    db.insertEvents([
      { ts: 1_000, level: "info", name: "demo.before" },
      { ts: 1_500, level: "info", name: "demo.center" },
      { ts: 2_700, level: "info", name: "demo.after" },
    ]);

    const centerEvent = db.queryEvents({
      name: "demo.center",
      limit: 1,
      order: "asc",
    })[0];
    assert.ok(centerEvent);

    const output = await captureStdout(() =>
      runCli([
        "node",
        "logbook",
        "around",
        String(centerEvent.id),
        "--db",
        dbPath,
        "--window",
        "1s",
        "--json",
      ]),
    );

    const lines = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string });

    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.name, "demo.before");
    assert.equal(lines[1]?.name, "demo.center");
  } finally {
    db.close();
    cleanupDir(root);
  }
});
