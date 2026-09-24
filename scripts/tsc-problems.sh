#!/usr/bin/env bash
set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="/tmp/tsc-problems-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/tsc-problems-$(date +%s).log"
MAX_OLD_SPACE_SIZE="${TSC_MAX_OLD_SPACE_SIZE:-12288}"
NODE_OPTS="--max-old-space-size=${MAX_OLD_SPACE_SIZE}"

if [ -n "${NODE_OPTIONS:-}" ]; then
	NODE_OPTS="${NODE_OPTS} ${NODE_OPTIONS}"
fi

TSC_BIN="$ROOT/node_modules/typescript/bin/tsc"

CFG="$ROOT/scripts/tsconfig.problems.src.json"

echo "TS problems run started: $(date)" | tee "$LOG"
echo "Repo root: $ROOT" | tee -a "$LOG"
echo "Node options: $NODE_OPTS" | tee -a "$LOG"

if [ -f "$CFG" ]; then
	echo "\n--- Running tsc for $CFG ---" | tee -a "$LOG"
	if [ -f "$TSC_BIN" ]; then
		NODE_OPTIONS="$NODE_OPTS" node "$TSC_BIN" -p "$CFG" --noEmit --pretty false 2>&1 | tee -a "$LOG"
	else
		echo "Local tsc not found at $TSC_BIN, falling back to npx tsc" | tee -a "$LOG"
		NODE_OPTIONS="$NODE_OPTS" npx tsc -p "$CFG" --noEmit --pretty false 2>&1 | tee -a "$LOG"
	fi
	echo "--- Finished $CFG ---\n" | tee -a "$LOG"
else
	echo "Skipping missing config: $CFG" | tee -a "$LOG"
fi

echo "TS problems run finished: $(date)" | tee -a "$LOG"

exit 0
