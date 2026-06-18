#!/usr/bin/env bash
# Thin shim: local clones run the checked-out installer; curl-pipe runs it via npm.

set -euo pipefail

repo="Athrean/Budzie"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "Budzie: Node.js 18+ required: https://nodejs.org" >&2
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 18 ]; then
  printf '%s\n' "Budzie: Node.js 18+ required; found $node_major." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd)" || here=""
if [ -n "$here" ] && [ -f "$here/bin/budzie-install.mjs" ]; then
  exec node "$here/bin/budzie-install.mjs" "$@"
fi

if ! command -v npx >/dev/null 2>&1; then
  printf '%s\n' "Budzie: npx required; reinstall Node.js." >&2
  exit 1
fi

exec npx -y "github:$repo" "$@"
