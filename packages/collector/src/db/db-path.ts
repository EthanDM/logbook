import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOGBOOK_DIRNAME = ".logbook";
const DEFAULT_DB_BASENAME = "logs.db";

interface ResolveDbPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function resolveHomeDir(options: ResolveDbPathOptions = {}): string {
  if (options.homeDir) {
    return options.homeDir;
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    if (env.USERPROFILE) {
      return env.USERPROFILE;
    }
    if (env.HOMEDRIVE && env.HOMEPATH) {
      return `${env.HOMEDRIVE}${env.HOMEPATH}`;
    }
  } else if (env.HOME) {
    return env.HOME;
  }

  return homedir();
}

export function resolveDefaultLogbookDir(
  options: ResolveDbPathOptions = {},
): string {
  return join(resolveHomeDir(options), LOGBOOK_DIRNAME);
}

export function resolveDefaultDbPath(
  options: ResolveDbPathOptions = {},
): string {
  return join(resolveDefaultLogbookDir(options), DEFAULT_DB_BASENAME);
}

export function ensureDbDirectory(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
}

