#!/usr/bin/env bash
# Budzie local statusline (POSIX). Forwards the statusline stdin JSON to the
# Node status script and prints its single-line output. Silent-fails: any
# error yields a safe default line so the host status bar never breaks.
set -u

root="${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
script="$root/scripts/hooks/status.mjs"

if ! node "$script" 2>/dev/null; then
  printf 'Budzie: off | no budget\n'
fi
