#!/usr/bin/env node

import { runCli } from "./run-cli.js";

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

