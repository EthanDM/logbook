import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogbookDatabase } from "@logbook/collector";
import { runCli } from "../src/run-cli.js";

const SUMMARY_SINCE = "2026-02-08T11:59:00.000Z";
const SUMMARY_UNTIL = "2026-02-08T12:10:00.000Z";

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

function readGolden(name: string): string {
  const path = fileURLToPath(new URL(`./golden/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function seedSummaryFixture(db: LogbookDatabase): void {
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
}

function normalizeSummaryOutput(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/(?<=last(?:=|\s))\d{2}:\d{2}:\d{2}\.\d{3}/g, "<TIME>")
    .trimEnd();
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

test("summary text output matches golden snapshot", async () => {
  const root = createTempDir("logbook-cli-summary-");
  const dbPath = join(root, "logs.db");
  const db = new LogbookDatabase({ dbPath });

  try {
    seedSummaryFixture(db);

    const output = await captureStdout(() =>
      runCli([
        "node",
        "logbook",
        "summary",
        "--db",
        dbPath,
        "--since",
        SUMMARY_SINCE,
        "--until",
        SUMMARY_UNTIL,
      ]),
    );

    const expected = readGolden("summary.txt");
    assert.equal(normalizeSummaryOutput(output), normalizeSummaryOutput(expected));
  } finally {
    db.close();
    cleanupDir(root);
  }
});

test("summary markdown output matches golden snapshot", async () => {
  const root = createTempDir("logbook-cli-summary-md-");
  const dbPath = join(root, "logs.db");
  const db = new LogbookDatabase({ dbPath });

  try {
    seedSummaryFixture(db);

    const output = await captureStdout(() =>
      runCli([
        "node",
        "logbook",
        "summary",
        "--db",
        dbPath,
        "--since",
        SUMMARY_SINCE,
        "--until",
        SUMMARY_UNTIL,
        "--md",
      ]),
    );

    const expected = readGolden("summary.md");
    assert.equal(normalizeSummaryOutput(output), normalizeSummaryOutput(expected));
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
