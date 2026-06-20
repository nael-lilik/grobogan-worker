#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  stop.sh — Stop the running Grobogan worker
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

cd "$(dirname "$0")"
PID_FILE=".worker.pid"

if [ ! -f "$PID_FILE" ]; then
  warn "No PID file found — worker may not be running"
  exit 0
fi

PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then
  warn "Worker (PID $PID) is not running"
  rm -f "$PID_FILE"
  exit 0
fi

log "Stopping worker (PID $PID)..."
kill "$PID" 2>/dev/null || true

# Wait up to 10s for graceful shutdown
for i in $(seq 1 10); do
  if ! kill -0 "$PID" 2>/dev/null; then
    log "Worker stopped"
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 1
done

warn "Graceful stop timed out — forcing"
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
log "Worker killed"
