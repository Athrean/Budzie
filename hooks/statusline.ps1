#!/usr/bin/env pwsh
# Budzie local statusline (PowerShell). Forwards the statusline stdin JSON to
# the Node status script and prints its single-line output. Silent-fails: any
# error yields a safe default line so the host status bar never breaks.
$ErrorActionPreference = 'SilentlyContinue'

$root = $env:CLAUDE_PLUGIN_ROOT
if (-not $root) {
  $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$script = Join-Path $root 'scripts/hooks/status.mjs'

$stdin = [Console]::In.ReadToEnd()
$line = $stdin | node $script 2>$null
if (-not $line) {
  # budzie: static fallback when node or the ledger is unavailable; the live
  # badge comes from status.mjs/ledger.mjs. Upgrade trigger: read the cached
  # badge here if a shell-only badge path is ever needed.
  $line = '[BUDZIE] 0 | Budzie: off | no budget'
}
Write-Output $line
