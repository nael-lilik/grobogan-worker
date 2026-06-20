# Grobogan Worker Agent

Distributed worker agent for the [Grobogan Vulnerability Assessment System](https://github.com/nael-lilik/vuln-assessment-system). Connects to a Manager via Socket.IO, receives security scan tasks, executes them against a whitelist of allowed tools, and streams logs/results back in real time.

## Docker Images

Two images available — pick based on your needs:

| | Alpine | Kali |
|---|--------|------|
| **Dockerfile** | `Dockerfile` | `Dockerfile.kali` |
| **Base** | `node:20-alpine` | `kalilinux/kali-rolling` |
| **Size** | ~200 MB | ~2 GB |
| **Startup** | Fast (~5s) | Slower (~30s) |
| **Tools** | Auto-installed on connect | 25+ pre-installed |
| **Best for** | Light scanning, many workers | Heavy scanning, full tool suite |
| **Package manager** | `apk` | `apt-get` |

### Tool Availability

| Tool | Alpine | Kali |
|------|--------|------|
| `nmap` | ✅ auto-install | ✅ pre-installed |
| `nikto` | ✅ auto-install | ✅ pre-installed |
| `curl` | ✅ auto-install | ✅ pre-installed |
| `jq` | ✅ auto-install | ✅ pre-installed |
| `sslscan` | ✅ auto-install | ✅ pre-installed |
| `sqlmap` | ✅ pip fallback | ✅ pre-installed |
| `dig` | ✅ (as `bind-tools`) | ✅ pre-installed |
| `gobuster` | ❌ not in Alpine | ✅ pre-installed |
| `whatweb` | ❌ not in Alpine | ✅ pre-installed |
| `masscan` | ❌ | ✅ pre-installed |
| `hydra` | ❌ | ✅ pre-installed |
| `dnsrecon` | ❌ | ✅ pre-installed |
| `dirb` | ❌ | ✅ pre-installed |
| `amass` | ❌ | ✅ pre-installed |
| `wafw00f` | ❌ | ✅ pre-installed |
| `john` | ❌ | ✅ pre-installed |
| `hashcat` | ❌ | ✅ pre-installed |
| `enum4linux` | ❌ | ✅ pre-installed |
| `smbclient` | ❌ | ✅ pre-installed |
| `impacket` | ❌ | ✅ pre-installed |

> **Auto-install:** On first connect, the worker detects missing capabilities and installs them automatically (apk → pip3 fallback). Tools not available on Alpine get a clear log message suggesting the Kali image.

## Architecture

```
Worker                          Manager
┌──────────────────┐           ┌──────────────────┐
│  index.ts         │──Socket.IO──│  socket/         │
│  ├─ config.ts     │  connect   │  ├─ handlers      │
│  ├─ socket/       │  register  │  └─ task router   │
│  │  worker-client │──heartbeat─│                   │
│  └─ executors/    │──task:req─│  REST API :8080   │
│     executor.ts   │←task:assign│  PostgreSQL        │
│                   │──task:log─│                   │
│                   │──task:done│                   │
└──────────────────┘           └──────────────────┘
```

**Communication flow:**
1. Worker connects → registers with ID, hostname, IP, capabilities, and health report
2. Auto-installs missing capabilities (first connect only)
3. Sends periodic heartbeats (CPU/memory/disk stats)
4. Polls for tasks when below `MAX_CONCURRENT_TASKS`
5. Manager assigns task → worker validates command against whitelist → spawns child process
6. Worker streams stdout/stderr as `task:log` events in real time
7. On completion: emits `task:completed` with summary + raw output

## Quick Start

```bash
# 1. Clone
git clone https://github.com/nael-lilik/grobogan-worker.git
cd grobogan-worker

# 2. One-command setup (installs deps, builds, creates .env)
./deploy.sh

# 3. Edit .env → set MANAGER_URL to your manager's address
#    Remote:  MANAGER_URL=https://va-grob.nael.my.id
#    Local:   MANAGER_URL=http://localhost:8080
nano .env

# 4. Run
./start.sh
```

### Lifecycle Scripts

| Script | Purpose |
|--------|---------|
| `./deploy.sh` | Install npm deps + build TypeScript + create `.env` from template |
| `./start.sh` | Launch worker in background (PID-tracked, logs to `worker.log`) |
| `./stop.sh` | Graceful shutdown, force-kill after 10s timeout |
| `./install-service.sh` | Install as systemd service for production (auto-start on boot) |
| `./deploy-worker-native.sh` | All-in-one: Node.js install + setup + run + optional systemd |

```bash
# Production deployment
./deploy.sh
./install-service.sh
sudo systemctl start grobogan-worker
journalctl -u grobogan-worker -f
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MANAGER_URL` | `http://localhost:8080` | Manager API / Socket.IO URL (IP, domain, or Cloudflare Tunnel) |
| `WORKER_TOKEN` | — | Auth token (must match manager's `WORKER_TOKEN`) |
| `WORKER_ID` | auto-generated | Unique persistent worker identifier (stored in `.worker-id`) |
| `HOSTNAME` | auto-detected | Worker hostname for display |
| `IP` | auto-detected | Worker IP (set `auto` for auto-detection) |
| `CAPABILITIES` | `nmap,nikto,gobuster,sqlmap,curl,jq` | Comma-separated whitelist of allowed tools |
| `HEARTBEAT_INTERVAL` | `30000` | Status heartbeat interval (ms) |
| `TASK_REQUEST_INTERVAL` | `5000` | Task poll interval when below capacity (ms) |
| `MAX_CONCURRENT_TASKS` | `1` | Maximum parallel task executions |

### Remote Manager Examples

```bash
# Cloudflare Tunnel (HTTPS)
MANAGER_URL=https://va-grob.nael.my.id

# Direct IP
MANAGER_URL=http://203.0.113.10:8080
```

## Whitelisted Commands

The worker only executes commands whose base binary is in the whitelist. Any tool not listed below is rejected.

| Tool | Description |
|------|-------------|
| `nmap` | Network/port scanning |
| `nikto` | Web server vulnerability scanner |
| `gobuster` | Directory/file enumeration |
| `sqlmap` | SQL injection testing |
| `curl` | HTTP client |
| `jq` | JSON processor |
| `ssh` | Secure shell client |
| `ping` | Network connectivity |
| `telnet` | Telnet client |
| `whois` | WHOIS lookup |
| `dig` | DNS lookup |
| `netcat` | Network utility |
| `masscan` | High-speed port scanner |
| `sslscan` | SSL/TLS scanner |
| `whatweb` | Website technology fingerprinting |
| `openvas` | OpenVAS vulnerability scanner |
| `nessus` | Nessus vulnerability scanner |
| `acunetix` | Web vulnerability scanner |

### Capability Health Checks

On registration, the worker runs two-phase validation for each configured capability:
1. **Installed check** — verifies the binary exists on `PATH`
2. **Working check** — runs `<tool> --version` and parses output
3. **Wordlist check** — verifies companion wordlists exist (`/usr/share/wordlists/dirb/common.txt`) for tools like `gobuster`, `dirb`, `hydra`

Results are reported to the manager and displayed in the dashboard.

## Deployment

### Native (Node.js) — Recommended

```bash
./deploy.sh               # install deps + build + create .env
# Edit .env → set MANAGER_URL
./start.sh                # run in background
./stop.sh                 # stop
./install-service.sh      # systemd service for production
```

For headless install across multiple hosts:

```bash
MANAGER_URL=https://va-grob.nael.my.id \
WORKER_TOKEN=secret \
CAPABILITIES=nmap,nikto,gobuster,sqlmap,curl,jq \
./deploy-worker-native.sh --noninteractive
```

### Remote Worker (Cloudflare Tunnel / Reverse Proxy)

Since the dashboard Nginx already proxies `/socket.io/` to the backend, workers can connect through the public URL without exposing port 8080:

```bash
# .env
MANAGER_URL=https://va-grob.nael.my.id
WORKER_TOKEN=change_me_to_a_secure_token
```

The worker uses Socket.IO which upgrades to WebSocket — Cloudflare Tunnel and most reverse proxies support this natively.

### Docker — Alpine (Lightweight)

```bash
# Build
docker build -t grobogan-worker .

# Run
docker run -d --name grobogan-worker --network host \
  -e MANAGER_URL=http://localhost:8080 \
  -e WORKER_TOKEN=your_secure_token \
  -e CAPABILITIES=nmap,nikto,sqlmap,curl,jq,sslscan,dig \
  grobogan-worker
```

**Startup log:**
```
🔧 Auto-installing 6 missing capabilities: nmap, nikto, sqlmap, curl, jq, sslscan, dig
  ✅ nmap installed
  ✅ nikto installed
  ✅ sqlmap installed (via pip)
  ✅ curl installed
  ✅ jq installed
  ✅ sslscan installed
  ✅ dig installed
🔧 Auto-install complete: 7/7 installed
```

### Docker — Kali (Full Tool Suite)

```bash
# Build
docker build -f Dockerfile.kali -t grobogan-kali-worker .

# Run
docker run -d --name grobogan-kali-worker --network host \
  -e MANAGER_URL=http://localhost:8080 \
  -e WORKER_TOKEN=your_secure_token \
  -e CAPABILITIES=nmap,nikto,gobuster,sqlmap,curl,jq,masscan,dnsrecon,hydra,sslscan,amass,dirb,whatweb,testssl \
  grobogan-kali-worker
```

**Startup log:**
```
✅ All capabilities already installed
✅ Worker approved — ready to receive tasks
```

### Podman

```bash
# Alpine
podman build --network host -t grobogan-worker .
podman run -d --name grobogan-worker --network host \
  -e MANAGER_URL=http://localhost:8080 \
  grobogan-worker

# Kali
podman build --network host -f Dockerfile.kali -t grobogan-kali-worker .
podman run -d --name kali-worker --network host \
  -e MANAGER_URL=http://localhost:8080 \
  grobogan-kali-worker
```

### Standalone Docker Compose

Deploy worker(s) on a separate host from the manager:

```bash
# Single worker
docker compose -f docker-compose.worker.yml up -d

# Scale to 5 workers
docker compose -f docker-compose.worker.yml up --scale worker=5 -d

# Podman
podman compose -f docker-compose.worker.yml up -d
```

Edit `.env` before running or pass variables inline:

```bash
MANAGER_URL=https://va-grob.nael.my.id WORKER_TOKEN=secret \
  docker compose -f docker-compose.worker.yml up -d
```

## Socket.IO Protocol

### Worker → Manager

| Event | Payload | When |
|-------|---------|------|
| `worker:register` | `{ workerId, hostname, ip, capabilities, actualCapabilities, capabilityHealth, resources, maxConcurrentTasks }` | On connect |
| `worker:heartbeat` | `{ workerId, hostname, ip, capabilities, currentTaskCount, resources, timestamp }` | Every `HEARTBEAT_INTERVAL` ms |
| `worker:status` | `{ workerId, status, capabilities, hostname, ip, activeTasks, maxConcurrentTasks }` | Initial + on status change |
| `worker:capability-report` | `{ workerId, capabilities, capabilityHealth }` | After registration, install, or verify |
| `task:request` | `{ workerId, capabilities, activeTaskCount, maxConcurrentTasks }` | Every `TASK_REQUEST_INTERVAL` ms when below capacity |
| `task:started` | `{ taskId, workerId, targetId, type, startedAt }` | Task execution begins |
| `task:log` | `{ taskId, workerId, message, level, timestamp }` | stdout/stderr streamed per line |
| `task:progress` | `{ taskId, workerId, progress, message, timestamp }` | Periodic progress updates |
| `task:completed` | `{ taskId, workerId, status, summary?, rawOutput?, error?, finishedAt, resultId? }` | Task finishes (success/failure/cancelled) |

### Manager → Worker

| Event | Payload | When |
|-------|---------|------|
| `task:assign` | `{ taskId, task: { id, type, command, options? }, resultId? }` | Manager assigns a task |
| `task:cancel` | `{ taskId }` | Manager cancels a running task |
| `worker:shutdown` | — | Graceful shutdown signal |
| `worker:approval` | `{ approved: boolean }` | Worker approved/rejected by admin |
| `worker:install-capability` | `{ capability }` | Dashboard triggers install on worker |
| `worker:verify-capability` | `{ capability }` | Dashboard triggers capability health re-check |

## Task Lifecycle

```
PENDING → ASSIGNED → RUNNING → COMPLETED / FAILED / CANCELLED
                   ↘ REJECTED (worker at capacity)
```

- **Timeouts:** 30 minutes per task — process is killed with `SIGTERM` then `SIGKILL` after 1s grace
- **Cancellation:** Manager sends `task:cancel` → worker sends `SIGTERM` + force `SIGKILL` after 1s
- **Reconnection:** Up to 10 retries with exponential backoff (3s × attempt number, max 30s)

## Directory Structure

```
worker/
├── src/
│   ├── index.ts               # Entry point, loops, graceful shutdown
│   ├── config.ts              # Env config, persistent ID, capability detection/health, wordlist paths
│   ├── socket/
│   │   └── worker-client.ts   # Socket.IO client, registration, auto-install, environment detection, task lifecycle
│   ├── executors/
│   │   └── executor.ts        # Command spawn, whitelist validation, log streaming, cancellation
│   └── types/
│       └── index.ts           # Interfaces (WorkerInfo, WorkerEnvironment) + whitelist definition
├── deploy.sh                  # Install deps + build + create .env
├── start.sh                   # Launch worker in background
├── stop.sh                    # Graceful stop with forced-kill fallback
├── install-service.sh         # Install as systemd service
├── deploy-worker-native.sh    # All-in-one launcher (auto Node.js install, PM detection)
├── .env.example               # Configuration template
├── .worker-id                 # Auto-generated persistent worker ID (gitignored)
├── docker-compose.worker.yml  # Standalone worker Compose file
├── Dockerfile                 # Alpine Node.js 20 image (~200 MB)
├── Dockerfile.kali            # Kali Linux full tool suite image (~2 GB)
├── jest.config.ts
├── tsconfig.json
└── package.json
```

## Development

```bash
npm install               # Install dependencies
npm run dev               # ts-node with hot reload
npm run build             # TypeScript compilation → dist/
npm run test              # Jest tests
npm run test:watch        # Jest watch mode
npm run lint              # ESLint
```

## Related Repositories

| Repository | Description |
|------------|-------------|
| [vuln-assessment-system](https://github.com/nael-lilik/vuln-assessment-system) | Main system — Manager backend + Dashboard frontend |
| [grobogan-worker](https://github.com/nael-lilik/grobogan-worker) | This repo — standalone worker agent |
