// @ts-check
import { constants, mkdirSync, openSync, writeSync, closeSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Temp-open flags: O_WRONLY|O_CREAT|O_EXCL (same as the `wx` string) plus
 * O_NOFOLLOW. O_EXCL refuses to open if the temp path already exists; O_NOFOLLOW
 * additionally refuses (ELOOP) if its final component is a symlink — belt and
 * braces against a planted symlink at the predictable write location. O_NOFOLLOW
 * is a no-op (0) on platforms that do not define it (e.g. Windows).
 */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const TEMP_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;

/**
 * Write a file atomically and symlink-safely.
 *
 * The contents go to a fresh exclusive temp file (O_CREAT|O_EXCL|O_NOFOLLOW, so a
 * symlink pre-planted at the temp path is refused, never followed) with `0600`
 * permissions, then `rename` moves it over the destination. rename(2) replaces
 * the destination directory entry itself — if the destination is a symlink, the
 * link is replaced, not written through — so neither step can clobber a file
 * outside `path.dirname(file)`. The rename is atomic, so a reader sees either the
 * old file or the new one, never a partial.
 *
 * This is the writer for Budzie's predictable, machine-local state (mode flag,
 * intensity, budget, ledger): paths an attacker could pre-plant a symlink at.
 * In-place memory-file compressors deliberately do NOT use it — they write
 * through a user's own symlinked `CLAUDE.md`/`AGENTS.md` on purpose, so replacing
 * the link would break an intentional setup.
 *
 * @param {string} file - Destination path. Its parent dir is created if absent.
 * @param {string} data - File contents.
 */
export function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  mkdirSync(dir, { recursive: true });
  try {
    // openSync takes numeric flags, so O_NOFOLLOW applies to the exclusive
    // create. Write the fd directly, then atomically rename it over the target.
    const fd = openSync(temp, TEMP_FLAGS, 0o600);
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
