#!/usr/bin/env sh
set -eu
PORT="${1:-3000}"
LOG=".logs/dev-port-${PORT}.log"
mkdir -p .logs
nohup npx next dev -p "$PORT" > "$LOG" 2>&1 &
echo "Started next dev on port $PORT, pid $!, log $LOG"
