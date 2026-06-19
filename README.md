# Grobogan Worker Agent

Distributed worker agent for the Grobogan Vulnerability Assessment System. Connects to a remote (or local) Manager via Socket.IO, receives security scan tasks, executes them, and streams results back.

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env → set MANAGER_URL to your manager's address

# 2. Install & build
npm install && npm run build

# 3. Run
node dist/index.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MANAGER_URL` | `http://localhost:8080` | Manager API / Socket.IO URL |
| `WORKER_TOKEN` | — | Auth token (must match manager) |
| `WORKER_ID` | auto-generated | Unique worker identifier |
| `CAPABILITIES` | `nmap,nikto,gobuster,sqlmap,curl,jq` | Comma-separated tool list |
| `HEARTBEAT_INTERVAL` | `30000` | Status heartbeat (ms) |
| `TASK_REQUEST_INTERVAL` | `5000` | Task poll interval (ms) |
| `MAX_CONCURRENT_TASKS` | `1` | Max parallel tasks |

### Remote Manager (Cloudflare Tunnel)
```bash
MANAGER_URL=https://va-grob.nael.my.id
# or with custom port:
MANAGER_URL=http://203.0.113.10:8080
```

## Deployment

### Native (Node.js)
```bash
npm install && npm run build && node dist/index.js
```

### Docker
```bash
docker build -t grobogan-worker .
docker run -d --name grobogan-worker \
  -e MANAGER_URL=https://your-manager.example.com \
  grobogan-worker
```

### Podman
```bash
podman build --network host -t grobogan-worker .
podman run -d --name grobogan-worker --network host \
  -e MANAGER_URL=http://localhost:8080 \
  grobogan-worker
```

### Docker Compose (Standalone Worker)
```bash
docker compose -f docker-compose.worker.yml up -d
```

### Kali Linux Worker
```bash
podman build -t grobogan-kali-worker -f Dockerfile.kali .
podman run -d --name kali-worker --network host \
  -e MANAGER_URL=https://your-manager.example.com \
  grobogan-kali-worker
```

## Capabilities

The worker auto-detects installed tools and reports them to the manager. Pre-configured tools:

| Tool | Purpose |
|------|---------|
| `nmap` | Network/port scanning |
| `nikto` | Web server vulnerability scan |
| `gobuster` | Directory enumeration |
| `sqlmap` | SQL injection testing |
| `curl` | HTTP requests |
| `jq` | JSON processing |
| `whatweb` | Technology fingerprinting |
| `sslscan` | SSL/TLS analysis |
| `dig` | DNS queries |

### Kali Worker (Dockerfile.kali)
Includes additional tools: `masscan`, `dnsrecon`, `hydra`, `amass`, `dirb`, `testssl`

## Development

```bash
npm install
npm run dev          # ts-node with hot reload
npm run build        # TypeScript compilation
npm run test         # Jest tests
```

## Architecture

```
worker/src/
├── index.ts              # Entry point, heartbeat/task loops, shutdown
├── config.ts             # Env-based config, capability detection
├── socket/
│   └── worker-client.ts  # Socket.IO client, task handling, reconnection
├── executors/
│   └── executor.ts       # Command execution with whitelist validation
└── types/
    └── index.ts          # TypeScript interfaces
```

Worker connects to Manager → registers capabilities → receives tasks → executes → streams results.
# grobogan-worker
