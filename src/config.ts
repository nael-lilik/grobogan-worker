import * as dotenv from 'dotenv';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

function loadPersistentWorkerId(): string {
  const idFile = path.join(__dirname, '..', '.worker-id');
  try {
    if (fs.existsSync(idFile)) {
      const id = fs.readFileSync(idFile, 'utf-8').trim();
      if (id) return id;
    }
  } catch { /* ignore read errors */ }

  const id = `worker-${uuidv4().substring(0, 8)}`;
  try {
    fs.writeFileSync(idFile, id, 'utf-8');
  } catch { /* ignore write errors — non-critical */ }
  return id;
}

export class Config {
  public readonly managerUrl: string;
  public readonly workerId: string;
  public readonly hostname: string;
  public readonly ip: string;
  public readonly capabilities: string[];
  public readonly heartBeatInterval: number;
  public readonly taskRequestInterval: number;
  public readonly maxConcurrentTasks: number;

  constructor() {
    this.managerUrl = process.env.MANAGER_URL || 'http://localhost:8080';
    this.workerId = process.env.WORKER_ID || loadPersistentWorkerId();
    this.hostname = process.env.HOSTNAME || os.hostname();
    this.ip = process.env.IP || this.getIPAddress();
    this.capabilities = this.parseCapabilities(process.env.CAPABILITIES);
    this.heartBeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL || '30000', 10);
    this.taskRequestInterval = parseInt(process.env.TASK_REQUEST_INTERVAL || '5000', 10);
    this.maxConcurrentTasks = parseInt(process.env.MAX_CONCURRENT_TASKS || '1', 10);
  }

  private getIPAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  private parseCapabilities(capabilitiesStr: string | undefined): string[] {
    if (!capabilitiesStr) {
      return ['nmap', 'nikto', 'gobuster', 'sqlmap', 'curl', 'jq', 'whatweb', 'sslscan', 'dig'];
    }
    return capabilitiesStr.split(',').map(s => s.trim().toLowerCase());
  }

  /** Detect which capabilities are actually installed on the system */
  public async detectActualCapabilities(): Promise<string[]> {
    const { execSync } = await import('child_process');
    const configured = this.capabilities;
    const installed: string[] = [];
    for (const cap of configured) {
      try {
        execSync(`which ${cap} 2>/dev/null || command -v ${cap} 2>/dev/null`, { stdio: 'pipe' });
        installed.push(cap);
      } catch {
        // Tool not installed
      }
    }
    return installed;
  }

  /** Per-tool health: installed on PATH AND actually executable */
  public async checkCapabilityHealth(): Promise<CapabilityHealth[]> {
    const { execSync } = await import('child_process');
    const results: CapabilityHealth[] = [];

    // Mapping of tool name to the flag that prints version (non-interactive)
    // Empty string means run without arguments to get version
    const versionFlags: Record<string, string> = {
      nmap: '--version',
      nikto: '-Version',
      gobuster: '--version',
      sqlmap: '--version',
      curl: '--version',
      jq: '--version',
      whatweb: '',
      sslscan: '--version',
      dig: '-v',
      masscan: '--version',
      hydra: '-h',
      enum4linux: '-h',
    };

    // Tool-to-wordlist mapping for health check
    const wordlistDeps: Record<string, string[]> = {
      gobuster: ['/usr/share/wordlists/dirb/common.txt'],
      dirb: ['/usr/share/wordlists/dirb/common.txt'],
      ffuf: ['/usr/share/wordlists/dirb/common.txt'],
      wfuzz: ['/usr/share/wordlists/dirb/common.txt'],
      hydra: ['/usr/share/wordlists/dirb/common.txt'],
    };

    for (const cap of this.capabilities) {
      const result: CapabilityHealth = { name: cap, installed: false, working: false };

      // Step 1: check if tool exists on PATH
      try {
        execSync(`which ${cap} 2>/dev/null || command -v ${cap} 2>/dev/null`, {
          stdio: 'pipe',
          timeout: 3000,
        });
        result.installed = true;
      } catch {
        results.push(result);
        continue;
      }

      // Step 2: try to run it (--version or --help) to verify it actually works
      const flag = versionFlags[cap] !== undefined ? versionFlags[cap] : '--version';
      const cmd = flag ? `${cap} ${flag}` : cap;
      try {
        const out = execSync(`${cmd} 2>&1`, {
          stdio: 'pipe',
          timeout: 5000,
        }).toString().trim();
        result.working = true;
        result.version = out.split('\n')[0]?.substring(0, 80) || 'ok';
      } catch (e: any) {
        // Some tools produce version info but exit non-zero (e.g. nikto with SSL warnings)
        // Try to extract version from stdout/stderr even on failure
        const rawOutput = (e.stdout?.toString() || e.stderr?.toString() || '').trim();
        if (rawOutput) {
          result.working = true;
          result.version = rawOutput.split('\n')[0]?.substring(0, 80) || 'ok';
        } else {
          result.working = false;
          result.error = e.stderr?.toString().substring(0, 100) || e.message?.substring(0, 100) || 'execution failed';
        }
      }

      results.push(result);

      // Step 3: check companion wordlists
      const requiredWordlists = wordlistDeps[cap];
      if (requiredWordlists && result.working) {
        const missing = requiredWordlists.filter((p) => !fs.existsSync(p));
        if (missing.length > 0) {
          result.working = false;
          result.error = `Missing wordlists: ${missing.join(', ')}`;
        }
      }
    }

    return results;
  }
}

export interface CapabilityHealth {
  name: string;
  installed: boolean;
  working: boolean;
  version?: string;
  error?: string;
}

export const config = new Config();
