#!/usr/bin/env bash
# Claude Code PreToolUse (Bash) guard: block destructive / irreversible git ops.
# Workflow: verified work (pre-commit: lint/typecheck/test) -> push a feat/* branch -> open a PR.
# Plain `git push` of a feature branch is allowed; husky pre-push is the backstop that protects main.
input="$(cat)"
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
fi
[ -z "${cmd:-}" ] && cmd="$input"

block() {
  echo "BLOCKED: '$cmd' matches dangerous pattern '$1'. The user has prevented you from doing this. If truly intended, ask the user to run it themselves with a leading '!'." >&2
  exit 2
}

case "$cmd" in
  *"git push"*--force*|*"git push"*" -f"*|*"--force-with-lease"*)                 block "force push" ;;
  *"git push origin main"*|*"git push -u origin main"*|*"git push origin master"*) block "direct push to main/master (open a PR instead)" ;;
  *"git reset --hard"*)                                                            block "git reset --hard" ;;
  *"git clean -f"*)                                                                block "git clean -f" ;;
  *"git branch -D"*)                                                               block "git branch -D" ;;
esac
exit 0
