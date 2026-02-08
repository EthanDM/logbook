import {
  init,
  shutdownLogger,
  type InitConfig,
  type InitResult,
  type LogbookLoggerApi,
} from "./logger.js";

type AppStateStatus = "active" | "inactive" | "background" | string;

export interface AppStateSubscriptionLike {
  remove: () => void;
}

export interface ReactNativeAppStateLike {
  currentState?: AppStateStatus;
  addEventListener: (
    type: "change" | "memoryWarning",
    listener: (state: AppStateStatus) => void,
  ) => AppStateSubscriptionLike | void;
}

export interface ReactNativeFlushAdapterOptions {
  appState: ReactNativeAppStateLike;
  flushOnStates?: AppStateStatus[];
  flushOnMemoryWarning?: boolean;
}

export interface ReactNativeLoggerInitResult extends InitResult {
  detachReactNative: () => void;
}

interface Disposable {
  detach: () => void;
}

const DEFAULT_FLUSH_STATES: AppStateStatus[] = ["background", "inactive"];

let activeReactNativeAdapter: Disposable | null = null;

export function attachReactNativeFlushAdapter(
  logger: Pick<LogbookLoggerApi, "flush">,
  options: ReactNativeFlushAdapterOptions,
): Disposable {
  const flushStates = new Set(options.flushOnStates ?? DEFAULT_FLUSH_STATES);
  let lastState = options.appState.currentState;

  const changeListener = (nextState: AppStateStatus): void => {
    const previousState = lastState;
    lastState = nextState;

    if (
      flushStates.has(nextState) &&
      previousState !== nextState
    ) {
      void logger.flush();
    }
  };

  const memoryWarningListener = (): void => {
    if (options.flushOnMemoryWarning) {
      void logger.flush();
    }
  };

  const changeSubscription = options.appState.addEventListener(
    "change",
    changeListener,
  );

  let memorySubscription: AppStateSubscriptionLike | void;
  if (options.flushOnMemoryWarning) {
    memorySubscription = options.appState.addEventListener(
      "memoryWarning",
      memoryWarningListener,
    );
  }

  return {
    detach(): void {
      changeSubscription?.remove?.();
      memorySubscription?.remove?.();
    },
  };
}

export function initReactNative(
  config: InitConfig,
  options: ReactNativeFlushAdapterOptions,
): ReactNativeLoggerInitResult {
  const result = init(config);

  activeReactNativeAdapter?.detach();
  const adapter = attachReactNativeFlushAdapter(result.log, options);
  activeReactNativeAdapter = adapter;

  return {
    ...result,
    detachReactNative: () => {
      adapter.detach();
      if (activeReactNativeAdapter === adapter) {
        activeReactNativeAdapter = null;
      }
    },
  };
}

export async function shutdownReactNativeLogger(): Promise<void> {
  activeReactNativeAdapter?.detach();
  activeReactNativeAdapter = null;
  await shutdownLogger();
}
