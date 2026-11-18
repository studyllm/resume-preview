// Copies the static preview assets into build/ and marks the CLI entry executable.
// Plain Node so the build works on Windows, where `cp` and `chmod` are not on PATH.
// The target directory is replaced wholesale: copying into an existing directory
// would nest the assets one level deeper on every build.
import { chmod, cp, rm } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "src", "preview");
const target = join(root, "build", "preview");
const entry = join(root, "build", "index.js");

await rm(target, { recursive: true, force: true });
await cp(assets, target, { recursive: true });
await chmod(entry, 0o755);

console.log(`Copied preview assets to ${target}`);
