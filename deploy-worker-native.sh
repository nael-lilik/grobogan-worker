#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  Grobogan — Native Worker Launcher (host-side, no container)
# ═══════════════════════════════════════════════════════════════════════
#  Runs the worker agent directly on the host machine so the host itself
#  becomes a worker.  Supports Ubuntu/Debian, Fedora/RHEL, Alpine, Arch,
#  macOS, and any system with Node.js 20+.
#
#  Usage:
#    ./deploy-worker-native.sh                          # interactive setup
#    ./deploy-worker-native.sh --noninteractive         # headless install
#    ./deploy-worker-native.sh --status                 # check if running
#    ./deploy-worker-native.sh --stop                   # stop the worker
#    ./deploy-worker-native.sh --service                # install systemd service
#
#  Environment variables (skip prompts when set):
#    MANAGER_URL, WORKER_TOKEN, CAPABILITIES, HOSTNAME
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colours ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# ── Defaults ──
MANAGER_URL="${MANAGER_URL:-http://localhost:8080}"
WORKER_TOKEN="${WORKER_TOKEN:-change_me_to_a_secure_token}"
CAPABILITIES="${CAPABILITIES:-nmap,nikto,gobuster,sqlmap,curl,jq,sslscan,whatweb,dig}"
WORKER_HOSTNAME="${HOSTNAME:-$(hostname)}"
HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-30000}"
TASK_REQUEST_INTERVAL="${TASK_REQUEST_INTERVAL:-5000}"
MAX_CONCURRENT_TASKS="${MAX_CONCURRENT_TASKS:-2}"
NONINTERACTIVE=false
INSTALL_SERVICE=false
ACTION="run"

# ── Parse args ──
for arg in "$@"; do
  case "$arg" in
    --noninteractive) NONINTERACTIVE=true ;;
    --status) ACTION="status" ;;
    --stop)   ACTION="stop" ;;
    --service) INSTALL_SERVICE=true ;;
    --help|-h)
      head -20 "$0" | grep -E '^#  ' | sed 's/^#  //'; exit 0 ;;
  esac
done

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"

# If we're already inside the worker repo (package.json exists here),
# use THIS_DIR directly.  Otherwise look for a ./worker subdirectory
# (classic monorepo layout).
if [ -f "$THIS_DIR/package.json" ]; then
  WORKER_DIR="$THIS_DIR"
elif [ -d "$THIS_DIR/worker" ] && [ -f "$THIS_DIR/worker/package.json" ]; then
  WORKER_DIR="$THIS_DIR/worker"
else
  echo "❌ Cannot find worker package.json."
  echo "   Run this script from the grobogan-worker repo or the project root."
  exit 1
fi

ENV_FILE="$WORKER_DIR/.env"
PID_FILE="$WORKER_DIR/.worker.pid"
LOG_FILE="$WORKER_DIR/worker.log"

# ═══════════════════════════════════════════════════════════════════════
#  Status & stop actions (no setup needed)
# ═══════════════════════════════════════════════════════════════════════
if [ "$ACTION" = "status" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    PID=$(cat "$PID_FILE")
    log "Worker is running (PID $PID)"
    ps -p "$PID" -o pid,etime,cmd --no-headers 2>/dev/null || true
  else
    warn "Worker is not running"
  fi
  exit 0
fi

if [ "$ACTION" = "stop" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    PID=$(cat "$PID_FILE")
    log "Stopping worker (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    sleep 2
    if kill -0 "$PID" 2>/dev/null; then
      warn "Graceful stop failed, forcing..."
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    log "Worker stopped"
  else
    warn "No running worker found"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════
#  Prerequisites
# ═══════════════════════════════════════════════════════════════════════
log "Grobogan Native Worker Setup"
info "Manager URL:  $MANAGER_URL"
info "Hostname:     $WORKER_HOSTNAME"
info "Capabilities: $CAPABILITIES"
echo ""

# ── Detect package manager ──
detect_pkg_manager() {
  if command -v apt-get &>/dev/null; then echo "apt";
  elif command -v dnf &>/dev/null; then echo "dnf";
  elif command -v yum &>/dev/null; then echo "yum";
  elif command -v apk &>/dev/null; then echo "apk";
  elif command -v pacman &>/dev/null; then echo "pacman";
  elif command -v brew &>/dev/null; then echo "brew";
  else echo "unknown"; fi
}

PKG=$(detect_pkg_manager)
info "Detected package manager: $PKG"

# ── Check / install Node.js 20+ ──
NEED_NODE=false
if ! command -v node &>/dev/null; then
  NEED_NODE=true
else
  NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
  if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
    NEED_NODE=true
    warn "Node.js $(node -v) found, but >=18 required"
  fi
fi

if $NEED_NODE; then
  if $NONINTERACTIVE; then
    log "Installing Node.js 20 automatically..."
  else
    echo ""
    read -r -p "Node.js 20+ is required. Install now? [Y/n] " yn
    case "${yn:-y}" in [Nn]*) err "Node.js is required — aborting"; exit 1 ;; esac
  fi

  case "$PKG" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
      sudo "$PKG" install -y nodejs ;;
    apk)
      sudo apk add --no-cache nodejs npm ;;
    pacman)
      sudo pacman -S --noconfirm nodejs npm ;;
    brew)
      brew install node@20 ;;
    *)
      err "Cannot install Node.js automatically on this system."
      info "Please install Node.js 20+ manually: https://nodejs.org/"
      exit 1 ;;
  esac
  log "Node.js installed: $(node -v)"
else
  log "Node.js $(node -v) ✓"
fi

# ── Check npm ──
if ! command -v npm &>/dev/null; then
  err "npm not found after Node.js install — please install manually"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════
#  Worker .env configuration
# ═══════════════════════════════════════════════════════════════════════
if [ -f "$ENV_FILE" ]; then
  log "Found existing .env — loading values"
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
fi

if $NONINTERACTIVE; then
  log "Non-interactive mode — using environment variables"
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Worker Configuration"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  read -r -p "Manager URL     [$MANAGER_URL]: " input; MANAGER_URL="${input:-$MANAGER_URL}"
  read -r -p "Worker Token    [$WORKER_TOKEN]: " input; WORKER_TOKEN="${input:-$WORKER_TOKEN}"
  read -r -p "Hostname        [$WORKER_HOSTNAME]: " input; WORKER_HOSTNAME="${input:-$WORKER_HOSTNAME}"

  echo ""
  echo "Capabilities (comma-separated tools the worker will use):"
  echo "  Lightweight: nmap,nikto,gobuster,sqlmap,curl,jq,sslscan,whatweb,dig"
  echo "  Full suite:  nmap,nikto,gobuster,sqlmap,curl,jq,masscan,dnsrecon,hydra,sslscan,amass,dirb,whatweb,testssl"
  read -r -p "Capabilities    [$CAPABILITIES]: " input; CAPABILITIES="${input:-$CAPABILITIES}"

  read -r -p "Max concurrent  [$MAX_CONCURRENT_TASKS]: " input; MAX_CONCURRENT_TASKS="${input:-$MAX_CONCURRENT_TASKS}"
fi

log "Writing $ENV_FILE ..."
cat > "$ENV_FILE" << EOF
# Grobogan Worker — native host configuration
MANAGER_URL=$MANAGER_URL
WORKER_TOKEN=$WORKER_TOKEN
HOSTNAME=$WORKER_HOSTNAME
CAPABILITIES=$CAPABILITIES
HEARTBEAT_INTERVAL=$HEARTBEAT_INTERVAL
TASK_REQUEST_INTERVAL=$TASK_REQUEST_INTERVAL
MAX_CONCURRENT_TASKS=$MAX_CONCURRENT_TASKS
IP=auto
EOF

# ═══════════════════════════════════════════════════════════════════════
#  Install dependencies & build
# ═══════════════════════════════════════════════════════════════════════
log "Installing npm dependencies..."
cd "$WORKER_DIR"
npm ci 2>&1 | tail -2

log "Building TypeScript..."
npm run build 2>&1 | tail -2

# ═══════════════════════════════════════════════════════════════════════
#  Install systemd service (optional)
# ═══════════════════════════════════════════════════════════════════════
if $INSTALL_SERVICE; then
  SERVICE_FILE="/etc/systemd/system/grobogan-worker.service"
  log "Installing systemd service → $SERVICE_FILE"
  sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Grobogan Worker Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORKER_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$(which node) $WORKER_DIR/dist/index.js
Restart=always
RestartSec=10
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

# Security hardening
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$WORKER_DIR/.worker-id
ReadOnlyPaths=$WORKER_DIR

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable grobogan-worker
  log "Service installed. Start with: sudo systemctl start grobogan-worker"
  log "Check status:          sudo systemctl status grobogan-worker"
  log "View logs:             journalctl -u grobogan-worker -f"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════
#  Start worker
# ═══════════════════════════════════════════════════════════════════════
# Check if already running
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  warn "Worker is already running (PID $(cat "$PID_FILE"))"
  exit 0
fi

log "Starting worker agent in background..."
cd "$WORKER_DIR"
NODE_ENV=production nohup node dist/index.js >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 2
if kill -0 "$PID" 2>/dev/null; then
  log "Worker started (PID $PID)"
  log "Logs: tail -f $LOG_FILE"
else
  err "Worker failed to start — check $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
