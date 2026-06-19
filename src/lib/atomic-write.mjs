// @ts-check
import { mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Write a file atomically and symlink-safely.
 *
 * The contents go to a fresh exclusive temp file (`wx` = O_CREAT|O_EXCL, so a
 * symlink pre-planted at the temp path is refused with EEXIST, never followed)
 * with `0600` permissions, then `rename` moves it over the destination.
 * rename(2) replaces the destination directory entry itself — if the
 * destination is a symlink, the link is replaced, not written through — so
 * neither step can clobber a file outside `path.dirname(file)`. The rename is
 * atomic, so a reader sees either the old file or the new one, never a partial.
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
    writeFileSync(temp, data, { flag: "wx", mode: 0o600 });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
