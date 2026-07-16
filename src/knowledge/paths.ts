import * as fs from "fs";
import * as path from "path";

const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "composer.json",
] as const;

/**
 * Resolve the active project root for vault placement.
 * Priority: explicit env → walk up from cwd (skip bare home) → cwd.
 */
export function resolveProjectRoot(): string {
  const fromEnv =
    process.env.AIO_PROJECT_ROOT ||
    process.env.CURSOR_PROJECT_DIR ||
    process.env.WORKSPACE_FOLDER;

  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }

  const home = path.resolve(process.env.HOME || process.env.USERPROFILE || "");
  let dir = path.resolve(process.cwd());
  const { root } = path.parse(dir);

  while (true) {
    const isHome = home !== "" && path.resolve(dir) === home;
    const hasMarker = PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

    // Home often has ~/.cursor — do not treat home as the project unless it has a real marker.
    if (hasMarker && !isHome) {
      return dir;
    }
    if (hasMarker && isHome && (fs.existsSync(path.join(dir, ".git")) || fs.existsSync(path.join(dir, "package.json")))) {
      return dir;
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return path.resolve(process.cwd());
}

/**
 * Resolve Obsidian/wiki vault directory.
 * Priority: explicit arg → AIO_VAULT_PATH / OBSIDIAN_VAULT_PATH → <projectRoot>/vault
 */
export function resolveVaultRoot(explicit?: string): string {
  if (explicit?.trim()) {
    return path.resolve(explicit.trim());
  }

  const fromEnv = process.env.AIO_VAULT_PATH || process.env.OBSIDIAN_VAULT_PATH;
  if (fromEnv?.trim()) {
    return path.resolve(fromEnv.trim());
  }

  return path.join(resolveProjectRoot(), "vault");
}

export function resolveIndexDir(vaultRoot: string): string {
  return path.join(vaultRoot, ".index");
}

/** Normalize relative vault paths to POSIX style (wiki/foo.md). */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}
