#!/usr/bin/env bash
# Starts the dev stack (`docker compose up --build`) with the AI review turned on (PRD F4 layer 2).
# The Anthropic API key comes from the macOS Keychain (service "anthropic-api-key") into this process's
# environment only: it is never written to a file. compose.yaml passes it to the backend container.
# Add the key once: security add-generic-password -s anthropic-api-key -a "$USER" -w
# Without the key the stack still starts, and pre-review runs the code checks only.
# Extra arguments go to `docker compose up`, for example: backend/scripts/dev.sh -d
set -euo pipefail

cd "$(dirname "$0")/../.."

if key="$(security find-generic-password -s anthropic-api-key -w 2>/dev/null)"; then
  export ANTHROPIC_API_KEY="$key"
  unset key
else
  echo "No anthropic-api-key in the Keychain: the AI review will not run (code checks only)." >&2
fi

exec docker compose up --build "$@"
