/**
 * Path helpers shared by the test suite.
 *
 * The production code builds paths with Node's `path` module, so the
 * separator is platform-dependent (`\` on Windows, `/` elsewhere). Tests that
 * assert on path *shape* must normalize separators first, otherwise they only
 * pass on POSIX.
 */

/**
 * Normalizes a filesystem path to forward slashes so that assertions on path
 * shape are platform-independent.
 */
export function normalizeSeparators(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * True when the current platform resolves POSIX-style absolute paths
 * (`/etc/passwd`) rather than drive-letter paths (`C:\etc\passwd`).
 */
export function isPosixPathPlatform(): boolean {
  return process.platform !== "win32";
}

/**
 * True on Windows. Node's `path.resolve` is bound to the real platform at
 * module load, so code paths that depend on POSIX path resolution can only be
 * exercised off Windows.
 */
export function isWindowsPlatform(): boolean {
  return process.platform === "win32";
}
