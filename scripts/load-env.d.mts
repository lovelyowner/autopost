export function ensureVaultSecretKey(rootDir?: string): void;
export function parseRootEnv(rootDir?: string): Record<string, string>;
export function loadMergedRootEnv(
  rootDir?: string,
  baseEnv?: NodeJS.ProcessEnv,
): Record<string, string | undefined>;
export function applyRootEnv(rootDir?: string): void;
