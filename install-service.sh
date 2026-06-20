#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  install-service.sh — Install Grobogan worker as systemd service
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

cd "$(dirname "$0")"
WORKER_DIR="$(pwd)"
SERVICE_NAME="grobogan-worker"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Build if needed ──
if [ ! -f dist/index.js ]; then
  log "Building first..."
  npm ci && npm run build
fi

# ── Write service file ──
log "Installing systemd service → $SERVICE_FILE"

sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Grobogan Worker Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$WORKER_DIR
Environment=NODE_ENV=production
EnvironmentFile=$WORKER_DIR/.env
ExecStart=$(which node) $WORKER_DIR/dist/index.js
Restart=always
RestartSec=10

# Logging
StandardOutput=append:$WORKER_DIR/worker.log
StandardError=append:$WORKER_DIR/worker.log

# Security
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

log "Service installed."
echo ""
info "Commands:"
info "  sudo systemctl start  $SERVICE_NAME   # start now"
info "  sudo systemctl status $SERVICE_NAME   # check status"
info "  sudo systemctl stop   $SERVICE_NAME   # stop"
info "  journalctl -u $SERVICE_NAME -f        # follow logs"
