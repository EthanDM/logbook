import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LogbookDatabase,
  startCollector,
} from "@logbook/collector";
import {
  attachReactNativeFlushAdapter,
  initReactNative,
  shutdownReactNativeLogger,
  type AppStateSubscriptionLike,
  type ReactNativeAppStateLike,
} from "../src/react-native.js";
import { log } from "../src/logger.js";

class MockAppState implements ReactNativeAppStateLike {
  currentState: string = "active";
  private listeners = new Map<
    "change" | "memoryWarning",
    Set<(state: string) => void>
  >([
    ["change", new Set()],
    ["memoryWarning", new Set()],
  ]);

  addEventListener(
    type: "change" | "memoryWarning",
    listener: (state: string) => void,
  ): AppStateSubscriptionLike {
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return { remove: () => undefined };
    }

    bucket.add(listener);
    return {
      remove: () => {
        bucket.delete(listener);
      },
    };
  }

  emit(type: "change" | "memoryWarning", state = this.currentState): void {
    if (type === "change") {
      this.currentState = state;
    }
    const bucket = this.listeners.get(type);
    if (!bucket) {
      return;
    }
    for (const listener of bucket) {
      listener(state);
    }
  }
}

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

test("RN adapter flushes on AppState transition to background", async () => {
  const root = createTempDir("logbook-rn-adapter-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const appState = new MockAppState();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1000,
    retentionIntervalMs: 60_000,
  });
  const db = new LogbookDatabase({ dbPath });

  try {
    initReactNative(
      {
        endpoint: `http://127.0.0.1:${port}/ingest`,
        app: "rn-app",
        batchIntervalMs: 10_000,
      },
      {
        appState,
      },
    );

    log.info("rn.background.flush");
    appState.emit("change", "background");

    await waitFor(() => {
      const rows = db.queryEvents({
        name: "rn.background.flush",
        limit: 10,
        order: "asc",
      });
      return rows.length >= 1;
    });
  } finally {
    await shutdownReactNativeLogger();
    await server.close();
    db.close();
    cleanupDir(root);
  }
});

test("RN adapter detach stops AppState-triggered flushing", async () => {
  const appState = new MockAppState();
  let flushCount = 0;
  const adapter = attachReactNativeFlushAdapter(
    {
      flush: async () => {
        flushCount += 1;
      },
    },
    {
      appState,
      flushOnMemoryWarning: true,
    },
  );

  appState.emit("change", "inactive");
  appState.emit("memoryWarning");
  assert.equal(flushCount, 2);

  adapter.detach();
  appState.emit("change", "background");
  appState.emit("memoryWarning");
  assert.equal(flushCount, 2);
});
