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
