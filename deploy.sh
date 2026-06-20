#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
#  deploy.sh — Install dependencies & build the Grobogan worker
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

cd "$(dirname "$0")"

# ── Check Node.js ──
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install Node.js 20+: https://nodejs.org/"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js $(node -v) too old — need >=18"
  exit 1
fi
log "Node.js $(node -v)"

# ── Create .env if missing ──
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    log ".env created from .env.example — edit it before starting"
  else
    cat > .env << 'EOF'
MANAGER_URL=http://localhost:8080
WORKER_TOKEN=change_me_to_a_secure_token
HOSTNAME=$(hostname)
CAPABILITIES=nmap,nikto,gobuster,sqlmap,curl,jq,sslscan,whatweb,dig
HEARTBEAT_INTERVAL=30000
TASK_REQUEST_INTERVAL=5000
MAX_CONCURRENT_TASKS=2
IP=auto
EOF
    log ".env created — edit it before starting"
  fi
fi

# ── Install & build ──
log "Installing dependencies..."
npm ci

log "Building TypeScript..."
npm run build

log "Deploy complete.  Next: ./start.sh"
