#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  start.sh — Launch the Grobogan worker in background
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

cd "$(dirname "$0")"
PID_FILE=".worker.pid"
LOG_FILE="worker.log"

# ── Already running? ──
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  warn "Worker is already running (PID $(cat "$PID_FILE"))"
  exit 0
fi

# ── Check .env ──
if [ ! -f .env ]; then
  err ".env not found — run ./deploy.sh first"
  exit 1
fi

# ── Check build ──
if [ ! -f dist/index.js ]; then
  err "Build not found — run ./deploy.sh first"
  exit 1
fi

# ── Start ──
log "Starting worker..."
NODE_ENV=production nohup node dist/index.js >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 2
if kill -0 "$PID" 2>/dev/null; then
  log "Worker started (PID $PID)"
  log "  Logs: tail -f $LOG_FILE"
  log "  Stop: ./stop.sh"
else
  err "Worker failed to start — check $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
