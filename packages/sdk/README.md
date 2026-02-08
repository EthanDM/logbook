# @logbook/sdk

Application-side structured logger for Logbook.

## API

```ts
import { init, log } from "@logbook/sdk";

init({
  endpoint: "http://127.0.0.1:8787/ingest",
  app: "my-app",
  devGlobal: true,
});

log.info("app.started", { source: "bootstrap" });
```

### Context

```ts
log.setContext({ deviceId: "iphone-15", screen: "Feed" });
log.info("feed.opened");
```

### Flow Correlation

```ts
await log.withFlow("refresh_001", async () => {
  log.info("feed.refresh.start");
  log.info("feed.refresh.end");
});
```

### Error Capture (Opt-In)

```ts
init({
  endpoint: "http://127.0.0.1:8787/ingest",
  app: "my-app",
  captureUnhandledErrors: true,
});
```

### Shutdown

```ts
await log.flush();
await log.shutdown();
```

## React Native Adapter

Use the RN helper to flush when app state moves to background/inactive.

```ts
import { AppState } from "react-native";
import { initReactNative, log } from "@logbook/sdk";

const { detachReactNative } = initReactNative(
  {
    endpoint: "http://<dev-machine>:8787/ingest",
    app: "my-rn-app",
  },
  {
    appState: AppState,
    flushOnMemoryWarning: true,
  },
);

log.info("app.opened");

// Optional cleanup when tearing down logger manually:
detachReactNative();
```

### React Native Setup (Networking)

Collector bind host guidance:

- Use `127.0.0.1` when app and collector run on the same machine and can share loopback.
- Use `0.0.0.0` when testing from another device/emulator over LAN.
- Pair collector `--host 0.0.0.0` with your machine LAN IP in SDK endpoint.

#### iOS Simulator

Use your Mac host loopback:

```ts
initReactNative(
  {
    endpoint: "http://127.0.0.1:8787/ingest",
    app: "my-rn-app",
  },
  { appState: AppState },
);
```

#### Android Emulator

Use Android emulator host mapping:

```ts
initReactNative(
  {
    endpoint: "http://10.0.2.2:8787/ingest",
    app: "my-rn-app",
  },
  { appState: AppState },
);
```

#### Physical Device on LAN

1. Start collector on LAN bind host:
   `logbook dev --host 0.0.0.0 --port 8787`
2. Use machine LAN IP in endpoint:

```ts
initReactNative(
  {
    endpoint: "http://192.168.1.25:8787/ingest",
    app: "my-rn-app",
  },
  { appState: AppState, flushOnMemoryWarning: true },
);
```

### Transport Defaults (RN-Friendly)

Default SDK transport values:

- `batchIntervalMs`: `250`
- `batchSize`: `200`
- `maxQueueSize`: `5000`

When the collector endpoint is temporarily unavailable, the queue stays bounded:

- new events keep enqueueing until `maxQueueSize`
- once full, oldest events are dropped first
- flush resumes automatically once the endpoint recovers

### RN Usage Patterns

Basic init + log calls:

```ts
import { AppState } from "react-native";
import { initReactNative, log } from "@logbook/sdk";

initReactNative(
  {
    endpoint: "http://10.0.2.2:8787/ingest",
    app: "my-rn-app",
  },
  { appState: AppState },
);

log.info("app.opened");
```

Context + `withFlow`:

```ts
log.setContext({ deviceId: "pixel-8", screen: "Feed" });

await log.withFlow("feed_refresh_001", async () => {
  log.info("feed.refresh.start");
  log.info("feed.refresh.success");
});
```

Custom background flush states:

```ts
initReactNative(
  {
    endpoint: "http://10.0.2.2:8787/ingest",
    app: "my-rn-app",
  },
  {
    appState: AppState,
    flushOnStates: ["background"], // omit "inactive" if too noisy
    flushOnMemoryWarning: true,
  },
);
```

Unhandled error capture (opt-in):

```ts
initReactNative(
  {
    endpoint: "http://10.0.2.2:8787/ingest",
    app: "my-rn-app",
    captureUnhandledErrors: true,
  },
  { appState: AppState },
);
```

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Network request failed` on device | Collector bound to `127.0.0.1` | Start with `--host 0.0.0.0` and use LAN IP |
| Works on iOS simulator, fails on Android emulator | Wrong host mapping | Use `10.0.2.2` instead of `127.0.0.1` |
| No logs after app background | Adapter not attached or no flush trigger | Use `initReactNative(..., { appState: AppState })` and verify `flushOnStates` |
| Logs delayed until process exit | Batch interval is too long | Lower `batchIntervalMs` during debugging |
| `memoryWarning` flush not firing | Platform/runtime does not emit event | Rely on AppState flush states (`background`, `inactive`) |
