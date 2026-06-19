// @ts-check
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SH = path.join(ROOT, "install.sh");
const PS1 = path.join(ROOT, "install.ps1");

function fakeNpx() {
  const dir = mkdtempSync(path.join(tmpdir(), "budzie-bootstrap-"));
  const log = path.join(dir, "npx.log");
  const executable = path.join(dir, process.platform === "win32" ? "npx.cmd" : "npx");
  const body =
    process.platform === "win32"
      ? "@echo off\r\n(for %%a in (%*) do @echo %%~a)>>%BUDZIE_NPX_LOG%\r\n"
      : '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$BUDZIE_NPX_LOG"\n';
  writeFileSync(executable, body);
  chmodSync(executable, 0o755);
  return { dir, log };
}

test("package exposes the installer as the package-name executable", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.bin.budzie, "./bin/budzie-install.mjs");
  assert.ok(pkg.files.includes("install.sh"));
  assert.ok(pkg.files.includes("install.ps1"));
});

test("POSIX shim delegates to the local installer from a clone", () => {
  assert.ok(existsSync(SH), "install.sh should exist");
  const result = spawnSync("bash", [SH, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Budzie installer/);
});

test("POSIX stdin shim delegates to the GitHub package and forwards flags", () => {
  assert.ok(existsSync(SH), "install.sh should exist");
  const fake = fakeNpx();
  try {
    const result = spawnSync("bash", ["-s", "--", "--dry-run"], {
      cwd: fake.dir,
      encoding: "utf8",
      input: readFileSync(SH, "utf8"),
      env: {
        ...process.env,
        BUDZIE_NPX_LOG: fake.log,
        PATH: `${fake.dir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(fake.log, "utf8").trim().split("\n"), [
      "-y",
      "github:Athrean/Budzie",
      "--dry-run",
    ]);
  } finally {
    rmSync(fake.dir, { recursive: true, force: true });
  }
});

test(
  "PowerShell shim supports local and irm-pipe execution",
  { skip: spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).error ? "pwsh unavailable" : false },
  () => {
    assert.ok(existsSync(PS1), "install.ps1 should exist");

    const local = spawnSync("pwsh", ["-NoProfile", "-File", PS1, "--help"], {
      encoding: "utf8",
    });
    assert.equal(local.status, 0, local.stderr);
    assert.match(local.stdout, /Budzie installer/);

    const fake = fakeNpx();
    try {
      const remote = spawnSync(
        "pwsh",
        [
          "-NoProfile",
          "-Command",
          `Invoke-Expression (Get-Content -Raw '${PS1.replaceAll("'", "''")}')`,
        ],
        {
          cwd: fake.dir,
          encoding: "utf8",
          env: {
            ...process.env,
            BUDZIE_NPX_LOG: fake.log,
            PATH: `${fake.dir}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        }
      );
      assert.equal(remote.status, 0, remote.stderr);
      assert.deepEqual(readFileSync(fake.log, "utf8").trim().split("\n"), [
        "-y",
        "github:Athrean/Budzie",
      ]);
    } finally {
      rmSync(fake.dir, { recursive: true, force: true });
    }
  }
);
